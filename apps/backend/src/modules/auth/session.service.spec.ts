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
