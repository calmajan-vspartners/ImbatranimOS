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
import { ClockModule } from '../src/modules/clock/clock.module';
import { SessionService } from '../src/modules/auth/session.service';
import type { Alarm, WorldClock } from '../src/modules/clock/clock.service';

describe('Clock (e2e) — persisted world clocks and alarms', () => {
  let app: INestApplication<Server>;
  let http: ReturnType<typeof request>;
  let cookie: string;

  beforeEach(async () => {
    // A fresh app per test so the in-memory DB starts empty — the import
    // endpoint's whole contract is "only into an empty table".
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule, DbModule, AuthModule, ClockModule],
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

  describe('auth', () => {
    it('rejects every clock route without a session', async () => {
      await http.get('/api/clock/alarms').expect(401);
      await http.get('/api/clock/world-clocks').expect(401);
      await http.post('/api/clock/alarms').send({ time: '07:00' }).expect(401);
      await http.post('/api/clock/import').send({}).expect(401);
      await http
        .patch('/api/clock/alarms/1')
        .send({ enabled: false })
        .expect(401);
      await http.delete('/api/clock/alarms/1').expect(401);
    });
  });

  describe('world clocks', () => {
    it('round-trips, and answers in camelCase', async () => {
      await http
        .get('/api/clock/world-clocks')
        .set('Cookie', cookie)
        .expect(200, []);

      const created = await http
        .post('/api/clock/world-clocks')
        .set('Cookie', cookie)
        .send({ label: 'Tokyo', timeZone: 'Asia/Tokyo' })
        .expect(201);
      const body = created.body as WorldClock;
      expect(typeof body.id).toBe('number');
      // camelCase, not the `time_zone` column name: the mapping happens in the
      // service so no client has to know the schema.
      expect({ label: body.label, timeZone: body.timeZone }).toEqual({
        label: 'Tokyo',
        timeZone: 'Asia/Tokyo',
      });

      const list = await http
        .get('/api/clock/world-clocks')
        .set('Cookie', cookie)
        .expect(200);
      expect(list.body).toHaveLength(1);

      await http
        .delete(`/api/clock/world-clocks/${body.id}`)
        .set('Cookie', cookie)
        .expect(204);
      await http
        .get('/api/clock/world-clocks')
        .set('Cookie', cookie)
        .expect(200, []);
    });

    it('refuses a time zone this system does not know', async () => {
      // The reason this is a 400 and not a shrug: a bogus zone stored here would
      // throw inside Intl.DateTimeFormat on every render in the browser.
      await http
        .post('/api/clock/world-clocks')
        .set('Cookie', cookie)
        .send({ label: 'Nowhere', timeZone: 'Mars/Olympus_Mons' })
        .expect(400);
      await http
        .post('/api/clock/world-clocks')
        .set('Cookie', cookie)
        .send({ label: 'Nowhere', timeZone: '../../etc/passwd' })
        .expect(400);
    });

    it('404s on deleting something that is not there', async () => {
      await http
        .delete('/api/clock/world-clocks/9999')
        .set('Cookie', cookie)
        .expect(404);
    });
  });

  describe('alarms', () => {
    it('creates with sensible defaults', async () => {
      const res = await http
        .post('/api/clock/alarms')
        .set('Cookie', cookie)
        .send({ time: '07:00' })
        .expect(201);
      const alarm = res.body as Alarm;
      expect(typeof alarm.id).toBe('number');
      // Enabled, no repeat, never fired, not snoozed — a plain one-shot alarm.
      expect({ ...alarm, id: 0 }).toEqual({
        id: 0,
        label: '',
        time: '07:00',
        enabled: true,
        days: '0000000',
        lastFiredAt: null,
        snoozedUntil: null,
      });
    });

    it('rejects a malformed time or day mask', async () => {
      for (const time of ['7:00', '25:00', '07:60', 'noon', '07:00:00', '']) {
        await http
          .post('/api/clock/alarms')
          .set('Cookie', cookie)
          .send({ time })
          .expect(400);
      }
      await http
        .post('/api/clock/alarms')
        .set('Cookie', cookie)
        .send({ time: '07:00', days: '111110' })
        .expect(400);
      await http
        .post('/api/clock/alarms')
        .set('Cookie', cookie)
        .send({ time: '07:00', days: 'MTWTF..' })
        .expect(400);
    });

    it('patches the fields the ringing client writes back', async () => {
      const created = await http
        .post('/api/clock/alarms')
        .set('Cookie', cookie)
        .send({ time: '07:00', label: 'Wake up', days: '1111100' })
        .expect(201);
      const { id } = created.body as Alarm;

      const rang = await http
        .patch(`/api/clock/alarms/${id}`)
        .set('Cookie', cookie)
        .send({ lastFiredAt: 'Mon Jul 20 2026 07:00', snoozedUntil: null })
        .expect(200);
      expect(rang.body).toMatchObject({
        lastFiredAt: 'Mon Jul 20 2026 07:00',
        snoozedUntil: null,
        enabled: true,
        days: '1111100',
      });

      const snoozed = await http
        .patch(`/api/clock/alarms/${id}`)
        .set('Cookie', cookie)
        .send({ enabled: true, snoozedUntil: 1800000300000 })
        .expect(200);
      expect(snoozed.body).toMatchObject({ snoozedUntil: 1800000300000 });

      // null must clear the snooze rather than being ignored as falsy.
      const cleared = await http
        .patch(`/api/clock/alarms/${id}`)
        .set('Cookie', cookie)
        .send({ snoozedUntil: null })
        .expect(200);
      expect((cleared.body as Alarm).snoozedUntil).toBeNull();

      const off = await http
        .patch(`/api/clock/alarms/${id}`)
        .set('Cookie', cookie)
        .send({ enabled: false })
        .expect(200);
      expect((off.body as Alarm).enabled).toBe(false);
    });

    it('sorts by time of day', async () => {
      for (const time of ['22:30', '06:05', '13:00']) {
        await http
          .post('/api/clock/alarms')
          .set('Cookie', cookie)
          .send({ time })
          .expect(201);
      }
      const list = await http
        .get('/api/clock/alarms')
        .set('Cookie', cookie)
        .expect(200);
      expect((list.body as Alarm[]).map((a) => a.time)).toEqual([
        '06:05',
        '13:00',
        '22:30',
      ]);
    });

    it('404s on patching or deleting something that is not there', async () => {
      await http
        .patch('/api/clock/alarms/9999')
        .set('Cookie', cookie)
        .send({ enabled: false })
        .expect(404);
      await http
        .delete('/api/clock/alarms/9999')
        .set('Cookie', cookie)
        .expect(404);
    });
  });

  describe('one-time localStorage import', () => {
    const payload = {
      worldClocks: [{ label: 'Tokyo', timeZone: 'Asia/Tokyo' }],
      alarms: [
        { label: 'Wake up', time: '07:00', enabled: true },
        { label: '', time: '18:30', enabled: false },
      ],
    };

    it('adopts the old state and marks the alarms as daily', async () => {
      const res = await http
        .post('/api/clock/import')
        .set('Cookie', cookie)
        .send(payload)
        .expect(201);
      expect(res.body).toEqual({ imported: true, worldClocks: 1, alarms: 2 });

      const alarms = await http
        .get('/api/clock/alarms')
        .set('Cookie', cookie)
        .expect(200);
      // They rang every day before repeat existed; importing them as one-shots
      // would silently change what the user had.
      expect(
        (alarms.body as Alarm[]).map((a) => [a.time, a.days, a.enabled]),
      ).toEqual([
        ['07:00', '1111111', true],
        ['18:30', '1111111', false],
      ]);
    });

    it('is idempotent: a second import adds nothing', async () => {
      await http
        .post('/api/clock/import')
        .set('Cookie', cookie)
        .send(payload)
        .expect(201);
      const again = await http
        .post('/api/clock/import')
        .set('Cookie', cookie)
        .send(payload)
        .expect(201);
      expect(again.body).toEqual({
        imported: false,
        worldClocks: 0,
        alarms: 0,
      });

      const alarms = await http
        .get('/api/clock/alarms')
        .set('Cookie', cookie)
        .expect(200);
      expect(alarms.body).toHaveLength(2);
    });

    it('does not import into a table that already has rows', async () => {
      await http
        .post('/api/clock/alarms')
        .set('Cookie', cookie)
        .send({ time: '05:00' })
        .expect(201);
      const res = await http
        .post('/api/clock/import')
        .set('Cookie', cookie)
        .send(payload)
        .expect(201);
      // The world clocks table was still empty, so that half went in; the alarms
      // table was not, so it was left alone.
      expect(res.body).toEqual({ imported: true, worldClocks: 1, alarms: 0 });
      const alarms = await http
        .get('/api/clock/alarms')
        .set('Cookie', cookie)
        .expect(200);
      expect(alarms.body).toHaveLength(1);
    });

    it('accepts an empty payload and rejects a malformed one', async () => {
      await http
        .post('/api/clock/import')
        .set('Cookie', cookie)
        .send({})
        .expect(201, { imported: false, worldClocks: 0, alarms: 0 });
      await http
        .post('/api/clock/import')
        .set('Cookie', cookie)
        .send({ alarms: [{ time: 'noon' }] })
        .expect(400);
      await http
        .post('/api/clock/import')
        .set('Cookie', cookie)
        .send({ worldClocks: [{ label: 'x', timeZone: 'Mars/Base' }] })
        .expect(400);
    });
  });
});
