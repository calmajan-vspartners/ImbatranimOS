import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { generateSecret, generateURI, verifySync } from 'otplib';
import * as QRCode from 'qrcode';
import { DbService } from '../../db/db.service';
import { SessionService } from './session.service';

interface AuthUserRow {
  id: number;
  password_hash: string;
  totp_secret: string | null;
  totp_enabled: number;
  totp_last_step: number | null;
}

// argon2id — memory-hard, side-channel resistant, and the current OWASP
// recommendation. Params are the library defaults tuned up slightly; they run
// in well under a second on the target hardware while staying costly to brute.
const ARGON2_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB (OWASP minimum)
  timeCost: 2,
  parallelism: 1,
};

const MIN_PASSWORD_LENGTH = 10;
const TOTP_ISSUER = 'ImbatranimOS';
const TOTP_LABEL = 'imbatranim';

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly sessions: SessionService,
  ) {}

  private getUser(): AuthUserRow | undefined {
    return this.db.db.prepare('SELECT * FROM auth_user WHERE id = 1').get() as
      | AuthUserRow
      | undefined;
  }

  /** Has the single user been created yet? Drives the first-run wizard. */
  isSetup(): boolean {
    return !!this.getUser();
  }

  totpEnabled(): boolean {
    const u = this.getUser();
    return !!u && u.totp_enabled === 1;
  }

  /**
   * First-run: create the one and only user. No default password ever exists;
   * the account does not exist until this succeeds. Idempotency is refused —
   * re-running once set up is a 409 (prevents silent password reset).
   */
  async setup(password: string): Promise<void> {
    if (this.isSetup()) {
      throw new ConflictException('Already set up');
    }
    this.assertStrongPassword(password);
    const hash = await argon2.hash(password, ARGON2_OPTS);
    this.db.db
      .prepare('INSERT INTO auth_user (id, password_hash) VALUES (1, ?)')
      .run(hash);
  }

  /**
   * Verify a password against the stored argon2id hash. argon2.verify is
   * constant-time w.r.t. the hash, so this is not a timing oracle. Returns
   * false (never throws) for a missing user or malformed hash.
   */
  async verifyPassword(password: string): Promise<boolean> {
    const u = this.getUser();
    if (!u) return false;
    try {
      return await argon2.verify(u.password_hash, password);
    } catch {
      return false;
    }
  }

  /**
   * Verify a TOTP code for authentication (login + the changePassword step-up),
   * enforcing single-use replay protection per RFC 6238 §5.2.
   *
   * A valid code identifies its time step; if that step was already accepted
   * (step <= the stored `totp_last_step`) the code is a replay and is rejected,
   * so the same 6 digits cannot be used twice within their window. On success
   * the accepted step is recorded.
   *
   * Enrollment confirmation ({@link confirmTotp}) deliberately does NOT go
   * through here — it uses the pure {@link totpMatch} so confirming enrollment
   * does not burn the step the user is about to log in with.
   */
  verifyTotp(token: string): boolean {
    const u = this.getUser();
    if (!u || !u.totp_secret) return false;
    const match = this.totpMatch(token, u.totp_secret);
    if (!match) return false;
    if (u.totp_last_step !== null && match.step <= u.totp_last_step) {
      return false; // replay of an already-accepted code
    }
    this.db.db
      .prepare('UPDATE auth_user SET totp_last_step = ? WHERE id = 1')
      .run(match.step);
    return true;
  }

  /**
   * Pure TOTP validity check (no replay bookkeeping): returns the matched time
   * step or null. The step is derived from the library's `timeStep` when it
   * exposes it, else from `Math.floor(Date.now()/1000/30)`.
   */
  private totpMatch(token: string, secret: string): { step: number } | null {
    try {
      // epochTolerance allows ±30s of clock drift (one adjacent step).
      const res = verifySync({ token, secret, epochTolerance: 30 });
      if (!res.valid) return null;
      // `verifySync`'s union covers HOTP too, so `timeStep` is only present on
      // the TOTP result — narrow with `in`, else derive the RFC 6238 step.
      const step =
        'timeStep' in res && typeof res.timeStep === 'number'
          ? res.timeStep
          : Math.floor(Date.now() / 1000 / 30);
      return { step };
    } catch {
      return null;
    }
  }

  /**
   * Begin TOTP enrollment: generate a fresh secret, store it as PENDING
   * (totp_enabled stays 0), and return the otpauth URI + a QR data-URL for the
   * settings screen. TOTP is not required at login until {@link confirmTotp}.
   *
   * Requires the current password (step-up auth): rotating the secret clears
   * `totp_enabled`, so without this gate a stolen session alone could silently
   * drop 2FA — the same reason {@link disableTotp} demands the password.
   */
  async beginTotpEnroll(password: string): Promise<{
    secret: string;
    uri: string;
    qrDataUrl: string;
  }> {
    if (!this.isSetup()) throw new BadRequestException('Not set up');
    if (!(await this.verifyPassword(password))) {
      throw new UnauthorizedException('Invalid password');
    }
    const secret = generateSecret();
    const uri = generateURI({ issuer: TOTP_ISSUER, label: TOTP_LABEL, secret });
    this.db.db
      .prepare(
        'UPDATE auth_user SET totp_secret = ?, totp_enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
      )
      .run(secret);
    const qrDataUrl = await QRCode.toDataURL(uri);
    return { secret, uri, qrDataUrl };
  }

  /** Confirm enrollment by proving a valid code; flips TOTP on. */
  confirmTotp(token: string): void {
    const u = this.getUser();
    if (!u || !u.totp_secret) {
      throw new BadRequestException('No pending TOTP enrollment');
    }
    // Pure validity check (not verifyTotp): confirming enrollment must not burn
    // the replay step the user is about to log in with.
    if (!this.totpMatch(token, u.totp_secret)) {
      throw new UnauthorizedException('Invalid code');
    }
    this.db.db
      .prepare(
        'UPDATE auth_user SET totp_enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
      )
      .run();
  }

  /** Disable TOTP; requires the current password to prevent casual removal. */
  async disableTotp(password: string): Promise<void> {
    if (!(await this.verifyPassword(password))) {
      throw new UnauthorizedException('Invalid password');
    }
    this.db.db
      .prepare(
        'UPDATE auth_user SET totp_secret = NULL, totp_enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
      )
      .run();
  }

  /**
   * Rotate the password.
   *
   * The OS had no way to do this at all: a password typed once at first-run could
   * never be changed, and a password you suspected was compromised could only be
   * replaced by deleting the database and losing the account. For a system the
   * README recommends exposing behind a reverse proxy, that is a real gap.
   *
   * Four things have to be true, and each is a deliberate choice:
   *
   * 1. **The current password is re-proved**, even though the caller already holds
   *    a valid session. A session cookie is a bearer token; if one leaks, the
   *    thief must not be able to lock the owner out of their own machine by
   *    changing the password. This is the same step-up `disableTotp` demands.
   * 2. **A current TOTP code is required when TOTP is enabled.** Rotating the
   *    password is at least as sensitive as turning 2FA off, which already asks.
   *    Without it, a stolen session plus a phished password would be enough.
   * 3. **The new password meets the same minimum as first-run.** One rule, one
   *    place — a weaker bar for rotation would make rotating a downgrade.
   * 4. **The old hash is replaced with a fresh argon2id hash** using the same
   *    parameters, so a rotated password is exactly as costly to attack as a new
   *    install's.
   *
   * Session invalidation is the caller's job (the controller), because only it can
   * re-issue the cookie. See the route for why every session dies rather than all
   * but the caller's.
   */
  async changePassword(
    currentPassword: string,
    nextPassword: string,
    totpToken?: string,
  ): Promise<void> {
    if (!this.isSetup()) throw new BadRequestException('Not set up');

    // Order matters: verify BEFORE validating the new password's strength. The
    // reverse would let an attacker with a session probe the strength rule (and
    // get a distinguishable error) without knowing the current password at all.
    if (!(await this.verifyPassword(currentPassword))) {
      throw new UnauthorizedException('Invalid password');
    }
    if (this.totpEnabled() && !(totpToken && this.verifyTotp(totpToken))) {
      throw new UnauthorizedException('Invalid code');
    }

    this.assertStrongPassword(nextPassword);
    // Refusing a no-op change is not pedantry: silently "succeeding" while
    // invalidating every other session would look like a rotation that did not
    // actually rotate anything.
    if (await this.verifyPassword(nextPassword)) {
      throw new BadRequestException(
        'The new password must differ from the current one',
      );
    }

    const hash = await argon2.hash(nextPassword, ARGON2_OPTS);
    this.db.db
      .prepare(
        'UPDATE auth_user SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
      )
      .run(hash);
    // TOTP is deliberately untouched: a password change must not silently drop
    // the second factor.
  }

  private assertStrongPassword(password: string): void {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }
  }
}
