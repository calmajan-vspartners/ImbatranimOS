import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SessionAuthGuard } from './auth.guard';
import { SessionService } from './session.service';
import { DbService } from '../../db/db.service';
import { SESSION_COOKIE_NAME } from './auth.constants';
import { makeConfig, makeTestDb } from './test-utils';

function ctxFor(
  req: unknown,
  res: unknown = { cookie: () => undefined },
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe('SessionAuthGuard', () => {
  let db: DbService;
  let sessions: SessionService;
  let reflector: Reflector;
  let guard: SessionAuthGuard;
  let isPublic: boolean;

  beforeEach(() => {
    db = makeTestDb();
    sessions = new SessionService(db, makeConfig());
    isPublic = false;
    reflector = { getAllAndOverride: () => isPublic } as unknown as Reflector;
    guard = new SessionAuthGuard(reflector, sessions, makeConfig());
  });

  it('rejects a protected route with no session (401)', () => {
    expect(() =>
      guard.canActivate(ctxFor({ method: 'GET', headers: {} })),
    ).toThrow(UnauthorizedException);
  });

  it('allows a protected route with a valid session cookie', () => {
    const { token } = sessions.issue();
    const req = {
      method: 'GET',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    };
    expect(guard.canActivate(ctxFor(req))).toBe(true);
  });

  it('allows a @Public route with no session', () => {
    isPublic = true;
    expect(guard.canActivate(ctxFor({ method: 'POST', headers: {} }))).toBe(
      true,
    );
  });

  describe('sliding expiry re-issues the cookie (brief 101)', () => {
    const HOUR = 3600_000;

    it('sets the cookie with the new maxAge when the session slid', () => {
      const { token } = sessions.issue();
      // Age it past the 1h write threshold so the guard's renew fires.
      db.db
        .prepare('UPDATE auth_sessions SET expires_at = expires_at - ?')
        .run(2 * HOUR);
      const set: unknown[][] = [];
      const res = { cookie: (...args: unknown[]) => set.push(args) };
      const req = {
        method: 'GET',
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
        secure: false,
      };
      expect(guard.canActivate(ctxFor(req, res))).toBe(true);
      expect(set).toHaveLength(1);
      const [name, value, opts] = set[0] as [
        string,
        string,
        { maxAge: number; httpOnly: boolean; sameSite: string },
      ];
      // Same token, fresh Max-Age: without the re-issue the browser drops the
      // cookie at the ORIGINAL TTL and the server-side slide is theater.
      expect(name).toBe(SESSION_COOKIE_NAME);
      expect(value).toBe(token);
      expect(opts.httpOnly).toBe(true);
      expect(opts.sameSite).toBe('lax');
      expect(opts.maxAge).toBeGreaterThan(167 * HOUR);
    });

    it('sets no cookie when the slide would gain under an hour', () => {
      const { token } = sessions.issue();
      const set: unknown[][] = [];
      const res = { cookie: (...args: unknown[]) => set.push(args) };
      const req = {
        method: 'GET',
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
        secure: false,
      };
      expect(guard.canActivate(ctxFor(req, res))).toBe(true);
      expect(set).toHaveLength(0);
    });
  });

  it('attaches the validated session to the request', () => {
    const { token } = sessions.issue();
    const req: {
      method: string;
      headers: Record<string, string>;
      session?: unknown;
    } = {
      method: 'GET',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    };
    guard.canActivate(ctxFor(req));
    expect(req.session).toBeDefined();
  });

  describe('CSRF origin check', () => {
    it('rejects a cross-origin mutating request', () => {
      isPublic = true; // even public routes are origin-checked
      const req = {
        method: 'POST',
        headers: { origin: 'http://evil.example', host: 'localhost:3001' },
      };
      expect(() => guard.canActivate(ctxFor(req))).toThrow(ForbiddenException);
    });

    it('allows a same-host mutating request', () => {
      isPublic = true;
      const req = {
        method: 'POST',
        headers: { origin: 'http://localhost:3001', host: 'localhost:3001' },
      };
      expect(guard.canActivate(ctxFor(req))).toBe(true);
    });

    it('allows the configured FRONTEND_URL origin (dev cross-port)', () => {
      isPublic = true;
      const req = {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', host: 'localhost:3001' },
      };
      expect(guard.canActivate(ctxFor(req))).toBe(true);
    });

    it('allows a GET with no Origin header', () => {
      isPublic = true;
      expect(guard.canActivate(ctxFor({ method: 'GET', headers: {} }))).toBe(
        true,
      );
    });
  });
});
