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
import { TodosModule } from '../src/modules/todos/todos.module';
import { SessionService } from '../src/modules/auth/session.service';
import type { Todo, TodoList } from '../src/modules/todos/todos.service';

const DUE = new Date(2026, 6, 20, 17, 0, 0, 0).getTime();

describe('Todos (e2e) — dates, order, lists and bulk actions', () => {
  let app: INestApplication<Server>;
  let http: ReturnType<typeof request>;
  let cookie: string;
  let db: DbService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule, DbModule, AuthModule, TodosModule],
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
    http.post('/api/todos').set('Cookie', cookie).send(body);
  const list = (query = '') =>
    http.get(`/api/todos${query}`).set('Cookie', cookie);

  describe('auth', () => {
    it('rejects every route without a session', async () => {
      await http.get('/api/todos').expect(401);
      await http.post('/api/todos').send({ text: 'x' }).expect(401);
      await http.patch('/api/todos/1').send({ text: 'x' }).expect(401);
      await http.delete('/api/todos/1').expect(401);
      await http.get('/api/todos/lists').expect(401);
      await http.post('/api/todos/lists').send({ name: 'x' }).expect(401);
      await http.delete('/api/todos/lists/1').expect(401);
      await http.delete('/api/todos/clear-completed').expect(401);
      await http.patch('/api/todos/reorder').send({ ids: [] }).expect(401);
    });
  });

  describe('the shape of a todo', () => {
    it('is camelCase, with completed as a real boolean', async () => {
      // It used to arrive as 0|1 with created_at beside it; the frontend type said
      // `boolean | number`, which is a type admitting it had a problem.
      const res = await add({ text: 'Buy milk' }).expect(201);
      const todo = res.body as Todo;
      expect(todo.completed).toBe(false);
      expect(todo.priority).toBe(false);
      expect(todo.dueAt).toBeNull();
      expect(todo.listId).toBeNull();
      expect(typeof todo.createdAt).toBe('string');
      expect(typeof todo.updatedAt).toBe('string');
      expect(todo).not.toHaveProperty('created_at');
      expect(todo).not.toHaveProperty('due_at');
    });

    it('accepts and returns a due date, priority and list', async () => {
      const listRes = await http
        .post('/api/todos/lists')
        .set('Cookie', cookie)
        .send({ name: 'Work' })
        .expect(201);
      const { id: listId } = listRes.body as TodoList;

      const res = await add({
        text: 'Ship it',
        dueAt: DUE,
        priority: true,
        listId,
      }).expect(201);
      expect(res.body).toMatchObject({
        text: 'Ship it',
        dueAt: DUE,
        priority: true,
        listId,
      });
    });

    it('refuses malformed input', async () => {
      await add({ text: '' }).expect(400);
      await add({ text: 'x'.repeat(501) }).expect(400);
      await add({ text: 'x', dueAt: 'tomorrow' }).expect(400);
      await add({ text: 'x', dueAt: -5 }).expect(400);
      await add({ text: 'x', priority: 'yes' }).expect(400);
      await add({}).expect(400);
    });

    it('404s on a list that does not exist rather than filing into nothing', async () => {
      await add({ text: 'x', listId: 999 }).expect(404);
    });
  });

  describe('updates', () => {
    it('clears a due date with null, and keeps a subset patch from wiping the rest', async () => {
      const created = await add({
        text: 'Ship it',
        dueAt: DUE,
        priority: true,
      }).expect(201);
      const { id } = created.body as Todo;

      const renamed = await http
        .patch(`/api/todos/${id}`)
        .set('Cookie', cookie)
        .send({ text: 'Ship it properly' })
        .expect(200);
      expect(renamed.body).toMatchObject({
        text: 'Ship it properly',
        dueAt: DUE,
        priority: true,
      });

      const cleared = await http
        .patch(`/api/todos/${id}`)
        .set('Cookie', cookie)
        .send({ dueAt: null })
        .expect(200);
      expect((cleared.body as Todo).dueAt).toBeNull();
    });

    it('unfiles a todo with listId null', async () => {
      const listRes = await http
        .post('/api/todos/lists')
        .set('Cookie', cookie)
        .send({ name: 'Work' });
      const { id: listId } = listRes.body as TodoList;
      const created = await add({ text: 'x', listId });
      const { id } = created.body as Todo;

      const unfiled = await http
        .patch(`/api/todos/${id}`)
        .set('Cookie', cookie)
        .send({ listId: null })
        .expect(200);
      expect((unfiled.body as Todo).listId).toBeNull();
    });

    it('404s on a todo that is not there', async () => {
      await http
        .patch('/api/todos/9999')
        .set('Cookie', cookie)
        .send({ text: 'x' })
        .expect(404);
      await http.delete('/api/todos/9999').set('Cookie', cookie).expect(404);
    });
  });

  describe('filters and lists', () => {
    it('narrows by done-ness and by list, independently', async () => {
      const work = (
        await http
          .post('/api/todos/lists')
          .set('Cookie', cookie)
          .send({ name: 'Work' })
      ).body as TodoList;

      const a = (await add({ text: 'work-active', listId: work.id }))
        .body as Todo;
      await add({ text: 'work-done', listId: work.id });
      await add({ text: 'loose-active' });

      const done = (await add({ text: 'to-complete', listId: work.id }))
        .body as Todo;
      await http
        .patch(`/api/todos/${done.id}`)
        .set('Cookie', cookie)
        .send({ completed: true });

      const all = await list().expect(200);
      expect(all.body).toHaveLength(4);

      const active = await list('?filter=active').expect(200);
      expect((active.body as Todo[]).map((t) => t.text)).toEqual([
        'work-active',
        'work-done',
        'loose-active',
      ]);

      const completed = await list('?filter=completed').expect(200);
      expect((completed.body as Todo[]).map((t) => t.text)).toEqual([
        'to-complete',
      ]);

      const inWork = await list(`?listId=${work.id}`).expect(200);
      expect(inWork.body).toHaveLength(3);

      const activeInWork = await list(
        `?listId=${work.id}&filter=active`,
      ).expect(200);
      expect((activeInWork.body as Todo[]).map((t) => t.id)).toEqual([
        a.id,
        (all.body as Todo[])[1].id,
      ]);
    });

    it('treats an absent listId as "all lists", not as list 0', async () => {
      // A ParseIntPipe would coerce the empty string to 0 here, and list 0 does not
      // exist — every todo would vanish from the default view.
      await add({ text: 'unfiled' });
      await list('?listId=')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveLength(1);
        });
    });

    it('deleting a list unfiles its todos instead of deleting them', async () => {
      const work = (
        await http
          .post('/api/todos/lists')
          .set('Cookie', cookie)
          .send({ name: 'Work' })
      ).body as TodoList;
      await add({ text: 'keep me', listId: work.id });

      const res = await http
        .delete(`/api/todos/lists/${work.id}`)
        .set('Cookie', cookie)
        .expect(200);
      expect(res.body).toEqual({ unfiled: 1 });

      const remaining = await list().expect(200);
      expect(remaining.body).toHaveLength(1);
      expect((remaining.body as Todo[])[0].listId).toBeNull();
      await http.get('/api/todos/lists').set('Cookie', cookie).expect(200, []);
    });

    it('renames a list and 404s on a missing one', async () => {
      const work = (
        await http
          .post('/api/todos/lists')
          .set('Cookie', cookie)
          .send({ name: 'Work' })
      ).body as TodoList;
      const renamed = await http
        .patch(`/api/todos/lists/${work.id}`)
        .set('Cookie', cookie)
        .send({ name: 'Job' })
        .expect(200);
      expect((renamed.body as TodoList).name).toBe('Job');
      await http
        .patch('/api/todos/lists/999')
        .set('Cookie', cookie)
        .send({ name: 'x' })
        .expect(404);
      await http
        .delete('/api/todos/lists/999')
        .set('Cookie', cookie)
        .expect(404);
    });
  });

  describe('reorder', () => {
    const texts = async (query = '') =>
      ((await list(query)).body as Todo[]).map((t) => t.text);

    it('reorders the full list', async () => {
      const ids: number[] = [];
      for (const text of ['a', 'b', 'c', 'd']) {
        ids.push(((await add({ text })).body as Todo).id);
      }
      await http
        .patch('/api/todos/reorder')
        .set('Cookie', cookie)
        .send({ ids: [ids[3], ids[0], ids[2], ids[1]] })
        .expect(200);
      expect(await texts()).toEqual(['d', 'a', 'c', 'b']);
    });

    it('reordering a FILTERED subset leaves the hidden rows exactly where they were', async () => {
      // The bug this pins: the old implementation stamped positions 1..N onto
      // whatever ids it was handed, so reordering the Active tab overwrote the
      // completed rows' positions and two todos ended up sharing one.
      const ids: number[] = [];
      for (const text of ['a', 'b', 'c', 'd']) {
        ids.push(((await add({ text })).body as Todo).id);
      }
      // Complete b and d, so Active is [a, c].
      for (const id of [ids[1], ids[3]]) {
        await http
          .patch(`/api/todos/${id}`)
          .set('Cookie', cookie)
          .send({ completed: true });
      }
      expect(await texts('?filter=active')).toEqual(['a', 'c']);

      // Swap the two active ones.
      await http
        .patch('/api/todos/reorder')
        .set('Cookie', cookie)
        .send({ ids: [ids[2], ids[0]] })
        .expect(200);

      expect(await texts('?filter=active')).toEqual(['c', 'a']);
      // b stays second and d stays fourth: the active pair swapped inside the
      // slots it already occupied.
      expect(await texts()).toEqual(['c', 'b', 'a', 'd']);

      // Every position is still unique, which is what went wrong before.
      const positions = ((await list()).body as Todo[]).map((t) => t.position);
      expect(new Set(positions).size).toBe(positions.length);
    });

    it('ignores ids that are not there', async () => {
      const a = ((await add({ text: 'a' })).body as Todo).id;
      const b = ((await add({ text: 'b' })).body as Todo).id;
      await http
        .patch('/api/todos/reorder')
        .set('Cookie', cookie)
        .send({ ids: [9999, b, a] })
        .expect(200);
      expect(await texts()).toEqual(['b', 'a']);
    });
  });

  describe('clear completed', () => {
    it('deletes only the completed ones, and says how many', async () => {
      const ids: number[] = [];
      for (const text of ['a', 'b', 'c']) {
        ids.push(((await add({ text })).body as Todo).id);
      }
      for (const id of [ids[0], ids[2]]) {
        await http
          .patch(`/api/todos/${id}`)
          .set('Cookie', cookie)
          .send({ completed: true });
      }
      const res = await http
        .delete('/api/todos/clear-completed')
        .set('Cookie', cookie)
        .expect(200);
      expect(res.body).toEqual({ deleted: 2 });
      expect(((await list()).body as Todo[]).map((t) => t.text)).toEqual(['b']);
    });

    it('can be scoped to one list', async () => {
      const work = (
        await http
          .post('/api/todos/lists')
          .set('Cookie', cookie)
          .send({ name: 'Work' })
      ).body as TodoList;
      const inList = (
        (await add({ text: 'work-done', listId: work.id })).body as Todo
      ).id;
      const loose = ((await add({ text: 'loose-done' })).body as Todo).id;
      for (const id of [inList, loose]) {
        await http
          .patch(`/api/todos/${id}`)
          .set('Cookie', cookie)
          .send({ completed: true });
      }
      const res = await http
        .delete(`/api/todos/clear-completed?listId=${work.id}`)
        .set('Cookie', cookie)
        .expect(200);
      expect(res.body).toEqual({ deleted: 1 });
      expect(((await list()).body as Todo[]).map((t) => t.text)).toEqual([
        'loose-done',
      ]);
    });

    it('reports zero rather than failing on an empty list', async () => {
      await http
        .delete('/api/todos/clear-completed')
        .set('Cookie', cookie)
        .expect(200, { deleted: 0 });
    });
  });

  describe('the position backfill', () => {
    it('gives pre-brief-73 rows a unique, stable order', () => {
      // Simulate the live table: `position` was added with DEFAULT 0, so every row
      // that predates it shares 0 and `ORDER BY position` is free to pick any
      // order — and a drag then writes 1..N over the top of the ties.
      db.db.exec('DELETE FROM todos');
      const insert = db.db.prepare(
        'INSERT INTO todos (id, text, completed, position) VALUES (?, ?, 0, 0)',
      );
      insert.run(1, 'oldest');
      insert.run(2, 'middle');
      insert.run(3, 'newest');
      expect(
        (
          db.db
            .prepare('SELECT COUNT(DISTINCT position) AS n FROM todos')
            .get() as {
            n: number;
          }
        ).n,
      ).toBe(1);

      // Run the migration again, as a restart would.
      db.migrate();

      const rows = db.db
        .prepare('SELECT id, text, position FROM todos ORDER BY position ASC')
        .all() as { id: number; text: string; position: number }[];
      expect(rows.map((r) => r.text)).toEqual(['oldest', 'middle', 'newest']);
      expect(rows.map((r) => r.position)).toEqual([1, 2, 3]);
    });

    it('leaves an already-healthy table alone', async () => {
      for (const text of ['a', 'b', 'c']) await add({ text });
      const before = ((await list()).body as Todo[]).map((t) => [
        t.text,
        t.position,
      ]);
      db.migrate();
      const after = ((await list()).body as Todo[]).map((t) => [
        t.text,
        t.position,
      ]);
      expect(after).toEqual(before);
    });

    it('keeps text and done state across the migration', async () => {
      db.db.exec('DELETE FROM todos');
      db.db
        .prepare(
          "INSERT INTO todos (id, text, completed, position) VALUES (1, 'kept', 1, 0)",
        )
        .run();
      db.migrate();
      const rows = (await list()).body as Todo[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ text: 'kept', completed: true });
    });
  });
});
