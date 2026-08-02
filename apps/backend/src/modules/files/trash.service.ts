import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { basename, dirname, join, relative, sep } from 'path';
import * as fs from 'fs/promises';
import { FilesService } from './files.service';

/**
 * Trash, following the freedesktop spec.
 *
 * The filesystem here is real, so the real spec is used rather than an
 * invented scheme: `~/.local/share/Trash/{files,info}`, one `<name>.trashinfo`
 * per entry recording where it came from and when it went. That means the bin
 * is intelligible from the Terminal too, which is on-soul for this project.
 *
 * Trashing is `rename`, never copy: same filesystem, so it is atomic and
 * instant regardless of how large the folder is, and cannot half-fail partway
 * through a big directory.
 *
 * Scope is the `home` root only. The `notes` root is a different directory
 * tree, so a cross-root rename would fail with EXDEV; `notes` keeps
 * confirm-then-permanent deletion.
 */

export const TRASH_DIR = join('.local', 'share', 'Trash');

export interface TrashEntry {
  /** Name inside Trash/files — the handle for restore/delete. */
  id: string;
  /** Original display name. */
  name: string;
  /** Original path relative to the home root, from the .trashinfo. */
  originalPath: string;
  deletedAt: string;
  isDirectory: boolean;
  sizeBytes: number;
}

@Injectable()
export class TrashService {
  constructor(private readonly files: FilesService) {}

  /**
   * The spec stores Path= percent-encoded. Encode every component but keep the
   * separators readable, matching what other implementations write.
   */
  private encodePath(p: string): string {
    return p.split('/').map(encodeURIComponent).join('/');
  }

  private async trashDirs(): Promise<{ filesDir: string; infoDir: string }> {
    const { abs } = await this.files.resolveSafe('home', TRASH_DIR);
    const filesDir = join(abs, 'files');
    const infoDir = join(abs, 'info');
    await fs.mkdir(filesDir, { recursive: true });
    await fs.mkdir(infoDir, { recursive: true });
    return { filesDir, infoDir };
  }

  /**
   * Reject an id that is anything other than a bare filename.
   *
   * The id comes from the client and is used to build a path inside the trash
   * directories, so `..`, a separator, or a NUL would otherwise be a way out.
   * `resolveSafe` is applied on top of this; both layers are deliberate.
   */
  private assertPlainId(id: string): void {
    if (
      !id ||
      id === '.' ||
      id === '..' ||
      id.includes('/') ||
      id.includes('\\') ||
      id.includes('\0') ||
      basename(id) !== id
    ) {
      throw new BadRequestException('Invalid trash id');
    }
  }

  /** A name inside Trash/files that does not collide, per the spec's -1/-2 rule. */
  private async uniqueName(filesDir: string, name: string): Promise<string> {
    let candidate = name;
    let n = 1;
    for (;;) {
      try {
        await fs.lstat(join(filesDir, candidate));
      } catch {
        return candidate;
      }
      const dot = name.indexOf('.', 1);
      candidate =
        dot > 0
          ? `${name.slice(0, dot)}-${n}${name.slice(dot)}`
          : `${name}-${n}`;
      n++;
    }
  }

  async trash(virtualPath: string): Promise<{ id: string }> {
    const { rootDir, abs } = await this.files.resolveSafe('home', virtualPath);

    const rel = relative(rootDir, abs);
    if (!rel || rel.startsWith('..')) {
      throw new BadRequestException('Cannot trash the home root');
    }
    // Trashing the trash (or anything inside it) would recurse into itself.
    if (rel === TRASH_DIR || rel.startsWith(TRASH_DIR + sep)) {
      throw new BadRequestException('Cannot trash the Trash');
    }

    try {
      await fs.lstat(abs);
    } catch {
      throw new NotFoundException('Not found');
    }

    const { filesDir, infoDir } = await this.trashDirs();
    const id = await this.uniqueName(filesDir, basename(abs));

    // Write the info file BEFORE moving: an entry in files/ with no info/ is
    // unrestorable, whereas a stale info/ with no files/ is merely ignored.
    const info =
      `[Trash Info]\n` +
      `Path=${this.encodePath(rel.split(sep).join('/'))}\n` +
      `DeletionDate=${new Date().toISOString()}\n`;
    await fs.writeFile(join(infoDir, `${id}.trashinfo`), info, 'utf8');

    try {
      await fs.rename(abs, join(filesDir, id));
    } catch (err) {
      await fs.rm(join(infoDir, `${id}.trashinfo`), { force: true });
      throw err;
    }
    return { id };
  }

