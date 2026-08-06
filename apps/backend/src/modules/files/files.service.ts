import {
  Injectable,
  NotFoundException,
  BadRequestException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { join, resolve, relative, basename, dirname, sep } from 'path';
import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import type { Dirent, Stats } from 'fs';
import * as os from 'os';
import { randomUUID } from 'crypto';
import type { Readable } from 'stream';

/**
 * Cap for the text-content endpoint. Reading into a UTF-8 string materialises
 * the whole file (plus its JSON-encoded copy) in the heap, so a huge file would
 * spike memory / stall the event loop. Large files should go through the
 * streaming download path instead. Env-overridable; defaults to 5 MB.
 */
const MAX_TEXT_FILE_BYTES =
  Number(process.env.FILES_MAX_TEXT_BYTES) || 5 * 1024 * 1024;

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: string;
  /** ctime — POSIX has no true birth time on every filesystem. */
  createdAt: string;
  /** POSIX permission bits as octal, e.g. "644". Display only. */
  mode: string;
  /** True when the entry itself is a symlink (type reflects its target). */
  isSymlink: boolean;
}

/** One hit from {@link FilesService.search}. `path` is root-relative. */
export interface SearchHit {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

/** Recursive size of a directory, with the caps that stopped the walk. */
export interface DirSize {
  bytes: number;
  files: number;
  directories: number;
  /** True when an entry/depth/time cap stopped the walk — the number is a floor. */
  truncated: boolean;
}

/**
 * Run a write and translate a full disk into something a human can act on.
 *
 * Nothing distinguished ENOSPC before, so a full volume surfaced as a raw 500
 * and every save just "failed" — the OS looked broken rather than out of space,
 * which on a container volume is a likely failure mode (one big download, one
 * archive extract, an accumulating Trash).
 *
 * Only ENOSPC/EDQUOT are translated. Permission errors, too-large uploads and
 * the rest keep their own distinct messages.
 */
async function withDiskSpaceCheck<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOSPC' || code === 'EDQUOT') {
      throw new ServiceUnavailableException(
        'The disk is full — free some space and try again.',
      );
    }
    throw err;
  }
}

export interface SearchResult {
  items: SearchHit[];
  /** True when any bound (results/entries/depth/time) stopped the walk early. */
  truncated: boolean;
}

/**
 * Directories the search walk never descends into. `node_modules`/`.git` are
 * huge + never interesting; dot-directories are skipped separately by prefix.
 */
const SEARCH_SKIP_DIRS = new Set(['node_modules', '.git']);

/**
 * Where the `notes` root lives. Both roots resolve dynamically (see
 * {@link FilesService.getRootDir}) so tests and the container can point them
 * at a real directory via env without re-importing the module.
 *
 * Read from NOTES_DIR at call time, like `homeRoot()` reads FILES_ROOT, rather
 * than baked in at import. It used to be a hardcoded `<cwd>/data/notes`, which
 * silently ignored NOTES_DIR — so in the container it resolved to
 * `/app/data/notes`, inside the image's writable layer, while the volume is
 * `/home/imbatranim` and `entrypoint.sh` was dutifully creating
 * `/home/imbatranim/notes` for nobody. Every note written in Notepad was
 * therefore destroyed the moment the container was recreated, which the README
 * actively encourages ("delete and recreate the container as often as you
 * like; the volume is what persists").
 *
 * The fallback keeps the previous behaviour when NOTES_DIR is unset.
 */
function notesRoot(): string {
  return resolve(process.env.NOTES_DIR || resolve(process.cwd(), 'data/notes'));
}

@Injectable()
export class FilesService {
  /**
   * The real home root: FILES_ROOT env override, else the process user's home
   * dir. In the container this IS /home/imbatranim. Resolved per-call so an
   * env change (tests) takes effect without a module reload.
   */
  private homeRoot(): string {
    return resolve(process.env.FILES_ROOT || os.homedir());
  }

