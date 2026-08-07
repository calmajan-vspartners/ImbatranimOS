import { SessionService } from './session.service';
import { DbService } from '../../db/db.service';
import { SESSION_COOKIE_NAME, parseCookieHeader } from './auth.constants';
import { makeConfig, makeTestDb } from './test-utils';

describe('SessionService', () => {
  let db: DbService;
  let sessions: SessionService;

  beforeEach(() => {
    db = makeTestDb();
    sessions = new SessionService(db, makeConfig());
  });

  it('issues a token that validates', () => {
    const { token } = sessions.issue();
    expect(sessions.validate(token)).not.toBeNull();
  });

  it('rejects unknown and destroyed tokens', () => {
    expect(sessions.validate('not-a-real-token')).toBeNull();
    const { token } = sessions.issue();
    sessions.destroy(token);
    expect(sessions.validate(token)).toBeNull();
  });

  it('stores only the token hash, never the raw token', () => {
    const { token } = sessions.issue();
    const row = db.db.prepare('SELECT token_hash FROM auth_sessions').get() as {
      token_hash: string;
    };
    expect(row.token_hash).not.toBe(token);
    expect(row.token_hash).toHaveLength(64); // sha256 hex
  });

  it('treats an expired session as invalid and prunes it', () => {
    const expired = makeConfig({ SESSION_TTL_HOURS: -1 });
    const s = new SessionService(db, expired);
    const { token } = s.issue();
    expect(s.validate(token)).toBeNull();
    const count = db.db
      .prepare('SELECT COUNT(*) c FROM auth_sessions')
      .get() as { c: number };
    expect(count.c).toBe(0);
  });

  describe('renewIfDue (brief 101 — sliding expiry with an absolute cap)', () => {
    const HOUR = 3600_000;

    function rowFor(token: string) {
      return sessions.validate(token)!;
    }

    it('extends expires_at and returns the new cookie maxAge', () => {
      const { token } = sessions.issue();
      // Age the session so the slide gains more than the 1h write threshold.
      db.db
        .prepare('UPDATE auth_sessions SET expires_at = expires_at - ?')
        .run(2 * HOUR);
      const before = rowFor(token).expires_at;
      const renewed = sessions.renewIfDue(rowFor(token), token);
      expect(renewed).not.toBeNull();
      expect(rowFor(token).expires_at).toBeGreaterThan(before);
      // The cookie must live exactly until the new expiry.
      expect(renewed!.maxAgeMs).toBeCloseTo(
        rowFor(token).expires_at - Date.now(),
        -3,
      );
    });

    it('skips sub-hour gains — the self-throttle', () => {
      const { token } = sessions.issue();
      // A fresh session already expires at ~now+TTL; sliding gains ~0.
      expect(sessions.renewIfDue(rowFor(token), token)).toBeNull();
    });

    it('caps at created_at + SESSION_ABSOLUTE_MAX_HOURS', () => {
      const capped = new SessionService(
        db,
        makeConfig({ SESSION_TTL_HOURS: 168, SESSION_ABSOLUTE_MAX_HOURS: 168 }),
      );
      const { token } = capped.issue();
      // Age the row far enough that an uncapped slide would gain days.
      db.db
        .prepare('UPDATE auth_sessions SET expires_at = expires_at - ?')
        .run(72 * HOUR);
      const row = capped.validate(token)!;
      const renewed = capped.renewIfDue(row, token);
      expect(renewed).not.toBeNull();
      const after = capped.validate(token)!;
      expect(after.expires_at).toBeLessThanOrEqual(
        after.created_at + 168 * HOUR,
      );
    });

    it('clamps a ceiling mis-set below the TTL up to the TTL', () => {
      const misSet = new SessionService(
        db,
        makeConfig({ SESSION_TTL_HOURS: 168, SESSION_ABSOLUTE_MAX_HOURS: 1 }),
      );
      const { token } = misSet.issue();
      db.db
        .prepare('UPDATE auth_sessions SET expires_at = expires_at - ?')
        .run(2 * HOUR);
      const renewed = misSet.renewIfDue(misSet.validate(token)!, token);
      // With the clamp the cap is created_at + TTL, which still allows a slide
      // for a young session; without it the session would be born over-cap.
      expect(renewed).not.toBeNull();
    });

    it('plain validate never writes expires_at — the pty sweep stays renewal-free', () => {
      const { token } = sessions.issue();
      db.db
        .prepare('UPDATE auth_sessions SET expires_at = expires_at - ?')
        .run(2 * HOUR);
      const before = rowFor(token).expires_at;
      // Many validates, as the 30s sweep would issue.
      for (let i = 0; i < 5; i++) sessions.validate(token);
      expect(rowFor(token).expires_at).toBe(before);
    });
  });

  it('destroyAll revokes every session', () => {
    sessions.issue();
    sessions.issue();
    sessions.destroyAll();
    const count = db.db
      .prepare('SELECT COUNT(*) c FROM auth_sessions')
      .get() as { c: number };
    expect(count.c).toBe(0);
  });

  // This is the exact path a WebSocket upgrade handler uses (Brief 10 handoff).
  describe('validateFromRequest (WS handshake surface)', () => {
    it('validates a raw Cookie header (no cookie-parser)', () => {
      const { token } = sessions.issue();
      const req = { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } };
      expect(sessions.validateFromRequest(req)).not.toBeNull();
    });

    it('reads a cookie-parser populated .cookies map', () => {
      const { token } = sessions.issue();
      const req = { cookies: { [SESSION_COOKIE_NAME]: token }, headers: {} };
      expect(sessions.validateFromRequest(req)).not.toBeNull();
    });

    it('returns null when the cookie is absent', () => {
      expect(sessions.validateFromRequest({ headers: {} })).toBeNull();
    });
  });

  describe('parseCookieHeader (malformed-value tolerance)', () => {
    it('does not throw on a malformed percent-escape and keeps the raw value', () => {
      // A stray `%` (e.g. from an unrelated cookie on the domain) makes
      // decodeURIComponent throw URIError. Unguarded, that 500'd every response
      // including the public /api/auth/status. It must fall back to the raw
      // value and still parse the other cookies.
      const parsed = parseCookieHeader('bad=%E0%A4%A; imb_session=abc123');
      expect(parsed.bad).toBe('%E0%A4%A');
      expect(parsed.imb_session).toBe('abc123');
    });

    it('still percent-decodes a well-formed value', () => {
      expect(parseCookieHeader('k=a%20b').k).toBe('a b');
    });
  });
});
