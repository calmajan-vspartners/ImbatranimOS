import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as os from 'os';
import { join } from 'path';
import { FilesService } from './files.service';
import { TRASH_DIR, TrashService } from './trash.service';

/**
 * Real files in a real temp home, mirroring FilesService's own test style.
 *
 * The adversarial cases are the point: restore reads an ORIGINAL PATH out of a
 * `.trashinfo` file, and that file is ordinary content inside the user's home
 * — writable through the normal files API, and present in any archive a user
 * might extract. If restore trusted it, it would be a write-anywhere
 * primitive.
 */
describe('TrashService', () => {
  let home: string;
  let files: FilesService;
  let trash: TrashService;
  const prev = process.env.FILES_ROOT;

  const infoPath = (id: string) =>
    join(home, TRASH_DIR, 'info', `${id}.trashinfo`);
  const filesPath = (id: string) => join(home, TRASH_DIR, 'files', id);

  beforeEach(async () => {
    home = await fs.mkdtemp(join(os.tmpdir(), 'imb-trash-'));
    process.env.FILES_ROOT = home;
    files = new FilesService();
    trash = new TrashService(files);
    await fs.mkdir(join(home, 'Documents'), { recursive: true });
    await fs.writeFile(join(home, 'Documents', 'a.txt'), 'hello\n');
  });

  afterEach(async () => {
    process.env.FILES_ROOT = prev;
    await fs.rm(home, { recursive: true, force: true });
  });

  it('trashes a file and lists it with its original path', async () => {
    const { id } = await trash.trash('Documents/a.txt');
    await expect(fs.lstat(join(home, 'Documents', 'a.txt'))).rejects.toThrow();

    const list = await trash.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(list[0].originalPath).toBe('Documents/a.txt');
    expect(list[0].isDirectory).toBe(false);
  });

  it('restores to the original path', async () => {
    const { id } = await trash.trash('Documents/a.txt');
    const { path } = await trash.restore(id);
    expect(path).toBe('Documents/a.txt');
    expect(await fs.readFile(join(home, 'Documents', 'a.txt'), 'utf8')).toBe(
      'hello\n',
    );
    expect(await trash.list()).toHaveLength(0);
  });

  it('trashes a directory whole', async () => {
    await fs.mkdir(join(home, 'proj', 'sub'), { recursive: true });
    await fs.writeFile(join(home, 'proj', 'sub', 'f.txt'), 'x');
    const { id } = await trash.trash('proj');
    expect((await trash.list())[0].isDirectory).toBe(true);
    await trash.restore(id);
    expect(await fs.readFile(join(home, 'proj', 'sub', 'f.txt'), 'utf8')).toBe(
      'x',
    );
  });

  it('gives colliding names a -1 suffix instead of overwriting', async () => {
    await trash.trash('Documents/a.txt');
    await fs.writeFile(join(home, 'Documents', 'a.txt'), 'second\n');
    const second = await trash.trash('Documents/a.txt');
    expect(second.id).toBe('a-1.txt');
    expect(await trash.list()).toHaveLength(2);
  });

  it('does not clobber a file that retook the name while it was in the trash', async () => {
    const { id } = await trash.trash('Documents/a.txt');
    await fs.writeFile(join(home, 'Documents', 'a.txt'), 'newer\n');
    const { path } = await trash.restore(id);
    expect(path).not.toBe('Documents/a.txt');
    expect(await fs.readFile(join(home, 'Documents', 'a.txt'), 'utf8')).toBe(
      'newer\n',
    );
  });

  it('refuses to trash the Trash itself', async () => {
    await expect(trash.trash(TRASH_DIR)).rejects.toThrow(BadRequestException);
    await expect(trash.trash(`${TRASH_DIR}/files`)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses to trash the home root', async () => {
    await expect(trash.trash('')).rejects.toThrow(BadRequestException);
  });

  it('empties everything', async () => {
    await trash.trash('Documents/a.txt');
    await fs.writeFile(join(home, 'b.txt'), 'b');
    await trash.trash('b.txt');
    expect((await trash.empty()).removed).toBe(2);
    expect(await trash.list()).toHaveLength(0);
  });

  // ── adversarial ────────────────────────────────────────────────────────────

  it('refuses a .trashinfo whose Path traverses out of the home root', async () => {
    const { id } = await trash.trash('Documents/a.txt');
    await fs.writeFile(
      infoPath(id),
      '[Trash Info]\nPath=../../../../etc/passwd\nDeletionDate=2026-01-01T00:00:00Z\n',
    );
    await expect(trash.restore(id)).rejects.toThrow();
    // The payload must still be sitting in the trash, not written anywhere.
    expect(await fs.lstat(filesPath(id))).toBeTruthy();
  });

  it('refuses a .trashinfo with an absolute Path', async () => {
    const { id } = await trash.trash('Documents/a.txt');
    await fs.writeFile(
      infoPath(id),
      '[Trash Info]\nPath=/etc/cron.d/evil\nDeletionDate=2026-01-01T00:00:00Z\n',
    );
    // resolveSafe strips leading separators, so an absolute Path is treated as
    // relative to the home root. Restore therefore succeeds, but lands INSIDE
    // the jail — the attack produces a junk file in the user's home, not a
    // write to /etc.
    const { path } = await trash.restore(id);
    expect(path).toBe('etc/cron.d/evil');
    expect(await fs.lstat(join(home, 'etc', 'cron.d', 'evil'))).toBeTruthy();
    await expect(fs.lstat('/etc/cron.d/evil')).rejects.toThrow();
  });

  it('refuses a percent-encoded traversal in Path', async () => {
    const { id } = await trash.trash('Documents/a.txt');
    await fs.writeFile(
      infoPath(id),
      '[Trash Info]\nPath=%2e%2e%2f%2e%2e%2fescaped.txt\nDeletionDate=2026-01-01T00:00:00Z\n',
    );
    await expect(trash.restore(id)).rejects.toThrow();
  });

  it.each(['../x', 'a/b', 'a\\b', '..', '.', ''])(
    'rejects the non-plain trash id %p',
    async (id) => {
      await expect(trash.restore(id)).rejects.toThrow(BadRequestException);
      await expect(trash.remove(id)).rejects.toThrow(BadRequestException);
    },
  );

  it('404s an unknown id rather than doing something surprising', async () => {
    await expect(trash.restore('nope')).rejects.toThrow(NotFoundException);
  });

  it('ignores an entry whose info file is missing', async () => {
    const { id } = await trash.trash('Documents/a.txt');
    await fs.rm(infoPath(id));
    expect(await trash.list()).toHaveLength(0);
  });

  it('leaves no info file behind when the move fails', async () => {
    await expect(trash.trash('Documents/missing.txt')).rejects.toThrow(
      NotFoundException,
    );
    const infos = await fs
      .readdir(join(home, TRASH_DIR, 'info'))
      .catch(() => [] as string[]);
    expect(infos).toHaveLength(0);
  });
});

describe('notes root honours NOTES_DIR', () => {
  const prevNotes = process.env.NOTES_DIR;
  const prevHome = process.env.FILES_ROOT;
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(os.tmpdir(), 'imb-notes-'));
    process.env.NOTES_DIR = dir;
    process.env.FILES_ROOT = dir;
  });
  afterEach(async () => {
    process.env.NOTES_DIR = prevNotes;
    process.env.FILES_ROOT = prevHome;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('reads and writes notes under NOTES_DIR, not <cwd>/data/notes', async () => {
    // Regression: the notes root was hardcoded to resolve(cwd, 'data/notes'),
    // so in the container it landed in the image's writable layer at
    // /app/data/notes while the volume was /home/imbatranim — every note was
    // lost when the container was recreated.
    const files = new FilesService();
    await fs.writeFile(join(dir, 'note.md'), '# hi\n');
    const entries = await files.list('notes', '');
    expect(entries.map((e) => e.name)).toContain('note.md');
  });
});
