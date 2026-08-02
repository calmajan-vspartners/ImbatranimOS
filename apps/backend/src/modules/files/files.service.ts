import {
  Injectable,
  NotFoundException,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { join, resolve, relative, basename, dirname, sep } from 'path';
import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import type { Dirent } from 'fs';
import * as os from 'os';
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
}

/** One hit from {@link FilesService.search}. `path` is root-relative. */
export interface SearchHit {
  name: string;
  path: string;
  type: 'file' | 'directory';
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
   * Fully percent-decode a path defensively (handles double/triple encoding
   * such as %252e). Stops on malformed input rather than throwing.
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
      prev = next;
    }
    return prev;
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
    };
  }

  async list(root: string, virtualPath = ''): Promise<FileEntry[]> {
    const { rootDir, abs } = await this.resolveSafe(root, virtualPath);
    if (!(await this.exists(abs)))
      throw new NotFoundException('Directory not found');
    const stat = await fs.stat(abs);
    if (!stat.isDirectory()) throw new BadRequestException('Not a directory');

    const entries = await fs.readdir(abs, { withFileTypes: true });
    return Promise.all(
      entries.map((e) => this.toEntry(rootDir, join(abs, e.name))),
    );
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

  async writeFile(
    root: string,
    virtualPath: string,
    content: string,
  ): Promise<FileEntry> {
    const { rootDir, abs } = await this.resolveSafe(root, virtualPath);
    await fs.mkdir(dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf-8');
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
      await fs.mkdir(dirname(abs), { recursive: true });
      // copyFile (not rename) so it works when tmp and data are on different
      // mounts; it streams in-kernel without buffering in the heap.
      await fs.copyFile(tmpPath, abs);
      return this.toEntry(rootDir, abs);
    } finally {
      await fs.rm(tmpPath, { force: true });
    }
  }

  async createDirectory(root: string, virtualPath: string): Promise<FileEntry> {
    const { rootDir, abs } = await this.resolveSafe(root, virtualPath);
    if (await this.exists(abs)) throw new BadRequestException('Already exists');
    await fs.mkdir(abs, { recursive: true });
    return this.toEntry(rootDir, abs);
  }

  async move(root: string, from: string, to: string): Promise<FileEntry> {
    const { rootDir, abs: absFrom } = await this.resolveSafe(root, from);
    const { abs: absTo } = await this.resolveSafe(root, to);
    if (!(await this.exists(absFrom)))
      throw new NotFoundException('Source not found');
    if (await this.exists(absTo))
      throw new BadRequestException('Destination already exists');
    await fs.mkdir(dirname(absTo), { recursive: true });
    await fs.rename(absFrom, absTo);
    return this.toEntry(rootDir, absTo);
  }

  async copy(root: string, from: string, to: string): Promise<FileEntry> {
    const { rootDir, abs: absFrom } = await this.resolveSafe(root, from);
    const { abs: absTo } = await this.resolveSafe(root, to);
    if (!(await this.exists(absFrom)))
      throw new NotFoundException('Source not found');
    if (await this.exists(absTo))
      throw new BadRequestException('Destination already exists');
    await fs.mkdir(dirname(absTo), { recursive: true });
    const stat = await fs.stat(absFrom);
    if (stat.isDirectory()) {
      await fs.cp(absFrom, absTo, { recursive: true });
    } else {
      await fs.copyFile(absFrom, absTo);
    }
    return this.toEntry(rootDir, absTo);
  }

  async delete(root: string, virtualPath: string): Promise<void> {
    const { abs } = await this.resolveSafe(root, virtualPath);
    if (!(await this.exists(abs))) throw new NotFoundException('Not found');
    const stat = await fs.lstat(abs);
    if (stat.isDirectory()) {
      await fs.rm(abs, { recursive: true });
    } else {
      await fs.unlink(abs);
    }
  }
}