  /** Resolve a root name to an absolute directory. Throws if unknown. */
  private getRootDir(root: string): string {
    if (root === 'home') return this.homeRoot();
    if (root === 'notes') return notesRoot();
    throw new BadRequestException(`Unknown root: ${root}`);
  }

  /**
   * Percent-decode a path defensively, unwrapping nested encoding of traversal
   * (e.g. `%252e%252e` → `%2e%2e` → `..`) WITHOUT over-decoding benign literals.
   *
   * Express already decodes query params once, so most input arrives decoded.
   * The old version decoded up to 6× unconditionally, which meant a real file
   * named `a%2Bb.txt` became `a+b.txt` (unaddressable) and `report%20v2.txt`
   * silently became `report v2.txt`. The fix keeps unwrapping only while a pass
   * actually REVEALS a new traversal-significant character (a path separator, a
   * `..` segment, or a NUL); the moment a pass introduces none of those, it is
   * decoding a legitimate literal, so we stop and keep the pre-decode form.
   *
   * Traversal safety is unchanged: encoded `..`/separators still unwrap all the
   * way to their dangerous form, where {@link resolveSafe}'s jail rejects them.
   */
  private fullyDecode(input: string): string {
    let prev = input;
    for (let i = 0; i < 6; i++) {
      let next: string;
      try {
        next = decodeURIComponent(prev);
      } catch {
        return prev; // malformed % sequence — treat remainder as literal
      }
      if (next === prev) return next;
      // A pass that reveals no new separator/`..`/NUL is unwrapping a benign
      // literal — keep the previous (still-encoded) form so it stays addressable.
      if (!this.revealsTraversalChar(prev, next)) return prev;
      prev = next;
    }
    return prev;
  }

  /**
   * True when `after` contains a traversal-significant character (a path
   * separator, a `..` path segment, or a NUL) that `before` did not — i.e. this
   * decode pass unwrapped something that matters to the jail.
   */
  private revealsTraversalChar(before: string, after: string): boolean {
    const dotdot = /(?:^|[/\\])\.\.(?:[/\\]|$)/;
    const sep = /[/\\]/;
    return (
      (sep.test(after) && !sep.test(before)) ||
      (dotdot.test(after) && !dotdot.test(before)) ||
      (after.includes('\0') && !before.includes('\0'))
    );
  }

  /**
   * realpath that tolerates a not-yet-existing leaf: walks up to the nearest
   * existing ancestor, canonicalises THAT (following symlinks), then re-appends
   * the missing (symlink-free, because non-existent) tail. This is what makes
   * the jail symlink-proof for create/upload/mkdir targets.
   */
  private async realpathAllowingMissing(p: string): Promise<string> {
    const missing: string[] = [];
    let current = p;
    // Bounded by path depth; dirname eventually hits the fs root fixpoint.
    for (;;) {
      try {
        const real = await fs.realpath(current);
        return missing.length
          ? resolve(real, ...missing.slice().reverse())
          : real;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        const parent = dirname(current);
        if (parent === current) return p; // nothing on this path exists
        missing.push(basename(current));
        current = parent;
      }
    }
  }

  /**
   * Resolve a root-relative virtual path to an absolute, jailed host path.
   *
   * Defence in depth:
   *  1. Full percent-decode, so encoded traversal (%2e%2e, %252e) can't slip
   *     past — Express already decodes query strings once; this catches nested
   *     encoding and direct service calls.
   *  2. Reject NUL bytes.
   *  3. Strip leading slashes/backslashes so the path is always root-relative
   *     (an absolute input can never re-root the resolve).
   *  4. Lexical jail: the resolved path must equal the root or sit under
   *     `root + sep` — kills `../` escapes.
   *  5. Symlink jail: realpath both the root and the target (or its nearest
   *     existing ancestor) and re-verify containment — kills symlink escapes.
   */
  async resolveSafe(
    root: string,
    virtualPath = '',
  ): Promise<{ rootDir: string; abs: string }> {
    const rootDir = this.getRootDir(root);
    let vp = this.fullyDecode(virtualPath ?? '');
    if (vp.includes('\0')) throw new BadRequestException('Invalid path');
    vp = vp.replace(/^[/\\]+/, '');
    const abs = resolve(rootDir, vp);

    // (4) lexical containment
    if (abs !== rootDir && !abs.startsWith(rootDir + sep)) {
      throw new BadRequestException('Path traversal detected');
    }

    // (5) symlink containment
    const realRoot = await this.realpathAllowingMissing(rootDir);
    const realTarget = await this.realpathAllowingMissing(abs);
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) {
      throw new BadRequestException('Path traversal detected');
    }

