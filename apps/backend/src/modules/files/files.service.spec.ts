import { FilesService } from './files.service';
import * as fs from 'fs/promises';
import * as os from 'os';
import { join } from 'path';
import type { Readable } from 'stream';

/** Drain a readable stream into a single Buffer. */
async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

describe('FilesService (jail + real filesystem)', () => {
  let service: FilesService;
  let jail: string;
  let outside: string;
  const prevEnv = process.env.FILES_ROOT;

  beforeEach(async () => {
    // A fresh scratch dir per test IS the `home` root for this run.
    jail = await fs.mkdtemp(join(os.tmpdir(), 'imb-jail-'));
    outside = await fs.mkdtemp(join(os.tmpdir(), 'imb-outside-'));
    process.env.FILES_ROOT = jail;
    service = new FilesService();
  });

  afterEach(async () => {
    process.env.FILES_ROOT = prevEnv;
    await fs.rm(jail, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  describe('real filesystem round-trips', () => {
    it('mkdir + createFile land on the real disk and list back', async () => {
      await service.createDirectory('home', 'projects');
      await service.createFile('home', 'projects/readme.txt', 'hi');

      // Confirm on the ACTUAL disk, not just via the API.
      const onDisk = await fs.readFile(
        join(jail, 'projects/readme.txt'),
        'utf-8',
      );
      expect(onDisk).toBe('hi');

      const listing = await service.list('home', 'projects');
      expect(listing.map((e) => e.name).sort()).toEqual(['readme.txt']);
    });

    it('a file created directly on disk shows up via list (and vice versa)', async () => {
      await fs.writeFile(join(jail, 'external.txt'), 'made outside the api');
      const listing = await service.list('home');
      expect(listing.find((e) => e.name === 'external.txt')).toBeTruthy();
    });

    it('round-trips a BINARY file byte-for-byte through upload + download', async () => {
      // Bytes, not a string: include NUL, 0xFF, and non-UTF-8 sequences.
      const bytes = Buffer.from([
        0x00, 0x01, 0x02, 0xff, 0xfe, 0x80, 0x7f, 0x00, 0xab, 0xcd,
      ]);
      // uploadFile now consumes an on-disk temp file (multer diskStorage), so
      // stage the bytes in a temp path — the service moves it into the jail.
      const tmpSrc = join(outside, 'upload-src.dat');
      await fs.writeFile(tmpSrc, bytes);
      await service.uploadFile('home', 'bin/blob.dat', tmpSrc);
      // The temp file is removed after a successful move.
      await expect(fs.stat(tmpSrc)).rejects.toThrow();

      const stream = await service.readFileStream('home', 'bin/blob.dat');
      const out = await collect(stream);
      expect(out.equals(bytes)).toBe(true);
      // And it really exists on disk with the same bytes.
      const onDisk = await fs.readFile(join(jail, 'bin/blob.dat'));
      expect(onDisk.equals(bytes)).toBe(true);
    });

    it('move renames on the real disk', async () => {
      await service.createFile('home', 'a.txt', 'x');
      await service.move('home', 'a.txt', 'b.txt');
      await expect(fs.stat(join(jail, 'a.txt'))).rejects.toBeTruthy();
      expect(await fs.readFile(join(jail, 'b.txt'), 'utf-8')).toBe('x');
    });

    it('delete removes from the real disk', async () => {
      await service.createFile('home', 'gone.txt', 'x');
      await service.delete('home', 'gone.txt');
      await expect(fs.stat(join(jail, 'gone.txt'))).rejects.toBeTruthy();
    });
  });

  describe('path-traversal jail', () => {
    it('refuses ../../etc/passwd', async () => {
      await expect(
        service.resolveSafe('home', '../../etc/passwd'),
      ).rejects.toThrow(/traversal/i);
      await expect(service.list('home', '../../etc')).rejects.toThrow(
        /traversal/i,
      );
    });

    it('refuses deeper ../ escapes and absolute re-rooting', async () => {
      await expect(
        service.resolveSafe('home', '../../../../../../etc/passwd'),
      ).rejects.toThrow(/traversal/i);
      // An absolute path must be treated as root-relative, never re-root.
      const { abs } = await service.resolveSafe('home', '/etc/passwd');
      expect(abs).toBe(join(jail, 'etc/passwd'));
    });

    it('refuses percent-encoded traversal (%2e%2e) including double-encoding', async () => {
      await expect(
        service.resolveSafe('home', '%2e%2e/%2e%2e/etc/passwd'),
      ).rejects.toThrow(/traversal/i);
      await expect(
        service.resolveSafe('home', '%2e%2e%2f%2e%2e%2fetc%2fpasswd'),
      ).rejects.toThrow(/traversal/i);
      // Double-encoded: %252e decodes to %2e decodes to '.'
      await expect(
        service.resolveSafe('home', '%252e%252e/%252e%252e/etc'),
      ).rejects.toThrow(/traversal/i);
    });

    it('refuses NUL byte injection', async () => {
      await expect(
        service.resolveSafe('home', 'ok\0/../../etc'),
      ).rejects.toThrow();
    });

    it('refuses a symlink that points outside the jail', async () => {
      // Plant a secret outside, then a symlink inside the jail pointing at it.
      await fs.writeFile(join(outside, 'secret.txt'), 'top secret');
      await fs.symlink(outside, join(jail, 'escape'), 'dir');

      // Traversing the symlink must be refused even though the link itself
      // lives inside the jail (lexical check passes; realpath does not).
      await expect(
        service.resolveSafe('home', 'escape/secret.txt'),
      ).rejects.toThrow(/traversal/i);
      await expect(service.list('home', 'escape')).rejects.toThrow(
        /traversal/i,
      );
      await expect(
        service.readFile('home', 'escape/secret.txt'),
      ).rejects.toThrow(/traversal/i);
    });

    it('refuses writing THROUGH a symlinked directory to escape the jail', async () => {
      await fs.symlink(outside, join(jail, 'link'), 'dir');
      // Target file does not exist yet — parent (the symlink) resolves out.
      await expect(
        service.createFile('home', 'link/planted.txt', 'nope'),
      ).rejects.toThrow(/traversal/i);
    });

    it('allows legitimate nested paths inside the jail', async () => {
      const { abs } = await service.resolveSafe('home', 'a/b/c.txt');
      expect(abs).toBe(join(jail, 'a/b/c.txt'));
    });

    it('refuses a mid-segment ../ that climbs out (a/../../etc)', async () => {
      await expect(
        service.resolveSafe('home', 'a/b/../../../etc/passwd'),
      ).rejects.toThrow(/traversal/i);
    });

    it('normalises an in-jail mid-segment ../ without escaping', async () => {
      // a/b/../c collapses to a/c — still inside the jail, so allowed.
      const { abs } = await service.resolveSafe('home', 'a/b/../c.txt');
      expect(abs).toBe(join(jail, 'a/c.txt'));
    });

    it('treats backslashes as literal filename chars on POSIX (no escape)', async () => {
      // On Linux `\` is NOT a path separator, so "..\..\etc" is a single
      // weird-but-contained segment, never a traversal. It must resolve inside
      // the jail rather than climb out.
      const { abs } = await service.resolveSafe('home', '..\\..\\etc');
      expect(abs.startsWith(jail)).toBe(true);
    });

    it('strips a leading backslash run so it cannot re-root', async () => {
      const { abs } = await service.resolveSafe('home', '\\\\etc\\passwd');
      expect(abs.startsWith(jail)).toBe(true);
    });
  });

  describe('search (jailed + bounded)', () => {
    // Env caps are read per-call by searchBounds(); snapshot/restore so a cap
    // test can dial one down without leaking into the next test.
    const capEnvKeys = [
      'FILES_SEARCH_MAX_RESULTS',
      'FILES_SEARCH_MAX_ENTRIES',
      'FILES_SEARCH_MAX_DEPTH',
      'FILES_SEARCH_BUDGET_MS',
      'FILES_SEARCH_MAX_CONTENT_BYTES',
    ];
    const capEnvSnapshot: Record<string, string | undefined> = {};
    beforeEach(() => {
      for (const k of capEnvKeys) capEnvSnapshot[k] = process.env[k];
    });
    afterEach(() => {
      for (const k of capEnvKeys) {
        if (capEnvSnapshot[k] === undefined) delete process.env[k];
        else process.env[k] = capEnvSnapshot[k];
      }
    });

    it('finds a file by case-insensitive filename substring', async () => {
      await service.createDirectory('home', 'docs');
      await service.createFile('home', 'docs/Report-2026.txt', 'body');
      await service.createFile('home', 'docs/notes.md', 'body');

      const { items, truncated } = await service.search('home', 'report');
      expect(truncated).toBe(false);
      expect(items.map((i) => i.name)).toEqual(['Report-2026.txt']);
      expect(items[0].path).toBe(join('docs', 'Report-2026.txt'));
      expect(items[0].type).toBe('file');
    });

    it('matches directory names too and returns type directory', async () => {
      await service.createDirectory('home', 'my-secret-folder');
      const { items } = await service.search('home', 'secret');
      expect(items).toEqual([
        {
          name: 'my-secret-folder',
          path: 'my-secret-folder',
          type: 'directory',
        },
      ]);
    });

    it('content grep finds a string inside a text file (content flag)', async () => {
      await service.createFile('home', 'a.txt', 'hello WORLD inside');
      await service.createFile('home', 'b.txt', 'nothing here');

      // Without content: no filename match for "world".
      const plain = await service.search('home', 'world');
      expect(plain.items).toEqual([]);

      // With content: case-insensitive body hit.
      const grep = await service.search('home', 'world', { content: true });
      expect(grep.items.map((i) => i.name)).toEqual(['a.txt']);
    });

    it('content grep skips binary files (NUL byte) and oversized files', async () => {
      // Binary file whose bytes happen to spell the needle around a NUL.
      await fs.writeFile(
        join(jail, 'blob.bin'),
        Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x00, 0x6c, 0x65]), // "need\0le"
      );
      const bin = await service.search('home', 'need', { content: true });
      expect(bin.items).toEqual([]);

      // Oversized text file is skipped by the per-file content cap.
      process.env.FILES_SEARCH_MAX_CONTENT_BYTES = '8';
      await service.createFile('home', 'big.txt', 'this is a long needle line');
      const big = await service.search('home', 'needle', { content: true });
      expect(big.items).toEqual([]);
    });

    it('jail holds: an unknown root is rejected via resolveSafe', async () => {
      await expect(service.search('nope', 'x')).rejects.toThrow(
        /unknown root/i,
      );
    });

    it('jail holds: a symlink out of the jail is never followed', async () => {
      // A matching file lives OUTSIDE the jail; a symlink inside points at it.
      await fs.writeFile(join(outside, 'target-secret.txt'), 'x');
      await fs.symlink(outside, join(jail, 'escape'), 'dir');

      const { items } = await service.search('home', 'secret');
      // The symlink dir is not descended, so the outside file never surfaces.
      expect(items).toEqual([]);
    });

    it('result cap trips → truncated, list bounded', async () => {
      process.env.FILES_SEARCH_MAX_RESULTS = '3';
      for (let i = 0; i < 10; i++) {
        await service.createFile('home', `match-${i}.txt`, 'x');
      }
      const { items, truncated } = await service.search('home', 'match');
      expect(items).toHaveLength(3);
      expect(truncated).toBe(true);
    });

    it('entry-scan cap trips → truncated', async () => {
      process.env.FILES_SEARCH_MAX_ENTRIES = '2';
      for (let i = 0; i < 10; i++) {
        await service.createFile('home', `file-${i}.txt`, 'x');
      }
      const { truncated } = await service.search('home', 'zzz-no-match');
      expect(truncated).toBe(true);
    });

    it('skips node_modules, .git and dot-directories', async () => {
      await service.createDirectory('home', 'node_modules');
      await service.createFile('home', 'node_modules/match.txt', 'x');
      await service.createDirectory('home', '.git');
      await service.createFile('home', '.git/match.txt', 'x');
      await service.createDirectory('home', '.hidden');
      await service.createFile('home', '.hidden/match.txt', 'x');
      await service.createFile('home', 'match.txt', 'x');

      const { items } = await service.search('home', 'match');
      // Only the top-level file; the heavy/dot dirs are never descended.
      expect(items.map((i) => i.path)).toEqual(['match.txt']);
    });
  });

  describe('uploadFile is atomic (brief 66)', () => {
    /** A multer-style on-disk temp file. */
    async function stageTmp(content: string): Promise<string> {
      const dir = await fs.mkdtemp(join(os.tmpdir(), 'imb-up-'));
      const p = join(dir, 'upload.bin');
      await fs.writeFile(p, content);
      return p;
    }

    // Failures are provoked with real filesystem conditions rather than by
    // mocking `fs`: `fs/promises` exports are non-configurable in Node 24, and a
    // test that cannot spy on the module is a better test anyway — these are
    // failures that actually happen.

    it('replaces an existing file with the new bytes', async () => {
      await service.createFile('home', 'doc.txt', 'old contents');
      await service.uploadFile(
        'home',
        'doc.txt',
        await stageTmp('new contents'),
      );
      expect(await fs.readFile(join(jail, 'doc.txt'), 'utf-8')).toBe(
        'new contents',
      );
    });

    it('leaves the original intact when the source vanishes mid-upload', async () => {
      // The bug this replaces: `copyFile` onto the destination TRUNCATES it
      // first, so any failure after that point left the user's file empty and
      // the original bytes gone. Every save in the OS goes through this method.
      await service.createFile('home', 'important.txt', 'the only copy');
      const tmp = await stageTmp('replacement');
      await fs.rm(tmp);

      await expect(
        service.uploadFile('home', 'important.txt', tmp),
      ).rejects.toThrow();

      expect(await fs.readFile(join(jail, 'important.txt'), 'utf-8')).toBe(
        'the only copy',
      );
      expect(await fs.readdir(jail)).toEqual(['important.txt']);
    });

    it('leaves the original intact when the commit itself fails', async () => {
      // A directory in the destination's place makes the RENAME fail — i.e. after
      // the staged copy has already succeeded, which is the half-written window
      // the old code could not survive.
      await service.createDirectory('home', 'blocked');
      await service.createFile('home', 'blocked/keep.txt', 'still here');

      await expect(
        service.uploadFile('home', 'blocked', await stageTmp('replacement')),
      ).rejects.toThrow();

      // The directory and its contents survive, and no staging file is left.
      expect(await fs.readFile(join(jail, 'blocked/keep.txt'), 'utf-8')).toBe(
        'still here',
      );
      expect(await fs.readdir(jail)).toEqual(['blocked']);
    });

    it('removes the multer temp file on success', async () => {
      // Otherwise every save slowly fills the temp directory.
      const tmp = await stageTmp('hello');
      await service.uploadFile('home', 'new.bin', tmp);
      await expect(fs.access(tmp)).rejects.toThrow();
    });

    it('removes the multer temp file when the commit fails', async () => {
      await service.createDirectory('home', 'blocked');
      const tmp = await stageTmp('replacement');
      await expect(
        service.uploadFile('home', 'blocked', tmp),
      ).rejects.toThrow();
      await expect(fs.access(tmp)).rejects.toThrow();
    });

    it('creates a file that did not exist yet, including its parents', async () => {
      await service.uploadFile(
        'home',
        'nested/new.bin',
        await stageTmp('hello'),
      );
      expect(await fs.readFile(join(jail, 'nested/new.bin'), 'utf-8')).toBe(
        'hello',
      );
    });

    it('preserves the existing file mode across the rename', async () => {
      // A rename carries the STAGED file's mode. Without copying the previous
      // mode across, saving a 0600 file would quietly widen it to the temp's.
      await service.createFile('home', 'secret.txt', 'old');
      await fs.chmod(join(jail, 'secret.txt'), 0o600);
      await service.uploadFile('home', 'secret.txt', await stageTmp('new'));

      const mode = (await fs.stat(join(jail, 'secret.txt'))).mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it('still refuses to escape the jail', async () => {
      await expect(
        service.uploadFile('home', '../escape.bin', await stageTmp('nope')),
      ).rejects.toThrow();
      await expect(
        fs.access(join(outside, '..', 'escape.bin')),
      ).rejects.toThrow();
    });
  });
});
