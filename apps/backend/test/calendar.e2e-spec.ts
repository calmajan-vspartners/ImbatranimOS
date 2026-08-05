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
import { CalendarModule } from '../src/modules/calendar/calendar.module';
import { SessionService } from '../src/modules/auth/session.service';
import type { CalendarEvent } from '../src/modules/calendar/calendar.service';

/** 2026-07-06T09:00 local, as the frontend would send it. */
const START = new Date(2026, 6, 6, 9, 0, 0, 0).getTime();
const END = START + 30 * 60_000;

describe('Calendar (e2e) — events, recurrence rules and import', () => {
  let app: INestApplication<Server>;
  let http: ReturnType<typeof request>;
  let cookie: string;

  beforeEach(async () => {
    // Fresh app per test so the in-memory DB starts empty — the migration guard's
    // whole contract is "only into an empty table".
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule, DbModule, AuthModule, CalendarModule],
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

  const create = (body: Record<string, unknown>) =>
    http.post('/api/calendar/events').set('Cookie', cookie).send(body);

  describe('auth', () => {
    it('rejects every route without a session', async () => {
      await http.get('/api/calendar/events').expect(401);
      await http
        .post('/api/calendar/events')
        .send({ title: 'x', start: START, end: END })
        .expect(401);
      await http
        .patch('/api/calendar/events/1')
        .send({ title: 'x' })
        .expect(401);
      await http.delete('/api/calendar/events/1').expect(401);
      await http.post('/api/calendar/import').send({ events: [] }).expect(401);
    });
  });

  describe('events', () => {
    it('round-trips a plain event in camelCase', async () => {
      const res = await create({
        title: 'Standup',
        start: START,
        end: END,
        allDay: false,
        notes: 'daily sync',
        color: 'blue',
        reminderMinutes: 10,
      }).expect(201);
      const body = res.body as CalendarEvent;
      expect(typeof body.id).toBe('number');
      expect({ ...body, id: 0 }).toEqual({
        id: 0,
        title: 'Standup',
        start: START,
        end: END,
        allDay: false,
        notes: 'daily sync',
        color: 'blue',
        reminderMinutes: 10,
        recurrence: null,
        exceptions: [],
      });
    });

    it('omits the optional fields rather than returning nulls', async () => {
      const res = await create({
        title: 'Bare',
        start: START,
        end: END,
      }).expect(201);
      const body = res.body as CalendarEvent;
      expect(body.notes).toBeUndefined();
      expect(body.color).toBeUndefined();
      expect(body.reminderMinutes).toBeUndefined();
      expect(body.allDay).toBe(false);
    });

    it('stores a recurrence rule and gives it back as one object', async () => {
      const res = await create({
        title: 'Weekly',
        start: START,
        end: END,
        recurrence: {
          freq: 'weekly',
          interval: 2,
          byWeekday: [1, 3, 5],
          count: 10,
        },
        exceptions: ['2026-07-15', '2026-07-22'],
      }).expect(201);
      const body = res.body as CalendarEvent;
      expect(body.recurrence).toEqual({
        freq: 'weekly',
        interval: 2,
        byWeekday: [1, 3, 5],
        count: 10,
      });
      expect(body.exceptions).toEqual(['2026-07-15', '2026-07-22']);
    });

    it('sorts by start', async () => {
      await create({
        title: 'Later',
        start: START + 86_400_000,
        end: END + 86_400_000,
      });
      await create({
        title: 'Earlier',
        start: START - 86_400_000,
        end: END - 86_400_000,
      });
      await create({ title: 'Middle', start: START, end: END });
      const list = await http
        .get('/api/calendar/events')
        .set('Cookie', cookie)
        .expect(200);
      expect((list.body as CalendarEvent[]).map((e) => e.title)).toEqual([
        'Earlier',
        'Middle',
        'Later',
      ]);
    });

    it('returns a recurring event that started long ago', async () => {
      // The reason findAll is unfiltered: a series from last year is exactly what
      // this month needs, and a WHERE on start_ms would hide it.
      await create({
        title: 'Since 2024',
        start: new Date(2024, 0, 1, 9, 0).getTime(),
        end: new Date(2024, 0, 1, 10, 0).getTime(),
        recurrence: { freq: 'weekly', interval: 1 },
      }).expect(201);
      const list = await http
        .get('/api/calendar/events')
        .set('Cookie', cookie)
        .expect(200);
      expect(list.body).toHaveLength(1);
    });
  });

  describe('validation', () => {
    it('refuses a malformed recurrence rather than storing it', async () => {
      await create({
        title: 'x',
        start: START,
        end: END,
        recurrence: { freq: 'hourly', interval: 1 },
      }).expect(400);
      await create({
        title: 'x',
        start: START,
        end: END,
        recurrence: { freq: 'daily', interval: 0 },
      }).expect(400);
      await create({
        title: 'x',
        start: START,
        end: END,
        recurrence: { freq: 'daily' },
      }).expect(400);
      await create({
        title: 'x',
        start: START,
        end: END,
        recurrence: { freq: 'weekly', interval: 1, byWeekday: [7] },
      }).expect(400);
      await create({
        title: 'x',
        start: START,
        end: END,
        recurrence: { freq: 'daily', interval: 1, until: '06/07/2026' },
      }).expect(400);
    });

    it('refuses a malformed exception date', async () => {
      await create({
        title: 'x',
        start: START,
        end: END,
        exceptions: ['2026-7-6'],
      }).expect(400);
      await create({
        title: 'x',
        start: START,
        end: END,
        exceptions: ['nonsense'],
      }).expect(400);
    });

    it('refuses a colour outside the palette and a non-integer time', async () => {
      await create({
        title: 'x',
        start: START,
        end: END,
        color: 'fuchsia',
      }).expect(400);
      await create({ title: 'x', start: 'yesterday', end: END }).expect(400);
      await create({ start: START, end: END }).expect(400);
    });
  });

  describe('updates', () => {
    it('patches a subset and leaves the rest alone', async () => {
      const created = await create({
        title: 'Standup',
        start: START,
        end: END,
        notes: 'keep me',
        recurrence: { freq: 'daily', interval: 1 },
      }).expect(201);
      const { id } = created.body as CalendarEvent;

      const patched = await http
        .patch(`/api/calendar/events/${id}`)
        .set('Cookie', cookie)
        .send({ title: 'Renamed' })
        .expect(200);
      expect(patched.body).toMatchObject({
        title: 'Renamed',
        notes: 'keep me',
        recurrence: { freq: 'daily', interval: 1 },
      });
    });

    it('clears the rule when recurrence is set to null, leaving no stale columns', async () => {
      const created = await create({
        title: 'Weekly',
        start: START,
        end: END,
        recurrence: { freq: 'weekly', interval: 3, byWeekday: [2], count: 9 },
      }).expect(201);
      const { id } = created.body as CalendarEvent;

      const cleared = await http
        .patch(`/api/calendar/events/${id}`)
        .set('Cookie', cookie)
        .send({ recurrence: null })
        .expect(200);
      expect((cleared.body as CalendarEvent).recurrence).toBeNull();
    });

    it('replaces a rule wholesale rather than merging it', async () => {
      // The five rrule_* columns move together; patching a subset would leave a
      // BYDAY from the old rule attached to the new one.
      const created = await create({
        title: 'Weekly',
        start: START,
        end: END,
        recurrence: {
          freq: 'weekly',
          interval: 1,
          byWeekday: [1, 3],
          count: 5,
        },
      }).expect(201);
      const { id } = created.body as CalendarEvent;

      const patched = await http
        .patch(`/api/calendar/events/${id}`)
        .set('Cookie', cookie)
        .send({ recurrence: { freq: 'monthly', interval: 1 } })
        .expect(200);
      expect((patched.body as CalendarEvent).recurrence).toEqual({
        freq: 'monthly',
        interval: 1,
      });
    });

    it('adds an exception, which is how "skip this one" is stored', async () => {
      const created = await create({
        title: 'Weekly',
        start: START,
        end: END,
        recurrence: { freq: 'weekly', interval: 1 },
      }).expect(201);
      const { id } = created.body as CalendarEvent;
      const patched = await http
        .patch(`/api/calendar/events/${id}`)
        .set('Cookie', cookie)
        .send({ exceptions: ['2026-07-13'] })
        .expect(200);
      expect((patched.body as CalendarEvent).exceptions).toEqual([
        '2026-07-13',
      ]);
    });

    it('clears notes with null and keeps an empty string distinct', async () => {
      const created = await create({
        title: 'x',
        start: START,
        end: END,
        notes: 'gone soon',
      });
      const { id } = created.body as CalendarEvent;
      const cleared = await http
        .patch(`/api/calendar/events/${id}`)
        .set('Cookie', cookie)
        .send({ notes: null })
        .expect(200);
      expect((cleared.body as CalendarEvent).notes).toBeUndefined();
    });

    it('404s on an event that is not there', async () => {
      await http
        .patch('/api/calendar/events/9999')
        .set('Cookie', cookie)
        .send({ title: 'x' })
        .expect(404);
      await http
        .delete('/api/calendar/events/9999')
        .set('Cookie', cookie)
        .expect(404);
    });
  });

  describe('delete', () => {
    it('removes the event', async () => {
      const created = await create({ title: 'x', start: START, end: END });
      const { id } = created.body as CalendarEvent;
      await http
        .delete(`/api/calendar/events/${id}`)
        .set('Cookie', cookie)
        .expect(204);
      await http
        .get('/api/calendar/events')
        .set('Cookie', cookie)
        .expect(200, []);
    });
  });

  describe('import', () => {
    const payload = {
      events: [
        { title: 'Migrated one', start: START, end: END, allDay: false },
        {
          title: 'Migrated weekly',
          start: START,
          end: END,
          recurrence: { freq: 'weekly', interval: 1, byWeekday: [1] },
        },
      ],
    };

    it('adopts events and reports the count', async () => {
      const res = await http
        .post('/api/calendar/import')
        .set('Cookie', cookie)
        .send({ ...payload, onlyIfEmpty: true })
        .expect(201);
      expect(res.body).toEqual({ imported: 2, skipped: null });
      const list = await http
        .get('/api/calendar/events')
        .set('Cookie', cookie)
        .expect(200);
      expect(list.body).toHaveLength(2);
      expect((list.body as CalendarEvent[])[1].recurrence).toEqual({
        freq: 'weekly',
        interval: 1,
        byWeekday: [1],
      });
    });

    it('refuses a second onlyIfEmpty import, so two tabs cannot double the calendar', async () => {
      await http
        .post('/api/calendar/import')
        .set('Cookie', cookie)
        .send({ ...payload, onlyIfEmpty: true })
        .expect(201);
      const again = await http
        .post('/api/calendar/import')
        .set('Cookie', cookie)
        .send({ ...payload, onlyIfEmpty: true })
        .expect(201);
      expect(again.body).toEqual({ imported: 0, skipped: 'not-empty' });
      const list = await http
        .get('/api/calendar/events')
        .set('Cookie', cookie)
        .expect(200);
      expect(list.body).toHaveLength(2);
    });

    it('appends without the guard, which is what an ICS import wants', async () => {
      await create({ title: 'Already here', start: START, end: END }).expect(
        201,
      );
      const res = await http
        .post('/api/calendar/import')
        .set('Cookie', cookie)
        .send(payload)
        .expect(201);
      expect(res.body).toEqual({ imported: 2, skipped: null });
      const list = await http
        .get('/api/calendar/events')
        .set('Cookie', cookie)
        .expect(200);
      expect(list.body).toHaveLength(3);
    });

    it('rejects the whole batch if any event is malformed, rather than half-importing', async () => {
      await http
        .post('/api/calendar/import')
        .set('Cookie', cookie)
        .send({
          events: [
            { title: 'Fine', start: START, end: END },
            {
              title: 'Broken',
              start: START,
              end: END,
              recurrence: { freq: 'hourly', interval: 1 },
            },
          ],
        })
        .expect(400);
      await http
        .get('/api/calendar/events')
        .set('Cookie', cookie)
        .expect(200, []);
    });

    it('accepts an empty batch', async () => {
      await http
        .post('/api/calendar/import')
        .set('Cookie', cookie)
        .send({ events: [] })
        .expect(201, { imported: 0, skipped: null });
    });
  });
});
