import {
  HttpException,
  HttpStatus,
  Injectable,
  Optional,
} from '@nestjs/common';
import { LogService } from '../logs/log.service';

interface Attempt {
  count: number;
  lockedUntil: number; // epoch ms; 0 = not locked
}

/**
 * In-memory login rate limiter, keyed by client IP.
 *
 * Rationale for in-memory (vs SQLite): the throttle is a defence against
 * online brute force, and an attacker cannot restart the container to clear
 * it. State resetting on a legitimate restart is acceptable (and desirable —
 * it self-heals a bad lockout). Single-process, so no cross-worker sharing is
 * needed. Keyed by IP so one attacker cannot lock out the real owner from a
 * different address.
 *
 * Policy: the first {@link FAIL_THRESHOLD} failures are free; after that each
 * additional failure locks the key with exponential backoff (BASE doubling),
 * capped at MAX.
 */
@Injectable()
export class ThrottleService {
  readonly FAIL_THRESHOLD = 5;
  readonly BASE_LOCK_MS = 60_000; // 1 min
  readonly MAX_LOCK_MS = 15 * 60_000; // 15 min

  /**
   * Global backstop: total failures across ALL keys before a short, app-wide
   * lockout kicks in. Set far above the per-IP threshold so a single attacker
   * can't lock out the owner (per-IP isolation still holds), but low enough to
   * bound a *distributed* / spoofed-source attack. This closes the case where
   * `TRUST_PROXY=true` on a directly-reachable app lets a forged
   * `X-Forwarded-For` rotate `req.ip` and defeat the per-IP counter. Cleared on
   * any successful login (the legitimate owner self-heals it).
   */
  readonly GLOBAL_FAIL_THRESHOLD = 50;

  private readonly attempts = new Map<string, Attempt>();
  private readonly global: Attempt = { count: 0, lockedUntil: 0 };

  /**
   * Optional so the existing specs, which construct this directly, keep working
   * without a logger — the throttle's job is rate limiting, and it should not
   * stop working because nothing is listening.
   */
  constructor(@Optional() private readonly logs?: LogService) {}

  /** Throws HTTP 429 with Retry-After if the key OR the app is locked out. */
  assertNotLocked(key: string): void {
    this.assertEntryNotLocked(this.global);
    const entry = this.attempts.get(key);
    if (entry) this.assertEntryNotLocked(entry);
  }

  private assertEntryNotLocked(entry: Attempt): void {
    const remaining = entry.lockedUntil - Date.now();
    if (remaining > 0) {
      const retrySec = Math.ceil(remaining / 1000);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Too many attempts. Try again in ${retrySec}s.`,
          retryAfterSeconds: retrySec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Record a failed attempt and (past the threshold) extend the lockout. */
  recordFailure(key: string): void {
    const entry = this.attempts.get(key) ?? { count: 0, lockedUntil: 0 };
    const locked = this.bumpLock(entry, this.FAIL_THRESHOLD);
    this.attempts.set(key, entry);
    const globalLocked = this.bumpLock(this.global, this.GLOBAL_FAIL_THRESHOLD);

    // Logged on the TRANSITION into a lockout, not on every failure past it:
    // the failures themselves are already recorded by the login route, and a
    // line per attempt would make a sustained attack push its own beginning out
    // of the rotation window.
    if (locked) {
      this.logs?.record(
        'warn',
        'auth.throttle.locked',
        'An address was locked out',
        {
          ip: key,
          failures: entry.count,
          lockedForSeconds: Math.ceil((entry.lockedUntil - Date.now()) / 1000),
        },
      );
    }
    if (globalLocked) {
      this.logs?.record(
        'error',
        'auth.throttle.locked.global',
        'Sign-in is locked app-wide after failures from many addresses',
        { failures: this.global.count },
      );
    }
  }

  /**
   * Increment an attempt counter and, once over `threshold`, apply backoff.
   * Returns true when this call is the one that STARTED a lockout.
   */
  private bumpLock(entry: Attempt, threshold: number): boolean {
    const wasLocked = entry.lockedUntil > Date.now();
    entry.count += 1;
    if (entry.count > threshold) {
      const over = entry.count - threshold - 1;
      const lock = Math.min(this.BASE_LOCK_MS * 2 ** over, this.MAX_LOCK_MS);
      entry.lockedUntil = Date.now() + lock;
      return !wasLocked;
    }
    return false;
  }

  /** Clear all failure state for a key (on successful login). */
  reset(key: string): void {
    this.attempts.delete(key);
    this.global.count = 0;
    this.global.lockedUntil = 0;
  }
}
