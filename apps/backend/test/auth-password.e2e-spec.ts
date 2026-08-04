// In-memory DB so the e2e never touches a real file. Must be set before the
// AppModule (and its config validation) is imported.
process.env.DB_PATH = ':memory:';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { Server } from 'http';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from './../src/app.module';

const OLD_PASSWORD = 'correct-horse-battery-staple';
const NEW_PASSWORD = 'a-completely-different-secret';

/**
 * `POST /auth/password` — brief 57.
 *
 * A separate spec from `auth.e2e-spec.ts` on purpose: that one finishes by
 * deliberately tripping the login throttle, and this one needs an unlocked IP to
 * assert the route's own behaviour.
 *
 * The two properties only an end-to-end test can establish are the ones this spec
 * exists for: that **other** sessions really are evicted, and that the caller's is
 * not — those live in the controller (cookie re-issue plus `destroyAll`), not in
 * the service.
 */
describe('Change password (e2e)', () => {
  let app: INestApplication<Server>;
  let http: ReturnType<typeof request>;

  const firstCookie = (res: request.Response): string =>
    ([] as string[]).concat(res.headers['set-cookie'])[0];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  let ownerCookie: string;
  /** A second signed-in browser, created BEFORE the change. */
  let otherCookie: string;

  it('requires authentication — the route is not public', async () => {
    // Before setup there is no session at all, so this also proves the global
    // guard covers the route rather than it being reachable pre-account.
    await http
      .post('/api/auth/password')
      .send({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD })
      .expect(401);
  });

  it('sets up the account and opens two sessions', async () => {
    ownerCookie = firstCookie(
      await http
        .post('/api/auth/setup')
        .send({ password: OLD_PASSWORD })
        .expect(201),
    );
    otherCookie = firstCookie(
      await http
        .post('/api/auth/login')
        .send({ password: OLD_PASSWORD })
        .expect(200),
    );
    expect(ownerCookie).toContain('imb_session=');
    expect(otherCookie).toContain('imb_session=');
    expect(otherCookie).not.toBe(ownerCookie);
    // Both are live to begin with — otherwise the eviction assertion below would
    // pass for the wrong reason.
    await http.get('/api/todos').set('Cookie', ownerCookie).expect(200);
    await http.get('/api/todos').set('Cookie', otherCookie).expect(200);
  });

  it('rejects a wrong current password (401) and changes nothing', async () => {
    await http
      .post('/api/auth/password')
      .set('Cookie', ownerCookie)
      .send({ currentPassword: 'not-the-password', newPassword: NEW_PASSWORD })
      .expect(401);
    // Neither session was dropped by the failed attempt: signing everyone out on a
    // FAILED change would be a denial of service anyone with a session could
    // trigger.
    await http.get('/api/todos').set('Cookie', ownerCookie).expect(200);
    await http.get('/api/todos').set('Cookie', otherCookie).expect(200);
  });

  it('rejects a too-short new password (400) via the DTO', async () => {
    await http
      .post('/api/auth/password')
      .set('Cookie', ownerCookie)
      .send({ currentPassword: OLD_PASSWORD, newPassword: 'short' })
      .expect(400);
  });

  it('rejects a no-op change (400)', async () => {
    await http
      .post('/api/auth/password')
      .set('Cookie', ownerCookie)
      .send({ currentPassword: OLD_PASSWORD, newPassword: OLD_PASSWORD })
      .expect(400);
  });

  let rotatedCookie: string;

  it('changes the password and issues the caller a fresh session', async () => {
    const res = await http
      .post('/api/auth/password')
      .set('Cookie', ownerCookie)
      .send({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD })
      .expect(200);
    expect(res.body).toEqual({ ok: true });
    rotatedCookie = firstCookie(res);
    expect(rotatedCookie).toContain('imb_session=');
    expect(rotatedCookie.toLowerCase()).toContain('httponly');
    // A genuinely new token, not the one that was sent in.
    expect(rotatedCookie).not.toBe(ownerCookie);
  });

  it('the caller stays signed in on the new cookie', async () => {
    await http.get('/api/todos').set('Cookie', rotatedCookie).expect(200);
  });

  it('EVERY pre-change session is dead, including the caller old one', async () => {
    // The point of a rotation is usually that a credential may have leaked, and the
    // caller's own pre-change token is as plausibly leaked as any other.
    await http.get('/api/todos').set('Cookie', otherCookie).expect(401);
    await http.get('/api/todos').set('Cookie', ownerCookie).expect(401);
  });

  it('the old password no longer logs in, and the new one does', async () => {
    await http
      .post('/api/auth/login')
      .send({ password: OLD_PASSWORD })
      .expect(401);
    await http
      .post('/api/auth/login')
      .send({ password: NEW_PASSWORD })
      .expect(200);
  });

  it('throttles repeated wrong current passwords (eventually 429)', async () => {
    // The route re-verifies the current password, which makes it an oracle for it.
    // Without sharing login's counter, a stolen session could brute-force the
    // password from inside the OS while the lock screen stayed protected.
    const fresh = firstCookie(
      await http
        .post('/api/auth/login')
        .send({ password: NEW_PASSWORD })
        .expect(200),
    );
    let saw429 = false;
    for (let i = 0; i < 14; i++) {
      const res = await http
        .post('/api/auth/password')
        .set('Cookie', fresh)
        .send({
          currentPassword: 'wrong-guess-here',
          newPassword: 'another-new-secret',
        });
      if (res.status === 429) {
        saw429 = true;
        break;
      }
      expect(res.status).toBe(401);
    }
    expect(saw429).toBe(true);
  });
});
