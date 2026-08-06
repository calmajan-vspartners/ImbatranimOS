// In-memory DB so this e2e never touches a real file. Must be set before the
// AppModule (and its config validation) is imported.
process.env.DB_PATH = ':memory:';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { Server } from 'http';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { securityHeaders } from '../src/security-headers';

/**
 * Verifies the hardening added in Brief 15: the hand-rolled security-headers
 * middleware, and the adversarial auth-surface edges (HEAD/OPTIONS, unknown
 * /api paths, the public /health handler).
 */
describe('Security hardening (e2e)', () => {
  let app: INestApplication<Server>;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirror main.ts bootstrap order: security headers first, then the rest.
    app.use(securityHeaders);
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    // Re-create the /health handler main.ts registers outside the api prefix.
    app
      .getHttpAdapter()
      .get('/health', (_req: unknown, res: { json: (d: unknown) => void }) =>
        res.json({ status: 'ok' }),
      );
    await app.init();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  describe('security headers', () => {
    it('sets nosniff / frame-deny / referrer / CSP on responses', async () => {
      const res = await http.get('/api/auth/status').expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      const csp = res.headers['content-security-policy'];
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      // Fonts are vendored and served from 'self' — no Google Fonts origin is
      // whitelisted, so the offline kiosk / air-gapped LAN renders its real
      // fonts with no external fetch and leaks no visitor IP to Google.
      expect(csp).not.toContain('fonts.googleapis.com');
      expect(csp).not.toContain('fonts.gstatic.com');
      expect(csp).toContain("font-src 'self'");
      expect(csp).toMatch(/style-src 'self' 'unsafe-inline'(;|$)/);
      // connect-src is scoped to same-origin only (SEC-9): 'self' covers the
      // terminal ws/wss on the page's own origin per CSP3, and the bare
      // ws:/wss: wildcards are gone so an XSS can't open a socket off-origin.
      expect(csp).toContain('connect-src');
      expect(csp).toMatch(/connect-src 'self'(;|$)/);
      expect(csp).not.toMatch(/connect-src[^;]*\bwss?:/);
    });

    it('does NOT set HSTS in-app (that is the reverse proxy job)', async () => {
      const res = await http.get('/api/auth/status').expect(200);
      expect(res.headers['strict-transport-security']).toBeUndefined();
    });
  });

  describe('auth surface edges', () => {
    it('rejects a HEAD request to a protected route (guard runs on HEAD)', async () => {
      await http.head('/api/todos').expect(401);
    });

    it('returns 404 (not the SPA / not 401) for an unknown /api path', async () => {
      await http.get('/api/nope/not/a/route').expect(404);
    });

    it('serves the public /health handler without a session', async () => {
      const res = await http.get('/health').expect(200);
      expect(res.body).toEqual({ status: 'ok' });
    });

    it('keeps /health free of the api guard even with a bogus cookie', async () => {
      await http
        .get('/health')
        .set('Cookie', 'imb_session=garbage')
        .expect(200);
    });
  });
});