  async list(): Promise<TrashEntry[]> {
    const { filesDir, infoDir } = await this.trashDirs();
    const names = await fs.readdir(filesDir).catch(() => [] as string[]);
    const out: TrashEntry[] = [];

    for (const id of names) {
      let raw: string;
      try {
        raw = await fs.readFile(join(infoDir, `${id}.trashinfo`), 'utf8');
      } catch {
        continue; // no info file — not restorable, so not listed
      }
      const pathLine = /^Path=(.*)$/m.exec(raw)?.[1] ?? '';
      const dateLine = /^DeletionDate=(.*)$/m.exec(raw)?.[1] ?? '';
      let originalPath: string;
      try {
        originalPath = decodeURIComponent(pathLine);
      } catch {
        originalPath = pathLine;
      }

      const st = await fs.lstat(join(filesDir, id)).catch(() => null);
      if (!st) continue;

      out.push({
        id,
        name: basename(originalPath) || id,
        originalPath,
        deletedAt: dateLine,
        isDirectory: st.isDirectory(),
        sizeBytes: st.isDirectory() ? 0 : st.size,
      });
    }
    return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }

  async restore(id: string): Promise<{ path: string }> {
    this.assertPlainId(id);
    const { filesDir, infoDir } = await this.trashDirs();

    const infoPath = join(infoDir, `${id}.trashinfo`);
    let raw: string;
    try {
      raw = await fs.readFile(infoPath, 'utf8');
    } catch {
      throw new NotFoundException('No such trash entry');
    }
    const pathLine = /^Path=(.*)$/m.exec(raw)?.[1] ?? '';
    let original: string;
    try {
      original = decodeURIComponent(pathLine);
    } catch {
      throw new BadRequestException('Corrupt trash entry');
    }

    // The recorded path is UNTRUSTED: a hand-written .trashinfo could name
    // `../../etc/passwd` or an absolute path, which would turn restore into a
    // write-anywhere primitive. Put it through the same jail as any client
    // path, and refuse anything that resolves outside the home root.
    const { rootDir, abs: target } = await this.files.resolveSafe(
      'home',
      original,
    );
    const rel = relative(rootDir, target);
    if (!rel || rel.startsWith('..')) {
      throw new BadRequestException('Trash entry has an invalid original path');
    }

    const source = join(filesDir, id);
    try {
      await fs.lstat(source);
    } catch {
      throw new NotFoundException('No such trash entry');
    }

    // Never clobber something that has taken the original name since.
    let dest = target;
    let n = 1;
    for (;;) {
      try {
        await fs.lstat(dest);
      } catch {
        break;
      }
      dest = join(dirname(target), `${basename(target)}-restored-${n}`);
      n++;
    }

    await fs.mkdir(dirname(dest), { recursive: true });
    await fs.rename(source, dest);
    await fs.rm(infoPath, { force: true });
    return { path: relative(rootDir, dest).split(sep).join('/') };
  }

  async remove(id: string): Promise<void> {
    this.assertPlainId(id);
    const { infoDir } = await this.trashDirs();
    // assertPlainId guarantees a bare filename, so this virtual path cannot
    // escape; resolveSafe re-checks it anyway (lexical + symlink containment).
    const { abs } = await this.files.resolveSafe(
      'home',
      [TRASH_DIR.split(sep).join('/'), 'files', id].join('/'),
    );
    await fs.rm(abs, { recursive: true, force: true });
    await fs.rm(join(infoDir, `${id}.trashinfo`), { force: true });
  }

  async empty(): Promise<{ removed: number }> {
    const { filesDir, infoDir } = await this.trashDirs();
    const names = await fs.readdir(filesDir).catch(() => [] as string[]);
    for (const name of names) {
      await fs.rm(join(filesDir, name), { recursive: true, force: true });
    }
    const infos = await fs.readdir(infoDir).catch(() => [] as string[]);
    for (const name of infos) {
      await fs.rm(join(infoDir, name), { force: true });
    }
    return { removed: names.length };
  }
}
