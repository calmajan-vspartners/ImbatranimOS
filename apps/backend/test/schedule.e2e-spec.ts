// In-memory DB so this e2e never touches real data.
process.env.DB_PATH = ':memory:';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { Server } from 'http';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { ConfigModule } from '../src/config/config.module';
import { DbModule } from '../src/db/db.module';
import { AuthModule } from '../src/modules/auth/auth.module';
import { ScheduleModule } from '../src/modules/schedule/schedule.module';
import { SessionService } from '../src/modules/auth/session.service';

describe('Schedule claims (e2e) — brief 93', () => {
  let app: INestApplication<Server>;
  let http: ReturnType<typeof request>;
  let cookie: string;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule, DbModule, AuthModule, ScheduleModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    http = request(app.getHttpServer());
    cookie = `imb_session=${app.get(SessionService).issue().token}`;
  });

  afterEach(async () => {
    await app.close();
  });

  const claim = (body: Record<string, unknown>) =>
    http.post('/api/schedule/claim').set('Cookie', cookie).send(body);

  it('rejects the route without a session', async () => {
    await http
      .post('/api/schedule/claim')
      .send({ domain: 'clock', itemId: '1', occurrenceMs: 1 })
      .expect(401);
  });

  it('first claim wins, the rerun loses — the cross-tab tiebreak', async () => {
    const body = { domain: 'clock', itemId: '4', occurrenceMs: 1754400000000 };
    const first = await claim(body).expect(200);
    expect(first.body).toEqual({ claimed: true });
    const second = await claim(body).expect(200);
    expect(second.body).toEqual({ claimed: false });
  });

  it('refuses an unknown domain and a malformed occurrence', async () => {
    await claim({ domain: 'weather', itemId: '1', occurrenceMs: 1 }).expect(
      400,
    );
    await claim({ domain: 'clock', itemId: '1', occurrenceMs: -5 }).expect(400);
    await claim({ domain: 'clock', itemId: '1', occurrenceMs: 1.5 }).expect(
      400,
    );
  });
});
