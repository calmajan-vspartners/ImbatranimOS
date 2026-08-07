import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { PrefEntryDto } from './dto/prefs.dto';
import { PrefsController } from './prefs.controller';
import { PrefsService } from './prefs.service';

/**
 * Brief 49 — durable dotfiles.
 *
 * The server's whole job here is durability and access control; the *meaning* of
 * a value belongs to the client store that wrote it. So these test round-tripping
 * and isolation, and deliberately do not test any store's shape — a backend that
 * knew the schema of every client store would need changing every time one gained
 * a field.
 */
describe('PrefsService — brief 49', () => {
  let dir: string;
  let db: DbService;
  let prefs: PrefsService;
  let controller: PrefsController;

  beforeEach(() => {
    dir = fs.mkdtempSync(join(os.tmpdir(), 'imb-b49-'));
    const config = {
      get: (key: string) => (key === 'DB_PATH' ? join(dir, 'db.sqlite') : 24),
    } as unknown as ConfigService<never, true>;
    db = new DbService(config);
    db.onModuleInit();
    prefs = new PrefsService(db);
    controller = new PrefsController(prefs);
  });

  afterEach(() => {
    db.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a DTO CLASS INSTANCE, which is what the pipe actually delivers', () => {
    // The ValidationPipe runs with transform:true, so the controller receives
    // class instances rather than the object literals a spec naturally writes.
    // better-sqlite3 rejects a class instance for named parameters, and that
    // gap made every real write 500 while this file was green.
    const entry = new PrefEntryDto();
    entry.key = 'imbatranimos:appearance';
    entry.value = '{"state":{"theme":"light"}}';
    expect(() => controller.put({ entries: [entry] })).not.toThrow();
    expect(controller.all()['imbatranimos:appearance']).toBe(
      '{"state":{"theme":"light"}}',
    );
  });

  it('starts empty rather than inventing defaults', () => {
    expect(controller.all()).toEqual({});
  });

  it('round-trips a value byte for byte', () => {
    const value = JSON.stringify({
      state: { theme: 'dark', accent: 'cobalt' },
      version: 0,
    });
    controller.put({ entries: [{ key: 'imbatranimos:appearance', value }] });
    expect(controller.all()['imbatranimos:appearance']).toBe(value);
  });

  it('treats the value as OPAQUE — it is not parsed, reshaped or validated', () => {
    // Not valid JSON at all. The server has no business caring, and a server
    // that rejected this would be a server with an opinion about client schemas.
    controller.put({
      entries: [{ key: 'wallpaper-storage', value: 'not json {' }],
    });
    expect(controller.all()['wallpaper-storage']).toBe('not json {');
  });

  it('overwrites on a second write rather than accumulating rows', () => {
    controller.put({ entries: [{ key: 'k', value: 'first' }] });
    controller.put({ entries: [{ key: 'k', value: 'second' }] });
    expect(controller.all()).toEqual({ k: 'second' });
  });

  it('writes a batch, and keys stay independent', () => {
    controller.put({
      entries: [
        { key: 'a', value: '1' },
        { key: 'b', value: '2' },
      ],
    });
    controller.put({ entries: [{ key: 'a', value: '9' }] });
    expect(controller.all()).toEqual({ a: '9', b: '2' });
  });

  it('survives a reopen — this is the whole point of not being localStorage', () => {
    controller.put({
      entries: [{ key: 'wallpaper-storage', value: '{"w":"grid"}' }],
    });
    const path = db.path();
    db.db.close();

    const reopened = new DbService({
      get: (key: string) => (key === 'DB_PATH' ? path : 24),
    } as unknown as ConfigService<never, true>);
    reopened.onModuleInit();
    expect(new PrefsService(reopened).all()['wallpaper-storage']).toBe(
      '{"w":"grid"}',
    );
    reopened.db.close();
    // Reassign so afterEach closes something live.
    db = reopened;
    db.onModuleInit();
  });

  it('deletes a key back to "the client should use its default"', () => {
    controller.put({ entries: [{ key: 'k', value: 'v' }] });
    controller.remove('k');
    expect(controller.all()).toEqual({});
    expect(prefs.get('k')).toBeNull();
  });

  it('deleting a key that was never there is not an error', () => {
    expect(() => controller.remove('never-existed')).not.toThrow();
  });

  it('handles a value with newlines and quotes, which JSON state routinely has', () => {
    const value = JSON.stringify({ note: 'line one\nline "two"\t\\end' });
    controller.put({ entries: [{ key: 'k', value }] });
    expect(controller.all().k).toBe(value);
    expect(JSON.parse(controller.all().k)).toEqual({
      note: 'line one\nline "two"\t\\end',
    });
  });

  it('an empty batch is a no-op, not a wipe', () => {
    controller.put({ entries: [{ key: 'k', value: 'v' }] });
    expect(controller.put({ entries: [] })).toEqual({
      written: 0,
      updatedAt: {},
    });
    expect(controller.all()).toEqual({ k: 'v' });
  });

  it('a large value round-trips (icon layouts are the big one)', () => {
    const big = JSON.stringify({
      positions: Object.fromEntries(
        Array.from({ length: 200 }, (_, i) => [
          `app-${i}`,
          { x: i * 3, y: i * 7 },
        ]),
      ),
    });
    controller.put({ entries: [{ key: 'desktop-storage', value: big }] });
    expect(controller.all()['desktop-storage']).toBe(big);
  });
  // Brief 109: the PUT echoes each key's updated_at, so a two-browser conflict
  // has a timestamp to reason with. Last-writer-wins stays the merge rule.
  it('echoes updated_at per key alongside the written count', () => {
    const res = controller.put({
      entries: [
        { key: 'wallpaper-storage', value: '{"w":1}' },
        { key: 'desktop-storage', value: '{"d":1}' },
      ],
    });
    expect(res.written).toBe(2);
    expect(Object.keys(res.updatedAt).sort()).toEqual([
      'desktop-storage',
      'wallpaper-storage',
    ]);
    for (const stamp of Object.values(res.updatedAt)) {
      expect(typeof stamp).toBe('string');
      expect(stamp.length).toBeGreaterThan(0);
    }
  });
});
