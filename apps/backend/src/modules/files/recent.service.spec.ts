import { RecentService } from './recent.service';
import { makeTestDb } from '../auth/test-utils';
import type { DbService } from '../../db/db.service';

describe('RecentService (brief 94)', () => {
  let db: DbService;
  let service: RecentService;

  beforeEach(() => {
    db = makeTestDb();
    service = new RecentService(db);
  });

  it('records and lists newest-first', () => {
    service.record('home', 'a.txt', 'notepad');
    service.record('home', 'b.png', 'image-viewer');
    const list = service.list();
    expect(list.map((r) => r.path)).toEqual(['b.png', 'a.txt']);
    expect(list[0].appId).toBe('image-viewer');
    expect(list[0].root).toBe('home');
  });

  it('reopening is an upsert, not a duplicate — and can change the app', () => {
    service.record('home', 'a.md', 'notepad');
    service.record('home', 'a.md', 'markdown-editor');
    const list = service.list();
    expect(list).toHaveLength(1);
    expect(list[0].appId).toBe('markdown-editor');
  });

  it('the same path under two roots is two entries', () => {
    service.record('home', 'notes.txt', 'notepad');
    service.record('notes', 'notes.txt', 'notepad');
    expect(service.list()).toHaveLength(2);
  });

  it('prunes beyond the cap, oldest first', () => {
    for (let i = 0; i < 60; i++) {
      service.record('home', `f${String(i).padStart(2, '0')}.txt`, 'notepad');
    }
    const list = service.list();
    expect(list).toHaveLength(50);
    // A same-second burst prunes by insertion order (the id tiebreak): the
    // ten oldest inserts are the ones gone.
    expect(list.some((r) => r.path === 'f09.txt')).toBe(false);
    expect(list.some((r) => r.path === 'f10.txt')).toBe(true);
  });

  it('remove deletes exactly one entry; clear empties the list', () => {
    service.record('home', 'a.txt', 'notepad');
    service.record('home', 'b.txt', 'notepad');
    service.remove('home', 'a.txt');
    expect(service.list().map((r) => r.path)).toEqual(['b.txt']);
    service.clear();
    expect(service.list()).toEqual([]);
  });

  it('the old-shape table is dropped and recreated by the migration', () => {
    // Recreate the pre-94 shape, then run migrate() again (idempotent by
    // design — see db.service): the shape wins, the rows are gone.
    db.db.exec(`DROP TABLE recent_files`);
    db.db.exec(`
      CREATE TABLE recent_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        last_opened DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.db
      .prepare(`INSERT INTO recent_files (path) VALUES ('legacy.txt')`)
      .run();
    db.migrate();
    expect(service.list()).toEqual([]);
    service.record('home', 'fresh.txt', 'notepad');
    expect(service.list()).toHaveLength(1);
  });
});
