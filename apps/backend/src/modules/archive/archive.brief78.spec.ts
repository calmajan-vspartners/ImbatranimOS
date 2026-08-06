import { zipSync, type Zippable } from 'fflate';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as os from 'os';
import { join } from 'path';
import { FilesService } from '../files/files.service';
import {
  ArchiveService,
  decodeEntryName,
  dosDateToIso,
  parseTarListLine,
} from './archive.service';

const execFileAsync = promisify(execFile);
const tar = async (args: string[]): Promise<void> => {
  await execFileAsync('tar', args);
};

/**
 * Brief 78: browsing, selective extraction and progress — against the REAL
 * filesystem and the REAL `tar`, like the module's existing spec.
 *
 * The point of these is the same as the originals: **a selection comes from the
 * client**, so it is a new way to reach the zip-slip machinery, and it must not
 * become a way around it.
 */
describe('ArchiveService — brief 78 (list, selective extract, jobs)', () => {
  let files: FilesService;
  let service: ArchiveService;
  let jail: string;
  let outside: string;
  const prevEnv = process.env.FILES_ROOT;

  beforeEach(async () => {
    jail = await fs.mkdtemp(join(os.tmpdir(), 'imb-a78-jail-'));
    outside = await fs.mkdtemp(join(os.tmpdir(), 'imb-a78-out-'));
    process.env.FILES_ROOT = jail;
    files = new FilesService();
    service = new ArchiveService(files);
  });

  afterEach(async () => {
    process.env.FILES_ROOT = prevEnv;
    await fs.rm(jail, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  /** Write a zip into the jail and return its root-relative path. */
  const writeZip = async (name: string, tree: Zippable): Promise<string> => {
    await fs.writeFile(join(jail, name), zipSync(tree));
    return name;
  };

  const bytes = (text: string) => new TextEncoder().encode(text);

  describe('list — reading an archive without extracting it', () => {
    it('returns names, sizes and dates, and writes nothing', async () => {
      const path = await writeZip('docs.zip', {
        'a.txt': bytes('hello'),
        'sub/b.txt': bytes('world!!'),
      });
      const before = await fs.readdir(jail);

      const listing = await service.list('home', path);

      expect(listing.format).toBe('zip');
      expect(listing.entries.map((e) => e.name).sort()).toEqual([
        'a.txt',
        'sub/b.txt',
      ]);
      expect(listing.entries.find((e) => e.name === 'a.txt')?.size).toBe(5);
      expect(listing.entries.find((e) => e.name === 'sub/b.txt')?.size).toBe(7);
      expect(listing.encrypted).toBe(false);
      // Nothing was extracted — the whole point.
      expect(await fs.readdir(jail)).toEqual(before);
    });

    it('lists a tar.gz with sizes, via the real tar', async () => {
      await fs.mkdir(join(jail, 'src'), { recursive: true });
      await fs.writeFile(join(jail, 'src', 'x.txt'), 'abcdef');
      await tar(['-czf', join(jail, 'p.tar.gz'), '-C', jail, 'src']);

      const listing = await service.list('home', 'p.tar.gz');
      expect(listing.format).toBe('targz');
      const file = listing.entries.find((e) => e.name.endsWith('x.txt'));
      expect(file?.size).toBe(6);
      expect(file?.directory).toBe(false);
      expect(listing.entries.some((e) => e.directory)).toBe(true);
    });

    it('REPORTS a traversal entry as refused instead of hiding it', async () => {
      // A listing that silently dropped the dangerous entry would be a listing
      // that lies about the file.
      const path = await writeZip('evil.zip', {
        'ok.txt': bytes('fine'),
        '../escaped.txt': bytes('nope'),
      });
      const listing = await service.list('home', path);
      expect(listing.entries.map((e) => e.name)).toEqual(['ok.txt']);
      expect(listing.refused).toHaveLength(1);
      expect(listing.refused[0].name).toBe('../escaped.txt');
      expect(listing.refused[0].reason).toMatch(/escapes the destination/);
    });

    it('refuses to list something that is not an archive', async () => {
      await fs.writeFile(join(jail, 'notes.txt'), 'plain');
      await expect(service.list('home', 'notes.txt')).rejects.toThrow(
        /Unsupported archive format/,
      );
    });

    it('refuses a path outside the jail', async () => {
      await expect(service.list('home', '../../etc/passwd')).rejects.toThrow();
    });

    it('rejects a corrupt zip rather than returning nonsense', async () => {
      await fs.writeFile(join(jail, 'broken.zip'), 'not a zip at all');
      await expect(service.list('home', 'broken.zip')).rejects.toThrow(
        /valid zip/,
      );
    });
  });

  describe('selective extraction', () => {
    it('extracts only the chosen entries from a zip', async () => {
      const path = await writeZip('pick.zip', {
        'keep.txt': bytes('yes'),
        'skip.txt': bytes('no'),
        'sub/also.txt': bytes('yes2'),
      });

      const result = await service.extract('home', path, 'out', [
        'keep.txt',
        'sub/also.txt',
      ]);

      expect(result.entries).toBe(2);
      const written = await fs.readdir(join(jail, 'out'));
      expect(written.sort()).toEqual(['keep.txt', 'sub']);
      await expect(fs.stat(join(jail, 'out', 'skip.txt'))).rejects.toThrow();
      expect(
        await fs.readFile(join(jail, 'out', 'sub', 'also.txt'), 'utf8'),
      ).toBe('yes2');
    });

    it('extracts only the chosen members from a tar.gz', async () => {
      await fs.mkdir(join(jail, 'src'), { recursive: true });
      await fs.writeFile(join(jail, 'src', 'one.txt'), '1');
      await fs.writeFile(join(jail, 'src', 'two.txt'), '2');
      await tar(['-czf', join(jail, 'p.tar.gz'), '-C', jail, 'src']);

      await service.extract('home', 'p.tar.gz', 'out', ['src/one.txt']);

      expect(await fs.readdir(join(jail, 'out', 'src'))).toEqual(['one.txt']);
    });

    it('REFUSES a selected name the archive does not declare', async () => {
      // A client inventing a path is the whole risk of a selection. It must not
      // be handed to tar "just in case".
      const path = await writeZip('pick.zip', { 'real.txt': bytes('x') });
      await expect(
        service.extract('home', path, 'out', ['../../etc/passwd']),
      ).rejects.toThrow(/does not contain an entry named/);
      await expect(
        service.extract('home', path, 'out', ['invented.txt']),
      ).rejects.toThrow(/does not contain an entry named/);
    });

    it('still refuses the WHOLE archive when a non-selected entry is dangerous', async () => {
      // The selection must not become a way to sneak past the jail check by
      // simply not selecting the bad entry.
      const path = await writeZip('mixed.zip', {
        'safe.txt': bytes('ok'),
        '../escaped.txt': bytes('nope'),
      });
      await expect(
        service.extract('home', path, 'out', ['safe.txt']),
      ).rejects.toThrow(/escapes the destination/);
      await expect(fs.stat(join(outside, 'escaped.txt'))).rejects.toThrow();
    });

    it('an empty selection means the whole archive, not nothing', async () => {
      const path = await writeZip('all.zip', {
        'a.txt': bytes('1'),
        'b.txt': bytes('2'),
      });
      const result = await service.extract('home', path, 'out', []);
      expect(result.entries).toBe(2);
    });

    it('a selected member name beginning with `-` cannot become a tar option', async () => {
      await fs.mkdir(join(jail, 'src'), { recursive: true });
      await fs.writeFile(join(jail, 'src', '-rf.txt'), 'tricky');
      await tar(['-czf', join(jail, 'dash.tar.gz'), '-C', jail, 'src']);

      await service.extract('home', 'dash.tar.gz', 'out', ['src/-rf.txt']);
      expect(
        await fs.readFile(join(jail, 'out', 'src', '-rf.txt'), 'utf8'),
      ).toBe('tricky');
    });
  });

  describe('extraction jobs (progress)', () => {
    const settle = async (id: string) => {
      for (let i = 0; i < 100; i++) {
        const job = service.getJob(id);
        if (job.state !== 'running') return job;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error('job never settled');
    };

    it('reports done with the result', async () => {
      const path = await writeZip('job.zip', { 'a.txt': bytes('hello') });
      const { id } = service.startExtractJob('home', path, 'out');
      const job = await settle(id);
      expect(job.state).toBe('done');
      expect(job.percent).toBe(100);
      expect(job.result?.entries).toBe(1);
      expect(await fs.readFile(join(jail, 'out', 'a.txt'), 'utf8')).toBe(
        'hello',
      );
    });

    it('reports failed WITH the reason, rather than stalling silently', async () => {
      const path = await writeZip('bad.zip', { '../escaped.txt': bytes('x') });
      const { id } = service.startExtractJob('home', path, 'out');
      const job = await settle(id);
      expect(job.state).toBe('failed');
      expect(job.error).toMatch(/escapes the destination/);
    });

    it('gives each job an unguessable id, not a counter', async () => {
      const path = await writeZip('j.zip', { 'a.txt': bytes('x') });
      const a = service.startExtractJob('home', path, 'outA').id;
      const b = service.startExtractJob('home', path, 'outB').id;
      expect(a).not.toBe(b);
      // A UUID, so another request cannot enumerate someone else's result.
      expect(a).toMatch(/^[0-9a-f-]{36}$/);
      await settle(a);
      await settle(b);
    });

    it('404s an id that does not exist', () => {
      expect(() =>
        service.getJob('00000000-0000-0000-0000-000000000000'),
      ).toThrow(/No such extraction job/);
    });
  });

  describe('formats — the read/create matrix verified against the image', () => {
    it('reads .tar, .tgz and .tar.bz2', async () => {
      await fs.mkdir(join(jail, 'src'), { recursive: true });
      await fs.writeFile(join(jail, 'src', 'a.txt'), 'plain');

      await tar(['-cf', join(jail, 'plain.tar'), '-C', jail, 'src']);
      expect((await service.list('home', 'plain.tar')).format).toBe('tar');

      await tar(['-czf', join(jail, 'short.tgz'), '-C', jail, 'src']);
      expect((await service.list('home', 'short.tgz')).format).toBe('targz');

      await tar(['-cjf', join(jail, 'b.tar.bz2'), '-C', jail, 'src']);
      const bz2 = await service.list('home', 'b.tar.bz2');
      expect(bz2.format).toBe('tarbz2');
      expect(bz2.entries.some((e) => e.name.endsWith('a.txt'))).toBe(true);
    });

    it('extracts a .tar.bz2 for real', async () => {
      await fs.mkdir(join(jail, 'src'), { recursive: true });
      await fs.writeFile(join(jail, 'src', 'a.txt'), 'compressed');
      await tar(['-cjf', join(jail, 'b.tar.bz2'), '-C', jail, 'src']);

      await service.extract('home', 'b.tar.bz2', 'out');
      expect(await fs.readFile(join(jail, 'out', 'src', 'a.txt'), 'utf8')).toBe(
        'compressed',
      );
    });

    it('READS a .tar.xz — the image can decompress it even though it cannot create one', async () => {
      // Verified from Alpine's busybox config: FEATURE_SEAMLESS_XZ=y (read), but
      // `# CONFIG_XZ is not set` (no xz applet to exec for create). This asserts
      // the read half; the create half is refused by the DTO's format union.
      await fs.mkdir(join(jail, 'src'), { recursive: true });
      await fs.writeFile(join(jail, 'src', 'a.txt'), 'xz content');
      await tar(['-cJf', join(jail, 'x.tar.xz'), '-C', jail, 'src']);

      const listing = await service.list('home', 'x.tar.xz');
      expect(listing.format).toBe('tarxz');
      expect(listing.entries.some((e) => e.name.endsWith('a.txt'))).toBe(true);

      await service.extract('home', 'x.tar.xz', 'out');
      expect(await fs.readFile(join(jail, 'out', 'src', 'a.txt'), 'utf8')).toBe(
        'xz content',
      );
    });

    it('refuses a format it does not know', async () => {
      await fs.writeFile(join(jail, 'a.7z'), 'x');
      await expect(service.list('home', 'a.7z')).rejects.toThrow(
        /Unsupported archive format/,
      );
      await fs.writeFile(join(jail, 'a.rar'), 'x');
      await expect(service.extract('home', 'a.rar')).rejects.toThrow(
        /Unsupported archive format/,
      );
    });
  });
});

describe('brief 78 pure helpers', () => {
  describe('decodeEntryName', () => {
    it('decodes valid UTF-8 unchanged', () => {
      const bytes = new TextEncoder().encode('café/naïve.txt');
      expect(decodeEntryName(bytes, true)).toEqual({
        name: 'café/naïve.txt',
        repaired: false,
      });
    });

    it('repairs invalid bytes and SAYS it repaired them', () => {
      // A legacy CP437 name: 0xE9 is 'é' in CP437 but invalid alone in UTF-8.
      const bytes = new Uint8Array([
        0x63, 0x61, 0x66, 0xe9, 0x2e, 0x74, 0x78, 0x74,
      ]);
      const result = decodeEntryName(bytes, false);
      expect(result.repaired).toBe(true);
      expect(result.name).toContain('�');
      // The repair cannot invent a traversal or a NUL.
      expect(result.name).not.toContain('..');
      expect(result.name).not.toContain('\0');
    });

    it('a repaired name never gains a path separator', () => {
      const bytes = new Uint8Array([0xff, 0xfe, 0xfd]);
      const result = decodeEntryName(bytes, false);
      expect(result.name.includes('/')).toBe(false);
      expect(result.name.includes('\\')).toBe(false);
    });
  });

  describe('dosDateToIso', () => {
    it('converts a real DOS timestamp', () => {
      // 2026-08-05 12:34:56 → date=((2026-1980)<<9)|(8<<5)|5, time=(12<<11)|(34<<5)|28
      const dosDate = ((2026 - 1980) << 9) | (8 << 5) | 5;
      const dosTime = (12 << 11) | (34 << 5) | 28;
      expect(dosDateToIso(dosDate, dosTime)).toBe('2026-08-05T12:34:56.000Z');
    });

    it('is null for an unset date rather than 1980-00-00', () => {
      expect(dosDateToIso(0, 0)).toBeNull();
    });

    it('is null for an impossible month or day', () => {
      expect(dosDateToIso((46 << 9) | (13 << 5) | 5, 0)).toBeNull();
      expect(dosDateToIso((46 << 9) | (8 << 5) | 0, 0)).toBeNull();
    });
  });

  describe('parseTarListLine', () => {
    it('reads a busybox-style line', () => {
      const row = parseTarListLine(
        '-rw-r--r-- 1000/1000          1234 2026-08-05 12:34:56 src/a.txt',
      );
      expect(row).toMatchObject({
        name: 'src/a.txt',
        size: 1234,
        directory: false,
        modified: '2026-08-05T12:34:56.000Z',
      });
    });

    it('reads a GNU-style line with a minute-only timestamp', () => {
      const row = parseTarListLine(
        '-rw-r--r-- root/root 10 2026-08-05 12:34 a.txt',
      );
      expect(row.size).toBe(10);
      expect(row.modified).toBe('2026-08-05T12:34:00.000Z');
    });

    it('keeps a filename containing spaces whole', () => {
      // Parsing by column index would truncate this at the first space.
      const row = parseTarListLine(
        '-rw-r--r-- 1000/1000 5 2026-08-05 12:34:56 dir/my long name.txt',
      );
      expect(row.name).toBe('dir/my long name.txt');
    });

    it('marks a directory line', () => {
      const row = parseTarListLine(
        'drwxr-xr-x 1000/1000 0 2026-08-05 12:34:56 src/',
      );
      expect(row.directory).toBe(true);
    });

    it('takes the left side of a symlink line, not the target', () => {
      const row = parseTarListLine(
        'lrwxrwxrwx 1000/1000 0 2026-08-05 12:34:56 link -> ../outside',
      );
      expect(row.name).toBe('link');
    });

    it('falls back to a bare name rather than dropping an odd line', () => {
      const row = parseTarListLine('weird-output-line');
      expect(row.name).toBe('weird-output-line');
      expect(row.size).toBeNull();
    });
  });
});
