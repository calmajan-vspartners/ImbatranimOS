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
import { BookmarksModule } from '../src/modules/bookmarks/bookmarks.module';
import { SessionService } from '../src/modules/auth/session.service';
import type {
  BookmarkGroup,
  BookmarkLink,
} from '../src/modules/bookmarks/bookmarks.service';

describe('Bookmarks (e2e) — the model brief 50 will consume', () => {
  let app: INestApplication<Server>;
  let http: ReturnType<typeof request>;
  let cookie: string;
  let db: DbService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule, DbModule, AuthModule, BookmarksModule],
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
    db.db.exec('DELETE FROM bookmark_links; DELETE FROM bookmark_groups;');
  });

  afterEach(async () => {
    await app.close();
  });

  const addGroup = (body: Record<string, unknown>) =>
    http.post('/api/bookmarks/groups').set('Cookie', cookie).send(body);
  const addLink = (body: Record<string, unknown>) =>
    http.post('/api/bookmarks/links').set('Cookie', cookie).send(body);
  const patchGroup = (id: number, body: Record<string, unknown>) =>
    http.patch(`/api/bookmarks/groups/${id}`).set('Cookie', cookie).send(body);
  const patchLink = (id: number, body: Record<string, unknown>) =>
    http.patch(`/api/bookmarks/links/${id}`).set('Cookie', cookie).send(body);
  const list = async () =>
    (await http.get('/api/bookmarks/groups').set('Cookie', cookie).expect(200))
      .body as BookmarkGroup[];
  const newGroup = async (name: string, parentId?: number) =>
    (
      (await addGroup({ name, ...(parentId ? { parentId } : {}) }).expect(201))
        .body as BookmarkGroup
    ).id;

  describe('auth', () => {
    it('rejects every route without a session', async () => {
      await http.get('/api/bookmarks/groups').expect(401);
      await http.post('/api/bookmarks/groups').send({ name: 'x' }).expect(401);
      await http
        .patch('/api/bookmarks/groups/1')
        .send({ name: 'x' })
        .expect(401);
      await http.delete('/api/bookmarks/groups/1').expect(401);
      await http.post('/api/bookmarks/links').send({}).expect(401);
      await http.patch('/api/bookmarks/links/1').send({}).expect(401);
      await http.delete('/api/bookmarks/links/1').expect(401);
      await http.post('/api/bookmarks/groups/reorder').send({}).expect(401);
      await http.post('/api/bookmarks/links/reorder').send({}).expect(401);
      await http.post('/api/bookmarks/import').send({}).expect(401);
    });
  });

  describe('the shape', () => {
    it('is camelCase, with url instead of href', async () => {
      const groupId = await newGroup('Reading');
      const created = await addLink({
        groupId,
        title: 'Example',
        url: 'https://example.com/a',
      }).expect(201);
      const link = created.body as BookmarkLink;
      expect(link).not.toHaveProperty('href');
      expect(link).not.toHaveProperty('group_id');
      expect({ ...link, id: 0 }).toEqual({
        id: 0,
        groupId,
        title: 'Example',
        url: 'https://example.com/a',
        icon: null,
        position: 1,
      });

      const groups = await list();
      expect(groups[0]).not.toHaveProperty('parent_id');
      expect(groups[0]).toMatchObject({ parentId: null, position: 1 });
    });
  });

  describe('what counts as a URL', () => {
    // The module shipped with @IsUrl(), which rejects the OS's own origin and
    // accepts schemes nothing here can open. See dto/bookmark-url.ts.
    it('accepts localhost and the machine hostname', async () => {
      const groupId = await newGroup('Dev');
      for (const url of [
        'http://localhost:3000',
        'http://localhost:3000/api/status?x=1#y',
        'http://imbatranim',
        'http://127.0.0.1:8080',
        'https://example.com',
      ]) {
        await addLink({ groupId, title: 'dev', url }).expect(201);
      }
    });

    it('refuses a scheme that is not http or https', async () => {
      const groupId = await newGroup('Bad');
      // javascript: matters most — the app renders bookmarks as <a href>, so this
      // would be stored XSS, and import makes it reachable from an untrusted file.
      for (const url of [
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'chrome://bookmarks',
        'ftp://files.example.com',
        'file:///etc/passwd',
        'not a url',
        '',
        'http://',
      ]) {
        await addLink({ groupId, title: 'bad', url }).expect(400);
      }
    });

    it('refuses a URL longer than the cap, on create and on update', async () => {
      const groupId = await newGroup('Long');
      const long = `https://example.com/${'x'.repeat(2100)}`;
      await addLink({ groupId, title: 'long', url: long }).expect(400);
      const ok = await addLink({
        groupId,
        title: 'ok',
        url: 'https://example.com',
      }).expect(201);
      await patchLink((ok.body as BookmarkLink).id, { url: long }).expect(400);
      await patchLink((ok.body as BookmarkLink).id, {
        url: 'javascript:alert(1)',
      }).expect(400);
    });
  });

  describe('nested folders', () => {
    it('nests a folder under another and reports parentId', async () => {
      const parent = await newGroup('Work');
      const child = await newGroup('Specs', parent);
      const groups = await list();
      expect(groups.find((g) => g.id === child)?.parentId).toBe(parent);
      // Positions are per parent, so the first child of a folder is 1 even though
      // a root folder with position 1 already exists.
      expect(groups.find((g) => g.id === child)?.position).toBe(1);
      expect(groups.find((g) => g.id === parent)?.position).toBe(1);
    });

    it('moves a folder to another parent and back to the root', async () => {
      const a = await newGroup('A');
      const b = await newGroup('B');
      expect(
        (
          (await patchGroup(b, { parentId: a }).expect(200))
            .body as BookmarkGroup
        ).parentId,
      ).toBe(a);
      expect(
        (
          (await patchGroup(b, { parentId: null }).expect(200))
            .body as BookmarkGroup
        ).parentId,
      ).toBeNull();
    });

    it('refuses a cycle — a folder inside itself or its own subfolder', async () => {
      const a = await newGroup('A');
      const b = await newGroup('B', a);
      const c = await newGroup('C', b);
      await patchGroup(a, { parentId: a }).expect(400);
      await patchGroup(a, { parentId: b }).expect(400);
      await patchGroup(a, { parentId: c }).expect(400);
      // The legal direction still works.
      await patchGroup(c, { parentId: a }).expect(200);
    });

    it('404s on a parent that does not exist', async () => {
      await addGroup({ name: 'x', parentId: 9999 }).expect(404);
      const a = await newGroup('A');
      await patchGroup(a, { parentId: 9999 }).expect(404);
    });
  });

  describe('deleting a folder — the bug brief 73 handed over', () => {
    it('deletes the folder AND its links, leaving no orphans', async () => {
      // bookmark_links declares ON DELETE CASCADE, but PRAGMA foreign_keys is
      // never enabled on this connection, so the constraint is decorative. The old
      // deleteGroup relied on it and orphaned every link in the folder.
      const groupId = await newGroup('Doomed');
      await addLink({
        groupId,
        title: 'one',
        url: 'https://example.com/1',
      }).expect(201);
      await addLink({
        groupId,
        title: 'two',
        url: 'https://example.com/2',
      }).expect(201);

      await http
        .delete(`/api/bookmarks/groups/${groupId}`)
        .set('Cookie', cookie)
        .expect(200);

      const orphans = db.db
        .prepare('SELECT COUNT(*) AS n FROM bookmark_links')
        .get() as { n: number };
      expect(orphans.n).toBe(0);
    });

    it('deletes a whole subtree, not just the folder named', async () => {
      const a = await newGroup('A');
      const b = await newGroup('B', a);
      const c = await newGroup('C', b);
      await addLink({
        groupId: c,
        title: 'deep',
        url: 'https://example.com/d',
      });
      const sibling = await newGroup('Untouched');
      await addLink({
        groupId: sibling,
        title: 'keep',
        url: 'https://example.com/k',
      });

      await http
        .delete(`/api/bookmarks/groups/${a}`)
        .set('Cookie', cookie)
        .expect(200);

      const groups = await list();
      expect(groups.map((g) => g.name)).toEqual(['Untouched']);
      expect(groups[0].links.map((l) => l.title)).toEqual(['keep']);
      expect(
        (
          db.db.prepare('SELECT COUNT(*) AS n FROM bookmark_links').get() as {
            n: number;
          }
        ).n,
      ).toBe(1);
    });

    it('sweeps up orphans left by the old code at migrate time', async () => {
      // Exactly the state the shipped bug produced: a link whose folder is gone.
      const groupId = await newGroup('Gone');
      await addLink({
        groupId,
        title: 'orphan',
        url: 'https://example.com/o',
      }).expect(201);
      db.db.prepare('DELETE FROM bookmark_groups WHERE id = ?').run(groupId);
      // And a folder whose parent is gone — collateral from the same bug.
      const ghostParent = await newGroup('GhostParent');
      const stranded = await newGroup('Stranded', ghostParent);
      db.db
        .prepare('DELETE FROM bookmark_groups WHERE id = ?')
        .run(ghostParent);

      db.migrate();

      expect(
        (
          db.db.prepare('SELECT COUNT(*) AS n FROM bookmark_links').get() as {
            n: number;
          }
        ).n,
      ).toBe(0);
      // The stranded FOLDER is promoted to the root rather than deleted: nobody
      // ever confirmed losing it, unlike the links.
      const groups = await list();
      expect(groups.find((g) => g.id === stranded)?.parentId).toBeNull();
    });
  });

  describe('moving and reordering', () => {
    it('moves a link into another folder', async () => {
      const a = await newGroup('A');
      const b = await newGroup('B');
      const link = (
        await addLink({ groupId: a, title: 'x', url: 'https://example.com/x' })
      ).body as BookmarkLink;
      const moved = (await patchLink(link.id, { groupId: b }).expect(200))
        .body as BookmarkLink;
      expect(moved.groupId).toBe(b);
      const groups = await list();
      expect(groups.find((g) => g.id === a)?.links).toEqual([]);
      expect(groups.find((g) => g.id === b)?.links).toHaveLength(1);
    });

    it('reorders links and gives every one a distinct position', async () => {
      const groupId = await newGroup('Order');
      const ids: number[] = [];
      for (const t of ['one', 'two', 'three']) {
        ids.push(
          (
            (
              await addLink({
                groupId,
                title: t,
                url: `https://example.com/${t}`,
              })
            ).body as BookmarkLink
          ).id,
        );
      }
      const reordered = [ids[2], ids[0], ids[1]];
      await http
        .post('/api/bookmarks/links/reorder')
        .set('Cookie', cookie)
        .send({ ids: reordered })
        .expect(201);
      const groups = await list();
      expect(groups[0].links.map((l) => l.title)).toEqual([
        'three',
        'one',
        'two',
      ]);
      expect(new Set(groups[0].links.map((l) => l.position)).size).toBe(3);
    });

    it('refuses a partial reorder — brief 73 corrupted positions this way', async () => {
      const groupId = await newGroup('Order');
      const ids: number[] = [];
      for (const t of ['one', 'two', 'three']) {
        ids.push(
          (
            (
              await addLink({
                groupId,
                title: t,
                url: `https://example.com/${t}`,
              })
            ).body as BookmarkLink
          ).id,
        );
      }
      await http
        .post('/api/bookmarks/links/reorder')
        .set('Cookie', cookie)
        .send({ ids: [ids[1], ids[0]] })
        .expect(400);
      // and refuses ids from two different folders
      const other = await newGroup('Other');
      const stray = (
        await addLink({
          groupId: other,
          title: 'stray',
          url: 'https://example.com/s',
        })
      ).body as BookmarkLink;
      await http
        .post('/api/bookmarks/links/reorder')
        .set('Cookie', cookie)
        .send({ ids: [ids[0], stray.id] })
        .expect(400);
    });

    it('reorders root folders', async () => {
      const a = await newGroup('A');
      const b = await newGroup('B');
      await http
        .post('/api/bookmarks/groups/reorder')
        .set('Cookie', cookie)
        .send({ ids: [b, a] })
        .expect(201);
      expect((await list()).map((g) => g.name)).toEqual(['B', 'A']);
    });
  });

  describe('import', () => {
    const tree = {
      folders: [
        {
          name: 'Bookmarks bar',
          links: [{ title: 'Example', url: 'https://example.com' }],
          folders: [
            {
              name: 'Dev',
              links: [
                { title: 'Local', url: 'http://localhost:3000' },
                { title: 'Docs', url: 'https://docs.example.com/a?b=c#d' },
              ],
            },
          ],
        },
      ],
    };

    it('inserts the tree and reports what it created', async () => {
      const res = await http
        .post('/api/bookmarks/import')
        .set('Cookie', cookie)
        .send(tree)
        .expect(201);
      expect(res.body).toEqual({ folders: 2, links: 3 });

      const groups = await list();
      const bar = groups.find((g) => g.name === 'Bookmarks bar');
      const dev = groups.find((g) => g.name === 'Dev');
      expect(bar?.parentId).toBeNull();
      expect(dev?.parentId).toBe(bar?.id);
      expect(dev?.links.map((l) => l.url)).toEqual([
        'http://localhost:3000',
        'https://docs.example.com/a?b=c#d',
      ]);
    });

    it('imports under an existing folder when asked', async () => {
      const parentId = await newGroup('Imported');
      await http
        .post('/api/bookmarks/import')
        .set('Cookie', cookie)
        .send({ ...tree, parentId })
        .expect(201);
      const groups = await list();
      expect(groups.find((g) => g.name === 'Bookmarks bar')?.parentId).toBe(
        parentId,
      );
    });

    it('rejects the whole import if any URL is not http(s), inserting nothing', async () => {
      // Atomicity matters: a half-imported tree is worse than a refused one, and a
      // javascript: href must never reach a table the app renders as <a href>.
      await http
        .post('/api/bookmarks/import')
        .set('Cookie', cookie)
        .send({
          folders: [
            {
              name: 'Mixed',
              links: [
                { title: 'fine', url: 'https://example.com' },
                { title: 'xss', url: 'javascript:alert(1)' },
              ],
            },
          ],
        })
        .expect(400);
      expect(await list()).toEqual([]);
    });

    it('refuses a pathological breadth', async () => {
      await http
        .post('/api/bookmarks/import')
        .set('Cookie', cookie)
        .send({
          folders: Array.from({ length: 501 }, (_, i) => ({ name: `f${i}` })),
        })
        .expect(400);
    });
  });

  describe('the migration', () => {
    it('renames href to url and keeps the existing rows', () => {
      const columns = (
        db.db.prepare('PRAGMA table_info(bookmark_links)').all() as {
          name: string;
        }[]
      ).map((c) => c.name);
      expect(columns).toContain('url');
      expect(columns).not.toContain('href');
      expect(columns).toContain('position');
    });

    it('is idempotent', () => {
      db.migrate();
      db.migrate();
      const groupColumns = (
        db.db.prepare('PRAGMA table_info(bookmark_groups)').all() as {
          name: string;
        }[]
      ).map((c) => c.name);
      expect(groupColumns).toEqual(
        expect.arrayContaining(['parent_id', 'position']),
      );
      expect(new Set(groupColumns).size).toBe(groupColumns.length);
    });

    it('gives pre-existing rows distinct positions per parent', async () => {
      // Rows as they existed before brief 75: no position at all, so DEFAULT 0 ties
      // them all and ORDER BY position falls back to whatever SQLite feels like.
      db.db.exec('DELETE FROM bookmark_links; DELETE FROM bookmark_groups;');
      db.db.exec(`
        INSERT INTO bookmark_groups (id, name) VALUES (1, 'Old A'), (2, 'Old B');
        UPDATE bookmark_groups SET position = 0;
        INSERT INTO bookmark_links (id, group_id, title, url)
          VALUES (1, 1, 'x', 'https://example.com/x'),
                 (2, 1, 'y', 'https://example.com/y'),
                 (3, 2, 'z', 'https://example.com/z');
        UPDATE bookmark_links SET position = 0;
      `);

      db.migrate();

      const groups = await list();
      expect(groups.map((g) => g.position)).toEqual([1, 2]);
      // Per parent, so folder 1's links are 1,2 and folder 2's link restarts at 1.
      expect(groups[0].links.map((l) => l.position)).toEqual([1, 2]);
      expect(groups[1].links.map((l) => l.position)).toEqual([1]);
    });
  });
});
