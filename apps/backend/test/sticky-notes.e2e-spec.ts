// In-memory DB so this e2e never touches real data.
process.env.DB_PATH = ':memory:';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { Server } from 'http';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { ConfigModule } from '../src/config/config.module';
import { DbModule } from '../src/db/db.module';
import { DbService } from '../src/db/db.service';
import { AuthModule } from '../src/modules/auth/auth.module';
import { StickyNotesModule } from '../src/modules/sticky-notes/sticky-notes.module';
import { SessionService } from '../src/modules/auth/session.service';
import type { StickyNote } from '../src/modules/sticky-notes/sticky-notes.service';

describe('Sticky notes (e2e) — the desktop surface', () => {
  let app: INestApplication<Server>;
  let http: ReturnType<typeof request>;
  let cookie: string;
  let db: DbService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule, DbModule, AuthModule, StickyNotesModule],
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
    db = app.get(DbService);
  });

  afterEach(async () => {
    await app.close();
  });

  const add = (body: Record<string, unknown>) =>
    http.post('/api/sticky-notes').set('Cookie', cookie).send(body);
  const patch = (id: number, body: Record<string, unknown>) =>
    http.patch(`/api/sticky-notes/${id}`).set('Cookie', cookie).send(body);

  describe('auth', () => {
    it('rejects every route without a session', async () => {
      await http.get('/api/sticky-notes').expect(401);
      await http.post('/api/sticky-notes').send({ content: 'x' }).expect(401);
      await http
        .patch('/api/sticky-notes/1')
        .send({ content: 'x' })
        .expect(401);
      await http.delete('/api/sticky-notes/1').expect(401);
    });
  });

  describe('the shape of a note', () => {
    it('is camelCase, with x/y instead of pos_x/pos_y', async () => {
      // This is the module brief 71 named as leaking snake_case into React props.
      const res = await add({ content: 'buy milk' }).expect(201);
      const note = res.body as StickyNote;
      expect(note).not.toHaveProperty('pos_x');
      expect(note).not.toHaveProperty('created_at');
      expect({ ...note, id: 0, createdAt: '', updatedAt: '' }).toEqual({
        id: 0,
        content: 'buy milk',
        x: 100,
        y: 100,
        width: 200,
        height: 180,
        color: null,
        onDesktop: false,
        createdAt: '',
        updatedAt: '',
      });
    });

    it('defaults a new note to list-only', async () => {
      // The brief is explicit: placing a note on the desktop is a user action.
      const res = await add({}).expect(201);
      expect((res.body as StickyNote).onDesktop).toBe(false);
    });

    it('accepts a full desktop note', async () => {
      const res = await add({
        content: 'on the desktop',
        x: 320,
        y: 240,
        width: 260,
        height: 220,
        color: 'amber',
        onDesktop: true,
      }).expect(201);
      expect(res.body).toMatchObject({
        x: 320,
        y: 240,
        width: 260,
        height: 220,
        color: 'amber',
        onDesktop: true,
      });
    });

    it('refuses a colour outside the shared palette', async () => {
      // The palette is Calendar's (brief 72) — reused, not reinvented.
      await add({ color: 'yellow' }).expect(400);
      await add({ color: '#ffcc00' }).expect(400);
      for (const color of [
        'blue',
        'green',
        'amber',
        'red',
        'purple',
        'slate',
      ]) {
        await add({ color }).expect(201);
      }
    });

    it('refuses a size a bad drag would produce', async () => {
      await add({ width: 10 }).expect(400);
      await add({ height: 4000 }).expect(400);
      await add({ width: 'wide' }).expect(400);
    });

    it('refuses content beyond a scrap', async () => {
      await add({ content: 'x'.repeat(10_001) }).expect(400);
    });
  });

  describe('moving, resizing and colouring', () => {
    it('patches position and size without touching the content', async () => {
      const created = await add({ content: 'keep me', onDesktop: true }).expect(
        201,
      );
      const { id } = created.body as StickyNote;
      const moved = await patch(id, {
        x: 400,
        y: 300,
        width: 240,
        height: 200,
      }).expect(200);
      expect(moved.body).toMatchObject({
        content: 'keep me',
        x: 400,
        y: 300,
        width: 240,
        height: 200,
      });
    });

    it('clears the colour with null rather than ignoring it as falsy', async () => {
      const created = await add({ color: 'red' }).expect(201);
      const { id } = created.body as StickyNote;
      const cleared = await patch(id, { color: null }).expect(200);
      expect((cleared.body as StickyNote).color).toBeNull();
    });

    it('places a note on the desktop and takes it off again', async () => {
      const created = await add({ content: 'x' }).expect(201);
      const { id } = created.body as StickyNote;
      expect(
        ((await patch(id, { onDesktop: true })).body as StickyNote).onDesktop,
      ).toBe(true);
      expect(
        ((await patch(id, { onDesktop: false })).body as StickyNote).onDesktop,
      ).toBe(false);
    });

    it('404s on a note that is not there', async () => {
      await patch(9999, { content: 'x' }).expect(404);
      await http
        .delete('/api/sticky-notes/9999')
        .set('Cookie', cookie)
        .expect(404);
    });
  });

  describe('the migration', () => {
    it('leaves an existing note editable, off the desktop, with its content', async () => {
      // A note as it existed before brief 74: content and pos_x/pos_y only.
      db.db.exec('DELETE FROM sticky_notes');
      db.db
        .prepare(
          "INSERT INTO sticky_notes (id, content, pos_x, pos_y) VALUES (1, 'inherited', 42, 84)",
        )
        .run();
      // Simulate an OLD database: since brief 110 the ledger runs each
      // step once, so replaying a historical repair resets the stamp.
      db.db.pragma('user_version = 0');
      db.migrate();

      const list = await http
        .get('/api/sticky-notes')
        .set('Cookie', cookie)
        .expect(200);
      const notes = list.body as StickyNote[];
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({
        content: 'inherited',
        // The old spawn position becomes the desktop position — same column.
        x: 42,
        y: 84,
        width: 200,
        height: 180,
        color: null,
        onDesktop: false,
      });

      // And it is still editable.
      const edited = await patch(1, { content: 'inherited, edited' }).expect(
        200,
      );
      expect((edited.body as StickyNote).content).toBe('inherited, edited');
    });

    it('is idempotent', () => {
      // Simulate an OLD database: since brief 110 the ledger runs each
      // step once, so replaying a historical repair resets the stamp.
      db.db.pragma('user_version = 0');
      db.migrate();
      db.migrate();
      const columns = (
        db.db.prepare('PRAGMA table_info(sticky_notes)').all() as {
          name: string;
        }[]
      ).map((c) => c.name);
      expect(columns).toEqual(
        expect.arrayContaining(['width', 'height', 'color', 'on_desktop']),
      );
      // No duplicates from the repeated ALTERs.
      expect(new Set(columns).size).toBe(columns.length);
    });
  });

  describe('delete', () => {
    it('removes the note', async () => {
      const created = await add({ content: 'x' });
      const { id } = created.body as StickyNote;
      await http
        .delete(`/api/sticky-notes/${id}`)
        .set('Cookie', cookie)
        .expect(204);
      await http.get('/api/sticky-notes').set('Cookie', cookie).expect(200, []);
    });
  });
});