    return { rootDir, abs };
  }

  /**
   * Like {@link resolveSafe}, but validates realpath containment on the PARENT
   * directory only and never follows a symlink AT the leaf.
   *
   * `resolveSafe` realpaths the leaf, which follows a symlink there — so a
   * broken link (its target ENOENTs) reads as "not found" (404) and a link
   * pointing out of the jail reads as an escape (400). Both mean the UI can
   * never remove such a link. Operations that act on the link ITSELF
   * (delete/trash) resolve through this instead: the parent chain must still sit
   * inside the jail (symlink-proof), but the leaf is taken lexically so it can
   * be `lstat`/`unlink`ed as the link it is, never its target.
   */
  async resolveSafeNoFollow(
    root: string,
    virtualPath = '',
  ): Promise<{ rootDir: string; abs: string }> {
    const rootDir = this.getRootDir(root);
    let vp = this.fullyDecode(virtualPath ?? '');
    if (vp.includes('\0')) throw new BadRequestException('Invalid path');
    vp = vp.replace(/^[/\\]+/, '');
    const abs = resolve(rootDir, vp);

    if (abs !== rootDir && !abs.startsWith(rootDir + sep)) {
      throw new BadRequestException('Path traversal detected');
    }
    // No leaf (the root itself) — nothing to follow; defer to resolveSafe.
    if (abs === rootDir) return { rootDir, abs };

    const realRoot = await this.realpathAllowingMissing(rootDir);
    const realParent = await this.realpathAllowingMissing(dirname(abs));
    if (realParent !== realRoot && !realParent.startsWith(realRoot + sep)) {
      throw new BadRequestException('Path traversal detected');
    }
    // Return the lexical abs (like resolveSafe) — the containment check above
    // used the realpath, but lstat/unlink never follow the final component, so
    // the leaf link is operated on in place.
    return { rootDir, abs };
  }

  private async exists(p: string): Promise<boolean> {
    try {
      await fs.stat(p);
      return true;
    } catch {
      return false;
    }
  }

  private async toEntry(rootDir: string, absPath: string): Promise<FileEntry> {
    const stat = await fs.lstat(absPath);
    // Report the target type for symlinks so the UI treats them sensibly,
    // falling back to the link itself if the target is broken.
    let type: 'file' | 'directory' = stat.isDirectory() ? 'directory' : 'file';
    let size = stat.size;
    if (stat.isSymbolicLink()) {
      try {
        const t = await fs.stat(absPath);
        type = t.isDirectory() ? 'directory' : 'file';
        size = t.size;
      } catch {
        type = 'file';
      }
    }
    return {
      name: basename(absPath),
      path: relative(rootDir, absPath),
      type,
      size,
      modifiedAt: stat.mtime.toISOString(),
      createdAt: stat.ctime.toISOString(),
      mode: (stat.mode & 0o777).toString(8).padStart(3, '0'),
      isSymlink: stat.isSymbolicLink(),
    };
  }

  async list(root: string, virtualPath = ''): Promise<FileEntry[]> {
    const { rootDir, abs } = await this.resolveSafe(root, virtualPath);
    if (!(await this.exists(abs)))
      throw new NotFoundException('Directory not found');
    const stat = await fs.stat(abs);
    if (!stat.isDirectory()) throw new BadRequestException('Not a directory');

    const entries = await fs.readdir(abs, { withFileTypes: true });
    // An entry can vanish between readdir and lstat — e.g. uploadFile stages a
    // `.part` sibling in this very directory and renames it away, or another
    // client deletes a file mid-refresh. A per-entry ENOENT must drop that one
    // entry, not 500 the whole listing (mirrors dirSize's vanished-mid-walk
    // tolerance).
    const mapped = await Promise.all(
      entries.map((e) =>
        this.toEntry(rootDir, join(abs, e.name)).catch((err) => {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw err;
        }),
      ),
    );
    return mapped.filter((e): e is FileEntry => e !== null);
  }

  /**
   * Bounds for the search walk. Read per-call (not module-level consts) so tests
   * can dial them down via env without a module reload — the same idiom as
   * {@link FilesService.homeRoot}. Defaults keep a single search from walking the
   * whole disk or stalling the event loop.
   */
  private searchBounds() {
    return {
      // Hard cap on returned hits — the UI shows a bounded list anyway.
      maxResults: Number(process.env.FILES_SEARCH_MAX_RESULTS) || 100,
      // Ceiling on total dirents visited (the real DoS bound on tree size).
      maxEntries: Number(process.env.FILES_SEARCH_MAX_ENTRIES) || 20000,
      // Deepest directory level the walk will descend to.
      maxDepth: Number(process.env.FILES_SEARCH_MAX_DEPTH) || 12,
      // Wall-clock budget; past it we return partial results + truncated.
      budgetMs: Number(process.env.FILES_SEARCH_BUDGET_MS) || 3000,
      // Per-file size cap for the content grep; larger files are skipped.
      maxContentBytes:
        Number(process.env.FILES_SEARCH_MAX_CONTENT_BYTES) || 256 * 1024,
    };
  }

  /**
   * Jailed, bounded, live filename/content search under a root.
   *
   * Jail: the root is resolved through {@link resolveSafe} (lexical + symlink
   * containment). The walk starts at that real root and only ever `join`s
   * dirent names onto the current dir — no `..`, and symlinks are never
   * followed — so every emitted `path` (relative to the root) provably stays
   * inside the jail without a per-hit re-check.
   *
   * Bounds: results/entries/depth/time caps (see {@link searchBounds}); hitting
   * any returns the partial list with `truncated: true`. `node_modules`, `.git`
   * and dot-directories are always skipped.
   */
  async search(
    root: string,
    query: string,
    opts: { content?: boolean } = {},
  ): Promise<SearchResult> {
    // Jail the root exactly like every other endpoint (throws on escape).
    const { rootDir } = await this.resolveSafe(root, '');

    const needle = query.toLowerCase();
    const wantContent = opts.content === true;
    const bounds = this.searchBounds();
    const deadline = Date.now() + bounds.budgetMs;

    const items: SearchHit[] = [];
    let scanned = 0;
    let truncated = false;

    // An empty needle would match everything; the DTO forbids it, but guard the
    // direct-call path too rather than dumping the whole tree.
    if (needle.length === 0) return { items, truncated };

    const capHit = (): boolean => {
      if (
        items.length >= bounds.maxResults ||
        scanned >= bounds.maxEntries ||
        Date.now() > deadline
      ) {
        truncated = true;
        return true;
      }
      return false;
    };

    const walk = async (absDir: string, depth: number): Promise<void> => {
      if (truncated || depth > bounds.maxDepth) return;

      let entries: Dirent[];
      try {
        entries = await fs.readdir(absDir, { withFileTypes: true });
      } catch {
        return; // unreadable dir — skip it, don't abort the whole search
      }

      for (const entry of entries) {
        if (capHit()) return;

        const name = entry.name;
        // Never follow symlinks: keeps the walk inside the jail and cycle-free.
        if (entry.isSymbolicLink()) continue;

        const isDir = entry.isDirectory();
        // Always skip heavy/noisy dirs and any dot-directory.
        if (isDir && (SEARCH_SKIP_DIRS.has(name) || name.startsWith('.'))) {
          continue;
        }

        scanned++;
        const abs = join(absDir, name);
        const type: 'file' | 'directory' = isDir ? 'directory' : 'file';

        let matched = name.toLowerCase().includes(needle);
        if (!matched && wantContent && entry.isFile()) {
          matched = await this.contentMatches(
            abs,
            needle,
            bounds.maxContentBytes,
          );
        }

        if (matched) {
          items.push({ name, path: relative(rootDir, abs), type });
          if (capHit()) return;
        }

        if (isDir) {
          await walk(abs, depth + 1);
          if (truncated) return;
        }
      }
    };

    await walk(rootDir, 0);
    return { items, truncated };
  }

  /**
   * Cheap text-content grep for the search walk: skips oversized files and any
   * file that looks binary (a NUL byte in the sniff window). Reads at most one
   * file into the heap at a time. Any error → no match (never throws upward).
   */
  private async contentMatches(
    abs: string,
    needle: string,
    maxBytes: number,
  ): Promise<boolean> {
    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile() || stat.size > maxBytes) return false;
      const buf = await fs.readFile(abs);
      const sniff = Math.min(buf.length, 8192);
      for (let i = 0; i < sniff; i++) {
        if (buf[i] === 0) return false; // NUL ⇒ treat as binary, skip
      }
      return buf.toString('utf-8').toLowerCase().includes(needle);
    } catch {
      return false;
    }
  }

  async readFile(
    root: string,
    virtualPath: string,
  ): Promise<{ path: string; content: string }> {
    const { abs } = await this.resolveSafe(root, virtualPath);
    if (!(await this.exists(abs)))
      throw new NotFoundException('File not found');
    const stat = await fs.stat(abs);
    if (stat.isDirectory())
      throw new BadRequestException('Path is a directory');
    if (stat.size > MAX_TEXT_FILE_BYTES) {
      throw new PayloadTooLargeException(
        `File is too large to open as text (max ${MAX_TEXT_FILE_BYTES} bytes); download it instead`,
      );
    }
    const content = await fs.readFile(abs, 'utf-8');
    return { path: virtualPath, content };
  }

  /**
   * Resolve a file inside the jail and return its absolute path + size,
   * validated (exists, not a directory). Used by the download route to build
   * Range responses without a second resolve/stat when it opens the stream.
   */
  async statFile(
    root: string,
    virtualPath: string,
  ): Promise<{ abs: string; size: number }> {
    const { abs } = await this.resolveSafe(root, virtualPath);
    if (!(await this.exists(abs)))
      throw new NotFoundException('File not found');
    const stat = await fs.stat(abs);
    if (stat.isDirectory())
      throw new BadRequestException('Path is a directory');
    return { abs, size: stat.size };
  }

  async readFileStream(root: string, virtualPath: string): Promise<Readable> {
    const { abs } = await this.statFile(root, virtualPath);
    return createReadStream(abs);
  }

  /**
   * Open a byte range of an already-jailed absolute path (from `statFile`).
   * `start`/`end` are inclusive, as HTTP Range semantics require.
   */
  openRange(abs: string, start: number, end: number): Readable {
    return createReadStream(abs, { start, end });
  }

  /**
   * Open the whole of an already-jailed absolute path (from `statFile`), so the
   * download route need not re-resolve + re-stat a path it already validated.
   */
  openFile(abs: string): Readable {
    return createReadStream(abs);
  }

  async writeFile(
    root: string,
    virtualPath: string,
    content: string,
  ): Promise<FileEntry> {
    const { rootDir, abs } = await this.resolveSafe(root, virtualPath);
    await withDiskSpaceCheck(async () => {
      await fs.mkdir(dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, 'utf-8');
    });
    return this.toEntry(rootDir, abs);
  }

  async createFile(
    root: string,
    virtualPath: string,
    content = '',
  ): Promise<FileEntry> {
    const { rootDir, abs } = await this.resolveSafe(root, virtualPath);
    if (await this.exists(abs)) throw new BadRequestException('Already exists');
    await fs.mkdir(dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf-8');
    return this.toEntry(rootDir, abs);
  }

  /**
   * Move an already-on-disk upload (multer diskStorage temp file) into the
   * jail. Copying from the temp path avoids ever holding the whole upload in the
   * JS heap. The temp file is always removed, even if the destination path is
   * rejected by the jail.
   */
  async uploadFile(
    root: string,
    virtualPath: string,
    tmpPath: string,
  ): Promise<FileEntry> {
    try {
      const { rootDir, abs } = await this.resolveSafe(root, virtualPath);
      await withDiskSpaceCheck(async () => {
        await fs.mkdir(dirname(abs), { recursive: true });
      });

      // Stage beside the destination, then rename over it.
      //
      // `copyFile` straight onto `abs` TRUNCATES it before writing, so a failure
      // part-way through — a full disk, an OOM kill, a container restart — left
      // the user's file truncated and the original bytes gone. Every save in the
      // OS goes through here (Docs, Sheets, Slides, Notepad, Code Editor,
      // norPDF, images), so that was one interruption away from destroying a
      // document for any of them.
      //
      // `rename` within the same directory is atomic on POSIX: either the new
      // bytes are fully in place or the old file is untouched. Staging in the
      // destination's own directory rather than the OS temp dir is what makes
      // that guarantee hold — a rename across filesystems is not atomic and
      // would fall back to a copy.
      //
      // The multer temp file is still copied rather than renamed, because it
      // genuinely can be on another mount.
      const staged = join(
        dirname(abs),
        `.${basename(abs)}.imbatranim-${randomUUID()}.part`,
      );
      try {
        await withDiskSpaceCheck(() => fs.copyFile(tmpPath, staged));
        // A rename carries the staged file's mode, not the destination's, so an
        // existing file's permissions would silently reset to the temp's. Copy
        // them across first; a failure here is not worth losing the save over.
        const previous = await fs.stat(abs).catch(() => null);
        if (previous) {
          await fs.chmod(staged, previous.mode).catch(() => undefined);
        }
        await withDiskSpaceCheck(() => fs.rename(staged, abs));
      } catch (err) {
        // Leave the original exactly as it was.
        await fs.rm(staged, { force: true });
        throw err;
      }
      return this.toEntry(rootDir, abs);
    } finally {
      await fs.rm(tmpPath, { force: true });
    }
  }

  async createDirectory(root: string, virtualPath: string): Promise<FileEntry> {
    const { rootDir, abs } = await this.resolveSafe(root, virtualPath);
    if (await this.exists(abs)) throw new BadRequestException('Already exists');
    await withDiskSpaceCheck(() => fs.mkdir(abs, { recursive: true }));
    return this.toEntry(rootDir, abs);
  }

  async move(root: string, from: string, to: string): Promise<FileEntry> {
    const { rootDir, abs: absFrom } = await this.resolveSafe(root, from);
    const { abs: absTo } = await this.resolveSafe(root, to);
    if (!(await this.exists(absFrom)))
      throw new NotFoundException('Source not found');
    // Moving a directory into itself (a → a/b) is a raw EINVAL 500; reject it.
    if (absTo === absFrom || absTo.startsWith(absFrom + sep)) {
      throw new BadRequestException('Cannot move a folder into itself');
    }
    if (await this.exists(absTo))
      throw new BadRequestException('Destination already exists');
    await withDiskSpaceCheck(async () => {
      await fs.mkdir(dirname(absTo), { recursive: true });
      await fs.rename(absFrom, absTo);
    });
    return this.toEntry(rootDir, absTo);
  }

  async copy(root: string, from: string, to: string): Promise<FileEntry> {
    const { rootDir, abs: absFrom } = await this.resolveSafe(root, from);
    const { abs: absTo } = await this.resolveSafe(root, to);
    if (!(await this.exists(absFrom)))
      throw new NotFoundException('Source not found');
    // Copying a directory into itself (a → a/b) recurses / EINVALs into a 500.
    if (absTo === absFrom || absTo.startsWith(absFrom + sep)) {
      throw new BadRequestException('Cannot copy a folder into itself');
    }
    if (await this.exists(absTo))
      throw new BadRequestException('Destination already exists');
    // Wrap the writes in withDiskSpaceCheck so a full volume surfaces as a
    // clear 503 rather than a generic 500 — same as writeFile/uploadFile.
    const stat = await fs.stat(absFrom);
    await withDiskSpaceCheck(async () => {
      await fs.mkdir(dirname(absTo), { recursive: true });
      if (stat.isDirectory()) {
        await fs.cp(absFrom, absTo, { recursive: true });
      } else {
        await fs.copyFile(absFrom, absTo);
      }
    });
    return this.toEntry(rootDir, absTo);
  }

  async delete(root: string, virtualPath: string): Promise<void> {
    // No-follow resolve + lstat: a broken symlink (its target ENOENTs) or one
    // pointing out of the jail must still be removable — we operate on the link
    // itself, never its target.
    const { abs } = await this.resolveSafeNoFollow(root, virtualPath);
    let stat: Stats;
    try {
      stat = await fs.lstat(abs);
    } catch {
      throw new NotFoundException('Not found');
    }
    if (stat.isSymbolicLink()) {
      await fs.unlink(abs); // remove the link, never chase its target
    } else if (stat.isDirectory()) {
      await fs.rm(abs, { recursive: true });
    } else {
      await fs.unlink(abs);
    }
  }

  /**
   * Recursive size of a directory, bounded exactly like {@link search}.
   *
   * Computed in Node rather than by shelling out to `du`: the same lesson the
   * `ps` fix taught — the shipped image is busybox, and depending on whichever
   * userland happens to be present is how a feature ends up silently dead in
   * production.
   *
   * The caps mean a query pointed at a huge tree returns an honest floor with
   * `truncated: true` rather than hanging. Symlinks are never followed, so the
   * walk cannot leave the jail or loop.
   */
  async dirSize(root: string, virtualPath = ''): Promise<DirSize> {
    const { abs } = await this.resolveSafe(root, virtualPath);
    const bounds = this.searchBounds();
    const deadline = Date.now() + bounds.budgetMs;

    let bytes = 0;
    let files = 0;
    let directories = 0;
    let entries = 0;
    let truncated = false;

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (truncated) return;
      if (depth > bounds.maxDepth) {
        truncated = true;
        return;
      }
      let dirents: Dirent[];
      try {
        dirents = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return; // unreadable subtree — skip it rather than fail the whole query
      }
      for (const d of dirents) {
        if (++entries > bounds.maxEntries || Date.now() > deadline) {
          truncated = true;
          return;
        }
        if (d.isSymbolicLink()) continue; // never follow — jail + loop safety
        const full = join(dir, d.name);
        if (d.isDirectory()) {
          directories++;
          await walk(full, depth + 1);
          if (truncated) return;
        } else if (d.isFile()) {
          try {
            bytes += (await fs.lstat(full)).size;
            files++;
          } catch {
            /* vanished mid-walk */
          }
        }
      }
    };

    const st = await fs.lstat(abs).catch(() => null);
    if (!st) throw new NotFoundException('Not found');
    if (!st.isDirectory()) {
      return { bytes: st.size, files: 1, directories: 0, truncated: false };
    }
    await walk(abs, 0);
    return { bytes, files, directories, truncated };
  }
}
