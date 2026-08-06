import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { DbService } from '../../db/db.service';
import type { Env } from '../../config/env.schema';
import { hashToken, readSessionCookie } from './auth.constants';

export interface SessionRecord {
  token_hash: string;
  created_at: number;
  last_seen: number;
  expires_at: number;
}

/**
 * Issues and validates opaque session tokens. This is the single source of
 * truth for "is this request authenticated" — the global HTTP guard and any
 * future WebSocket upgrade handler both go through {@link validateFromRequest}.
 */
@Injectable()
export class SessionService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Sweep expired sessions on boot. `purgeExpired` was otherwise never called,
   * so `auth_sessions` grew forever — each login/validate only ever inserted or
   * refreshed rows. Combined with the per-issue sweep below, the table now stays
   * bounded to roughly the count of live sessions.
   */
  onModuleInit() {
    this.purgeExpired();
  }

  /** Create a new session and return the RAW token to put in the cookie. */
  issue(): { token: string; maxAgeMs: number } {
    // Opportunistic cleanup: bound the table on the one write that grows it.
    this.purgeExpired();
    const raw = randomBytes(32).toString('base64url');
    const now = Date.now();
    const maxAgeMs = this.config.get('SESSION_TTL_HOURS') * 3600_000;
    this.db.db
      .prepare(
        `INSERT INTO auth_sessions (token_hash, created_at, last_seen, expires_at)
         VALUES (@hash, @now, @now, @exp)`,
      )
      .run({ hash: hashToken(raw), now, exp: now + maxAgeMs });
    return { token: raw, maxAgeMs };
  }

  /** Validate a raw token. Returns the session or null; refreshes last_seen. */
  validate(rawToken: string): SessionRecord | null {
    const hash = hashToken(rawToken);
    const row = this.db.db
      .prepare('SELECT * FROM auth_sessions WHERE token_hash = ?')
      .get(hash) as SessionRecord | undefined;
    if (!row) return null;
    if (row.expires_at <= Date.now()) {
      this.db.db
        .prepare('DELETE FROM auth_sessions WHERE token_hash = ?')
        .run(hash);
      return null;
    }
    this.db.db
      .prepare('UPDATE auth_sessions SET last_seen = ? WHERE token_hash = ?')
      .run(Date.now(), hash);
    return row;
  }

  /**
   * Validate straight from a request-like object (Express request or a raw
   * Node IncomingMessage from a WS upgrade). Returns the session or null.
   */
  validateFromRequest(req: {
    cookies?: Record<string, string>;
    headers?: { cookie?: string };
  }): SessionRecord | null {
    const raw = readSessionCookie(req);
    return raw ? this.validate(raw) : null;
  }

  /** Revoke a single session (logout). */
  destroy(rawToken: string): void {
    this.db.db
      .prepare('DELETE FROM auth_sessions WHERE token_hash = ?')
      .run(hashToken(rawToken));
  }

  /** Revoke every session (e.g. after a password change). */
  destroyAll(): void {
    this.db.db.prepare('DELETE FROM auth_sessions').run();
  }

  /** Best-effort cleanup of expired rows. */
  purgeExpired(): void {
    this.db.db
      .prepare('DELETE FROM auth_sessions WHERE expires_at <= ?')
      .run(Date.now());
  }
}
