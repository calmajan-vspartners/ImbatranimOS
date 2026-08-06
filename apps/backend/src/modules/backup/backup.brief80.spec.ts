import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as os from 'os';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import { FilesService } from '../files/files.service';
import { ArchiveService } from '../archive/archive.service';
import { DbService } from '../../db/db.service';
import { SessionService } from '../auth/session.service';
import { LogService } from '../logs/log.service';
import {
  BACKUP_METADATA,
  BackupService,
  normaliseMember,
  topLevelOf,
  validateManifest,
} from './backup.service';

const execFileAsync = promisify(execFile);
const tar = async (args: string[]): Promise<void> => {
  await execFileAsync('tar', args);
};

/**
 * Brief 80 — backup and restore, against the real filesystem, the real `tar`
 * and a real SQLite database.
 *
 * The interesting cases are all the ones where a backup is *not* what it claims
 * to be: an unrelated tarball, a crafted archive with `../` entries, a symlink
 * pointing at `/etc`, an archive with no manifest. Restore overwrites the user's
 * entire home directory, so every one of those has to be refused before a single
 * byte moves.
 */
describe('BackupService — brief 80', () => {
  let home: string;
  let outside: string;
  let files: FilesService;
  let archive: ArchiveService;
  let db: DbService;
  let sessions: SessionService;
  let service: BackupService;
  const prevRoot = process.env.FILES_ROOT;

  /** A DbService backed by a real on-disk database inside the home. */
  const makeDb = (dbPath: string): DbService => {
    const config = {
      get: (key: string) => (key === 'DB_PATH' ? dbPath : 24),
    } as unknown as ConfigService<never, true>;
    const instance = new DbService(config);
    instance.onModuleInit();
    return instance;
  };

  beforeEach(async () => {
    home = await fs.mkdtemp(join(os.tmpdir(), 'imb-b80-home-'));
    outside = await fs.mkdtemp(join(os.tmpdir(), 'imb-b80-out-'));
    process.env.FILES_ROOT = home;
    await fs.mkdir(join(home, '.imbatranim'), { recursive: true });
    await fs.mkdir(join(home, 'Documents'), { recursive: true });
    await fs.writeFile(join(home, 'Documents', 'letter.txt'), 'dear world');
    await fs.writeFile(join(home, 'top-level.txt'), 'hello');

    files = new FilesService();
    archive = new ArchiveService(files);
    db = makeDb(join(home, '.imbatranim', 'db.sqlite'));
    sessions = new SessionService(db, {
      get: () => 24,
    } as unknown as ConfigService<never, true>);
    // A real LogService, initialised against the test home: brief 84 wired an
    // audit line into restore, and a stub would hide it breaking.
    const logs = new LogService();
    await logs.onModuleInit();
    service = new BackupService(files, archive, db, sessions, logs);
  });

  afterEach(async () => {
    process.env.FILES_ROOT = prevRoot;
    try {
      db.db.close();
    } catch {
      /* already closed by a restore */
    }
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  /** Run a backup to a file on disk (outside the home) and return its path. */
  const takeBackup = async (name = 'backup.tar.gz'): Promise<string> => {
    const dest = join(outside, name);
    const stream = await service.openBackupStream();
    const chunks: Buffer[] = [];
    stream.stream.on('data', (c: Buffer) => chunks.push(c));
    await stream.done;
    await stream.dispose();
    await fs.writeFile(dest, Buffer.concat(chunks));
    return dest;
  };

  const members = async (tarball: string): Promise<string[]> => {
    const { stdout } = await execFileAsync('tar', ['-tzf', tarball], {
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout
      .split('\n')
      .filter((l) => l.length > 0)
      .map(normaliseMember);
  };

  const exists = async (p: string): Promise<boolean> => {
    try {
      await fs.lstat(p);
      return true;
    } catch {
      return false;
    }
  };

  // ── pure helpers ─────────────────────────────────────────────────────────

  describe('member-name normalisation', () => {
    it('strips the ./ prefix both tars write', () => {
      expect(normaliseMember('./notes/a.txt')).toBe('notes/a.txt');
      expect(normaliseMember('notes/a.txt')).toBe('notes/a.txt');
    });

    it('leaves a name that merely starts with a dot alone', () => {
      expect(normaliseMember('./.imbatranim/db.sqlite')).toBe(
        '.imbatranim/db.sqlite',
      );
      expect(normaliseMember('.hidden')).toBe('.hidden');
    });

    it('reads the top-level segment, ignoring the archive root itself', () => {
      expect(topLevelOf('./Documents/a/b.txt')).toBe('Documents');
      expect(topLevelOf('./top.txt')).toBe('top.txt');
      expect(topLevelOf('./')).toBe('');
      expect(topLevelOf('.')).toBe('');
      expect(topLevelOf('./Documents/')).toBe('Documents');
    });
  });

  describe('manifest validation', () => {
    const good = {
      product: 'ImbatranimOS',
      manifestVersion: 1,
      createdAt: '2026-08-06T10:00:00.000Z',
      imageVersion: '1.0.0',
      home: '/home/imbatranim',
      database: BACKUP_METADATA.database,
      excluded: ['./.local/share/Trash'],
    };

    it('accepts one of ours', () => {
      expect(validateManifest(good).createdAt).toBe('2026-08-06T10:00:00.000Z');
    });

    it('refuses a manifest naming a different product', () => {
      expect(() =>
        validateManifest({ ...good, product: 'SomethingElse' }),
      ).toThrow(/not an ImbatranimOS backup/);
    });

    it('refuses a manifest version this build does not understand', () => {
      expect(() => validateManifest({ ...good, manifestVersion: 2 })).toThrow(
        /newer version/,
      );
    });

    it('refuses a manifest with no usable date', () => {
      expect(() =>
        validateManifest({ ...good, createdAt: 'whenever' }),
      ).toThrow(/creation date/);
      expect(() => validateManifest({ ...good, createdAt: '' })).toThrow();
    });

    it('refuses a non-object', () => {
      expect(() => validateManifest(null)).toThrow();
      expect(() => validateManifest('a string')).toThrow();
    });

    it('defaults the optional fields rather than trusting them blindly', () => {
      const m = validateManifest({
        product: 'ImbatranimOS',
        manifestVersion: 1,
        createdAt: '2026-08-06T10:00:00.000Z',
      });
      expect(m.imageVersion).toBe('unknown');
      expect(m.database).toBe(BACKUP_METADATA.database);
      expect(m.excluded).toEqual([]);
    });
  });

  // ── backup ───────────────────────────────────────────────────────────────

  describe('taking a backup', () => {
    it('streams an archive carrying the user files', async () => {
      const list = await members(await takeBackup());
      expect(list).toContain('Documents/letter.txt');
      expect(list).toContain('top-level.txt');
    });

    it('carries a manifest and a database snapshot', async () => {
      const list = await members(await takeBackup());
      expect(list).toContain(BACKUP_METADATA.manifest);
      expect(list).toContain(BACKUP_METADATA.database);
    });

    it('EXCLUDES the live database, whose hot copy would be torn', async () => {
      const list = await members(await takeBackup());
      expect(list).not.toContain('.imbatranim/db.sqlite');
      expect(list).not.toContain('.imbatranim/db.sqlite-wal');
      expect(list).not.toContain('.imbatranim/db.sqlite-shm');
    });

    it('excludes the Trash', async () => {
      await fs.mkdir(join(home, '.local', 'share', 'Trash', 'files'), {
        recursive: true,
      });
      await fs.writeFile(
        join(home, '.local', 'share', 'Trash', 'files', 'gone.txt'),
        'deleted',
      );
      const list = await members(await takeBackup());
      expect(list.some((m) => m.includes('Trash'))).toBe(false);
    });

    it('the exclusions are ANCHORED — a user’s own .imbatranim/db.sqlite survives', async () => {
      // The bare pattern `.imbatranim/db.sqlite` matches at any path boundary in
      // both tars, so an unanchored exclusion would silently eat this file.
      await fs.mkdir(join(home, 'Documents', '.imbatranim'), {
        recursive: true,
      });
      await fs.writeFile(
        join(home, 'Documents', '.imbatranim', 'db.sqlite'),
        'MINE, not the OS',
      );
      const list = await members(await takeBackup());
      expect(list).toContain('Documents/.imbatranim/db.sqlite');
      expect(list).not.toContain('.imbatranim/db.sqlite');
    });

    it('leaves nothing behind in the home directory', async () => {
      await takeBackup();
      expect(await exists(join(home, '.imbatranim', 'backup-staging'))).toBe(
        false,
      );
    });

    it('the snapshot is a real SQLite database holding the live rows', async () => {
      db.db.prepare("INSERT INTO todos (text) VALUES ('walk the dog')").run();
      const tarball = await takeBackup();
      const dir = await fs.mkdtemp(join(outside, 'snap-'));
      await tar([
        '-xzf',
        tarball,
        '-C',
        dir,
        '--',
        `./${BACKUP_METADATA.database}`,
      ]);
      const snapshot = new Database(join(dir, BACKUP_METADATA.database), {
        readonly: true,
      });
      const row = snapshot.prepare('SELECT text FROM todos').get() as {
        text: string;
      };
      expect(row.text).toBe('walk the dog');
      snapshot.close();
    });

    it('refuses a second concurrent backup rather than sharing a staging path', async () => {
      const first = await service.openBackupStream();
      await expect(service.openBackupStream()).rejects.toThrow(
        /already running/,
      );
      first.stream.resume();
      await first.done;
      await first.dispose();
      // …and the lock is released, so the next one works.
      const second = await service.openBackupStream();
      second.stream.resume();
      await second.done;
      await second.dispose();
    });

    it('reports what it will and will not include', async () => {
      const info = await service.info();
      expect(info.homeBytes).toBeGreaterThan(0);
      expect(info.suggestedFilename).toMatch(
        /^imbatranim-home-\d{4}-\d{2}-\d{2}\.tar\.gz$/,
      );
      expect(info.excluded.some((e) => e.includes('Trash'))).toBe(true);
      expect(info.excluded).toContain('./.imbatranim/db.sqlite');
    });
  });

  // ── restore: refusals ────────────────────────────────────────────────────

  describe('refusing what is not a backup', () => {
    it('refuses an unrelated tarball', async () => {
      const src = join(outside, 'src');
      await fs.mkdir(src, { recursive: true });
      await fs.writeFile(join(src, 'readme.txt'), 'just some files');
      const bogus = join(outside, 'not-a-backup.tar.gz');
      await tar(['-czf', bogus, '-C', src, '.']);
      await expect(service.inspect(bogus)).rejects.toThrow(
        /no backup manifest/,
      );
    });

    it('refuses a file that is not an archive at all', async () => {
      const junk = join(outside, 'junk.tar.gz');
      await fs.writeFile(junk, 'this is plain text pretending to be gzip');
      await expect(service.inspect(junk)).rejects.toThrow(/could not be read/);
    });

    it('refuses an archive whose manifest names a different product', async () => {
      const src = join(outside, 'fake');
      await fs.mkdir(join(src, '.imbatranim', 'backup-staging'), {
        recursive: true,
      });
      await fs.writeFile(
        join(src, '.imbatranim', 'backup-staging', 'manifest.json'),
        JSON.stringify({ product: 'NotUs', manifestVersion: 1 }),
      );
      const fake = join(outside, 'fake.tar.gz');
      await tar(['-czf', fake, '-C', src, '.']);
      await expect(service.inspect(fake)).rejects.toThrow(
        /not an ImbatranimOS/,
      );
    });

    it('DELETES the rejected upload rather than leaving it in /tmp', async () => {
      const junk = join(outside, 'junk2.tar.gz');
      await fs.writeFile(junk, 'nope');
      await expect(service.inspect(junk)).rejects.toThrow();
      expect(await exists(junk)).toBe(false);
    });

    it('refuses to apply an id it never issued', async () => {
      await expect(
        service.apply('00000000-0000-4000-8000-000000000000'),
      ).rejects.toThrow(/expired/);
    });

    it('refuses to apply the same id twice', async () => {
      const tarball = await takeBackup();
      const upload = join(outside, 'upload.tar.gz');
      await fs.copyFile(tarball, upload);
      const preview = await service.inspect(upload);
      await service.apply(preview.id);
      await expect(service.apply(preview.id)).rejects.toThrow(/expired/);
    });
  });

  describe('refusing a hostile archive', () => {
    /** Build a tarball that has a valid manifest AND something nasty. */
    const craft = async (
      name: string,
      build: (dir: string) => Promise<void>,
      tarArgs: string[] = ['.'],
    ): Promise<string> => {
      const src = join(outside, `craft-${name}`);
      const staging = join(src, '.imbatranim', 'backup-staging');
      await fs.mkdir(staging, { recursive: true });
      await fs.writeFile(
        join(staging, 'manifest.json'),
        JSON.stringify({
          product: 'ImbatranimOS',
          manifestVersion: 1,
          createdAt: new Date().toISOString(),
          imageVersion: 'crafted',
          home: '/home/imbatranim',
          database: BACKUP_METADATA.database,
          excluded: [],
        }),
      );
      // A real (empty) SQLite file, so the refusal under test is the one we mean.
      const snap = new Database(join(staging, 'db.sqlite'));
      snap.exec('CREATE TABLE t(a)');
      snap.close();
      await build(src);
      const out = join(outside, `${name}.tar.gz`);
      await tar(['-czf', out, '-C', src, ...tarArgs]);
      return out;
    };

    it('refuses a ../ traversal entry, and nothing escapes', async () => {
      // `-P` is what makes tar keep the `../` in the stored member name instead
      // of sanitising it away — i.e. it builds the archive an attacker would.
      const src = join(outside, 'craft-traversal');
      await craft('traversal-base', async () => {});
      await fs.writeFile(join(outside, 'ESCAPED.txt'), 'escaped');
      await fs.mkdir(src, { recursive: true });
      await fs.cp(join(outside, 'craft-traversal-base'), src, {
        recursive: true,
      });
      const evil = join(outside, 'traversal.tar.gz');
      await execFileAsync('tar', ['-czPf', evil, '.', '../ESCAPED.txt'], {
        cwd: src,
      });
      const declared = await members(evil);
      expect(declared).toContain('../ESCAPED.txt');

      const preview = await service.inspect(evil);
      // The archive is a valid backup by its manifest — the refusal has to come
      // from the entry check, and it has to come before anything is written.
      await expect(service.apply(preview.id)).rejects.toThrow(
        /escapes|Refusing/i,
      );
      expect(await exists(join(home, '..', 'ESCAPED.txt'))).toBe(false);
      expect(await exists(join(home, 'ESCAPED.txt'))).toBe(false);
    });

    it('refuses a symlink pointing at /etc, and never follows it', async () => {
      const evil = await craft('symlink', async (dir) => {
        await fs.symlink('/etc', join(dir, 'etc-link'));
      });
      const preview = await service.inspect(evil);
      await expect(service.apply(preview.id)).rejects.toThrow(
        /symlink|escapes/i,
      );
      // The home directory is untouched — the refusal happened in staging.
      expect(await exists(join(home, 'etc-link'))).toBe(false);
      expect(await fs.readFile(join(home, 'top-level.txt'), 'utf8')).toBe(
        'hello',
      );
    });

    it('refuses an archive with an absolute member name', async () => {
      const src = join(outside, 'craft-abs');
      const staging = join(src, '.imbatranim', 'backup-staging');
      await fs.mkdir(staging, { recursive: true });
      await fs.writeFile(
        join(staging, 'manifest.json'),
        JSON.stringify({
          product: 'ImbatranimOS',
          manifestVersion: 1,
          createdAt: new Date().toISOString(),
        }),
      );
      const out = join(outside, 'absolute.tar.gz');
      // -P keeps the leading slash, which is exactly the case being tested.
      await tar(['-czPf', out, '-C', src, '.', '/etc/hostname']);
      const preview = await service.inspect(out).catch((e: Error) => e);
      if (preview instanceof Error) {
        expect(preview.message).toBeTruthy();
      } else {
        await expect(service.apply(preview.id)).rejects.toThrow();
      }
    });
  });

  // ── restore: the happy path ──────────────────────────────────────────────

  describe('a real round trip', () => {
    it('reports what would be replaced, before replacing anything', async () => {
      const tarball = await takeBackup();
      const upload = join(outside, 'u1.tar.gz');
      await fs.copyFile(tarball, upload);
      const preview = await service.inspect(upload);

      expect(preview.manifest.product).toBe('ImbatranimOS');
      expect(preview.entries.map((e) => e.name)).toEqual(
        expect.arrayContaining(['Documents', 'top-level.txt', '.imbatranim']),
      );
      expect(
        preview.entries.find((e) => e.name === 'Documents')?.replacesExisting,
      ).toBe(true);
      expect(preview.totalBytes).toBeGreaterThan(0);
      expect(preview.fits).toBe(true);
      // Nothing has happened yet.
      expect(
        await fs.readFile(join(home, 'Documents', 'letter.txt'), 'utf8'),
      ).toBe('dear world');
    });

    it('brings back a deleted file, byte for byte', async () => {
      await fs.writeFile(
        join(home, 'Documents', 'precious.txt'),
        'do not lose',
      );
      const tarball = await takeBackup();
      const upload = join(outside, 'u2.tar.gz');
      await fs.copyFile(tarball, upload);

      await fs.rm(join(home, 'Documents', 'precious.txt'));
      expect(await exists(join(home, 'Documents', 'precious.txt'))).toBe(false);

      const preview = await service.inspect(upload);
      const result = await service.apply(preview.id);

      expect(result.restored).toEqual(expect.arrayContaining(['Documents']));
      expect(
        await fs.readFile(join(home, 'Documents', 'precious.txt'), 'utf8'),
      ).toBe('do not lose');
    });

    it('restores the database rows, through a reopened connection', async () => {
      db.db
        .prepare("INSERT INTO todos (text) VALUES ('from the backup')")
        .run();
      const tarball = await takeBackup();
      const upload = join(outside, 'u3.tar.gz');
      await fs.copyFile(tarball, upload);

      db.db.prepare('DELETE FROM todos').run();
      db.db
        .prepare("INSERT INTO todos (text) VALUES ('after the backup')")
        .run();

      const preview = await service.inspect(upload);
      await service.apply(preview.id);

      const rows = db.db.prepare('SELECT text FROM todos').all() as {
        text: string;
      }[];
      expect(rows.map((r) => r.text)).toEqual(['from the backup']);
    });

    it('revokes every session — the restored database has different credentials', async () => {
      const { token } = sessions.issue();
      expect(sessions.validate(token)).not.toBeNull();

      const tarball = await takeBackup();
      const upload = join(outside, 'u4.tar.gz');
      await fs.copyFile(tarball, upload);
      const preview = await service.inspect(upload);
      await service.apply(preview.id);

      expect(sessions.validate(token)).toBeNull();
    });

    it('leaves a file created AFTER the backup alone, and says which names it touched', async () => {
      const tarball = await takeBackup();
      const upload = join(outside, 'u5.tar.gz');
      await fs.copyFile(tarball, upload);

      await fs.writeFile(join(home, 'brand-new.txt'), 'made later');
      const preview = await service.inspect(upload);
      const result = await service.apply(preview.id);

      expect(await exists(join(home, 'brand-new.txt'))).toBe(true);
      expect(result.restored).not.toContain('brand-new.txt');
    });

    it('installs the snapshot as the live database and clears the staging dir', async () => {
      const tarball = await takeBackup();
      const upload = join(outside, 'u6.tar.gz');
      await fs.copyFile(tarball, upload);
      const preview = await service.inspect(upload);
      await service.apply(preview.id);

      expect(await exists(join(home, '.imbatranim', 'db.sqlite'))).toBe(true);
      expect(await exists(join(home, '.imbatranim', 'backup-staging'))).toBe(
        false,
      );
    });

    it('leaves no scratch directories behind', async () => {
      const tarball = await takeBackup();
      const upload = join(outside, 'u7.tar.gz');
      await fs.copyFile(tarball, upload);
      const preview = await service.inspect(upload);
      await service.apply(preview.id);

      const left = await fs.readdir(home);
      expect(left.filter((n) => n.startsWith('.imbatranim-'))).toEqual([]);
      expect(await exists(upload)).toBe(false);
    });

    it('a backup of a restored home is itself restorable', async () => {
      const first = await takeBackup('first.tar.gz');
      const upload = join(outside, 'u8.tar.gz');
      await fs.copyFile(first, upload);
      await service.apply((await service.inspect(upload)).id);

      const second = await takeBackup('second.tar.gz');
      const list = await members(second);
      expect(list).toContain(BACKUP_METADATA.manifest);
      expect(list).toContain('Documents/letter.txt');
      expect(list).not.toContain('.imbatranim/db.sqlite');
    });
  });

  describe('when the disk is too small', () => {
    it('refuses rather than half-restoring, using the declared sizes', async () => {
      const tarball = await takeBackup();
      const upload = join(outside, 'u9.tar.gz');
      await fs.copyFile(tarball, upload);
      const preview = await service.inspect(upload);

      // Pretend the volume is down to a few bytes. `fs.statfs` itself is not
      // configurable enough to spy on, so the seam is the service's own reader.
      const free = jest
        .spyOn(
          service as unknown as { freeBytes: () => Promise<number> },
          'freeBytes',
        )
        .mockResolvedValue(1024);
      await expect(service.apply(preview.id)).rejects.toThrow(
        /only \d+ are free/,
      );
      free.mockRestore();

      // Untouched.
      expect(
        await fs.readFile(join(home, 'Documents', 'letter.txt'), 'utf8'),
      ).toBe('dear world');
    });

    it('reports fits:false in the preview so the UI can say so first', async () => {
      const tarball = await takeBackup();
      const upload = join(outside, 'u10.tar.gz');
      await fs.copyFile(tarball, upload);
      const free = jest
        .spyOn(
          service as unknown as { freeBytes: () => Promise<number> },
          'freeBytes',
        )
        .mockResolvedValue(1024);
      const preview = await service.inspect(upload);
      free.mockRestore();
      expect(preview.fits).toBe(false);
    });
  });
});
