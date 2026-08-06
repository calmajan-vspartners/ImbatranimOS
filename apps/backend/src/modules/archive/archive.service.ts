import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { unzip, zip, type Unzipped, type AsyncZippable } from 'fflate';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import type { Stats } from 'fs';
import { basename, dirname, join, posix, relative, sep } from 'path';
import { FilesService } from '../files/files.service';
import type { ArchiveFormat } from './dto/archive.dto';

/**
 * Spawn the real `tar` binary with a fixed argv array and NO shell. We use
 * Node's built-in `child_process.execFile` (never `exec`, never `shell:true`)
 * rather than execa: execa v9 is pure ESM and cannot be loaded under the repo's
 * CommonJS jest config, which would make the security tests unrunnable — and
 * those tests are the point of this module. `execFile` gives the identical
 * guarantee (argv array, no shell interpolation) with zero dependencies.
 */
const execFileAsync = promisify(execFile);

/** Wall-clock cap so a wedged tar can't hang a request. */
const TAR_TIMEOUT_MS = Number(process.env.ARCHIVE_TAR_TIMEOUT_MS) || 60_000;
/** Cap on tar's captured stdout (the member listing). */
const TAR_MAX_BUFFER =
  Number(process.env.ARCHIVE_TAR_MAX_BUFFER) || 32 * 1024 * 1024;

/**
 * Resource caps (zip-bomb / OOM guard). All env-overridable so the deploy can
 * tune them without a code change; read per-call so an env change takes effect
 * without a module reload. These bound the declared header sizes AND the actual
 * inflated bytes — a lying header can't slip past the total-bytes cap because it
 * is re-checked against actually-inflated bytes.
 */
const MAX_ENTRIES = () => Number(process.env.ARCHIVE_MAX_ENTRIES) || 10_000;
const MAX_TOTAL_BYTES = () =>
  Number(process.env.ARCHIVE_MAX_TOTAL_BYTES) || 512 * 1024 * 1024;
const MAX_ENTRY_BYTES = () =>
  Number(process.env.ARCHIVE_MAX_ENTRY_BYTES) || 512 * 1024 * 1024;
/** Cap on the compressed archive itself, so reading it can't blow the heap. */
const MAX_ARCHIVE_BYTES = () =>
  Number(process.env.ARCHIVE_MAX_ARCHIVE_BYTES) || 200 * 1024 * 1024;
/**
 * Max plausible uncompressed:compressed ratio. DEFLATE's theoretical ceiling is
 * ~1032:1; we allow generous headroom. Critically, this bounds the per-entry /
 * total *declared* size to a small multiple of the ACTUAL archive bytes — so a
 * tiny archive whose central-directory header lies (e.g. 387 bytes declaring
 * 512 MiB) can't force `unzipSync` to pre-allocate the forged size. Without this
 * the absolute caps alone permit a ~1500x memory-amplification DoS.
 */
const MAX_COMPRESSION_RATIO = () =>
  Number(process.env.ARCHIVE_MAX_RATIO) || 2000;

export interface ExtractResult {
  dest: string;
  entries: number;
  totalBytes: number;
}

export interface CompressResult {
  dest: string;
  entries: number;
  bytes: number;
}

@Injectable()
export class ArchiveService {
  constructor(private readonly files: FilesService) {}

  // ── extract ────────────────────────────────────────────────────────────────

  async extract(
    root: string,
    path: string,
    dest?: string,
  ): Promise<ExtractResult> {
    const { abs: archiveAbs } = await this.files.resolveSafe(root, path);
    const stat = await this.statFile(archiveAbs);
    if (stat.size > MAX_ARCHIVE_BYTES()) {
      throw new PayloadTooLargeException(
        `Archive is too large to extract (max ${MAX_ARCHIVE_BYTES()} bytes)`,
      );
    }

    // Destination: caller-supplied, else a sibling folder named after the
    // archive (foo.tar.gz -> foo). Always re-jailed.
    const destVirtual = dest ?? this.deriveDest(path);
    const { abs: destAbs } = await this.files.resolveSafe(root, destVirtual);

    const format = this.detectFormat(path);
    await fs.mkdir(destAbs, { recursive: true });

    if (format === 'zip') {
      return this.extractZip(root, destVirtual, destAbs, archiveAbs);
    }
    return this.extractTar(root, destVirtual, destAbs, archiveAbs, format);
  }

  /**
   * ZIP via fflate. THE JAIL: every entry name is joined to the destination and
   * re-validated through `resolveSafe` BEFORE a single byte is written. Names
   * are never trusted — `../x`, `/abs/x`, or a name whose realpath escapes are
   * hard-failed for the whole extraction. Note fflate has no notion of symlink
   * entries; a "symlink" entry is written as an ordinary file containing the
   * target text, so a zip cannot plant a traversing symlink at all.
   *
   * Zip-bomb guard runs in two layers:
   *   (1) a cheap central-directory scan ({@link inspectZip}) enforces the entry
   *       COUNT cap and the declared-uncompressed-size cap WITHOUT inflating a
   *       byte, so an honest bomb (headers report the true huge size) is
   *       rejected before any work.
   *   (2) after inflation, the ACTUAL decompressed sizes are summed and
   *       re-checked, so a header that lies about its size can't slip past.
   */
  private async extractZip(
    root: string,
    destVirtual: string,
    destAbs: string,
    archiveAbs: string,
  ): Promise<ExtractResult> {
    const buf = await fs.readFile(archiveAbs);
    const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

    // (1) PRE-INFLATION guard: parse the ZIP central directory for entry count
    // and DECLARED uncompressed sizes and enforce the caps BEFORE inflating a
    // single byte — so an honest zip-bomb is rejected without doing the work.
    // (fflate's CJS `unzipSync` ignores its `filter` option, so we parse the
    // directory ourselves rather than trusting fflate to gate per entry.)
    this.inspectZip(data);

    // (2) Inflate, then verify ACTUAL inflated sizes against the caps (defeats a
    // header that lies about its size). Async `unzip` (not `unzipSync`): a large
    // archive inflates in chunks off the main thread instead of blocking all
    // HTTP + PTY for seconds. The size/ratio caps above still gate the work.
    let unzipped: Unzipped;
    try {
      unzipped = await new Promise<Unzipped>((resolve, reject) => {
        unzip(data, (err, out) => {
          if (err) reject(err instanceof Error ? err : new Error(err));
          else resolve(out);
        });
      });
    } catch {
      throw new BadRequestException('Corrupt or unreadable zip archive');
    }

    const names = Object.keys(unzipped);
    if (names.length > MAX_ENTRIES()) {
      throw new PayloadTooLargeException(
        `Archive has too many entries (max ${MAX_ENTRIES()})`,
      );
    }
    let actualTotal = 0;
    for (const name of names) {
      const size = unzipped[name].length;
      actualTotal += size;
      if (size >= MAX_ENTRY_BYTES() || actualTotal >= MAX_TOTAL_BYTES()) {
        throw new PayloadTooLargeException(
          `Archive uncompresses past the size cap (max ${MAX_TOTAL_BYTES()} bytes)`,
        );
      }
    }

    // (3) JAIL — resolve every entry against the dest, reject the whole
    // extraction on ANY escape, BEFORE writing anything.
    const absByName = new Map<string, string>();
    for (const name of names) {
      absByName.set(
        name,
        await this.resolveEntry(root, destVirtual, destAbs, name),
      );
    }

    // (4) Only now, write. Directory entries (trailing '/') become dirs.
    let fileCount = 0;
    for (const name of names) {
      const abs = absByName.get(name)!;
      if (name.endsWith('/')) {
        await fs.mkdir(abs, { recursive: true });
        continue;
      }
      await fs.mkdir(dirname(abs), { recursive: true });
      await fs.writeFile(abs, unzipped[name]);
      fileCount++;
    }

    return { dest: destVirtual, entries: fileCount, totalBytes: actualTotal };
  }

  /**
   * Minimal ZIP central-directory scan: entry count + declared uncompressed
   * sizes, WITHOUT inflating. Enforces the count / per-entry / total caps so an
   * honest zip-bomb is rejected up front. A ZIP64 size marker (0xFFFFFFFF) is
   * treated as "over cap" (our caps are far below 4 GiB anyway), never trusted
   * as a small value. Throws PayloadTooLargeException past a cap, BadRequest on
   * a structurally invalid archive.
   */
  private inspectZip(data: Uint8Array): void {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    // Locate the End Of Central Directory record: scan back for its signature
    // (0x06054b50). The trailing comment is bounded to 64 KiB by the spec.
    const EOCD_SIG = 0x06054b50;
    const CDH_SIG = 0x02014b50;
    let eocd = -1;
    const minPos = Math.max(0, data.length - 22 - 0xffff);
    for (let i = data.length - 22; i >= minPos; i--) {
      if (view.getUint32(i, true) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new BadRequestException('Not a valid zip archive');

    const totalEntries = view.getUint16(eocd + 10, true);
    if (totalEntries > MAX_ENTRIES()) {
      throw new PayloadTooLargeException(
        `Archive has too many entries (max ${MAX_ENTRIES()})`,
      );
    }
    let cdOffset = view.getUint32(eocd + 16, true);

    // The declared sizes drive `unzipSync`'s pre-allocation, so bound them by a
    // ratio of the ACTUAL archive bytes (not just the absolute caps) — this is
    // what stops a forged-header amplification DoS. `>=` (not `>`) so a value
    // exactly at the cap is rejected too.
    const ratioCap = data.length * MAX_COMPRESSION_RATIO();
    const entryCap = Math.min(MAX_ENTRY_BYTES(), ratioCap);
    const totalCap = Math.min(MAX_TOTAL_BYTES(), ratioCap);

    let declaredTotal = 0;
    for (let n = 0; n < totalEntries; n++) {
      if (
        cdOffset + 46 > data.length ||
        view.getUint32(cdOffset, true) !== CDH_SIG
      ) {
        throw new BadRequestException('Corrupt zip central directory');
      }
      const uncompressed = view.getUint32(cdOffset + 24, true);
      const nameLen = view.getUint16(cdOffset + 28, true);
      const extraLen = view.getUint16(cdOffset + 30, true);
      const commentLen = view.getUint16(cdOffset + 32, true);
      // 0xFFFFFFFF => real size lives in a ZIP64 extra field; treat as over-cap.
      const size = uncompressed === 0xffffffff ? Infinity : uncompressed;
      declaredTotal += size;
      if (size >= entryCap || declaredTotal >= totalCap) {
        throw new PayloadTooLargeException(
          `Archive uncompresses past the size cap (max ${totalCap} bytes)`,
        );
      }
      cdOffset += 46 + nameLen + extraLen + commentLen;
    }
  }

  /**
   * TAR / TAR.GZ via the image's real `tar` binary (array args, never a shell).
   * Defence in depth:
   *   (a) list members first (`tar -t`); reject absolute names, `..` segments,
   *       or any name that fails the resolveSafe jail — BEFORE extracting.
   *   (b) extract into a FRESH jailed temp dir (never `--absolute-names`, always
   *       `--no-same-owner`).
   *   (c) walk the extracted tree: reject any symlink whose target escapes the
   *       temp root — so a symlink-escape entry never reaches the real dest.
   *   (d) only then move the validated tree into the destination.
   */
  private async extractTar(
    root: string,
    destVirtual: string,
    destAbs: string,
    archiveAbs: string,
    format: ArchiveFormat | 'tar',
  ): Promise<ExtractResult> {
    const gz = format !== 'tar';
    const listArgs = [gz ? '-tzf' : '-tf', archiveAbs];
    const { stdout } = await execFileAsync('tar', listArgs, {
      timeout: TAR_TIMEOUT_MS,
      maxBuffer: TAR_MAX_BUFFER,
    });
    const members = stdout.split('\n').filter((l) => l.length > 0);

    if (members.length > MAX_ENTRIES()) {
      throw new PayloadTooLargeException(
        `Archive has too many entries (max ${MAX_ENTRIES()})`,
      );
    }

    // (a) name-based jail check, before any extraction.
    for (const member of members) {
      await this.resolveEntry(root, destVirtual, destAbs, member);
    }

    // (b) fresh jailed temp dir under the same root.
    const tmpVirtual = join(
      dirname(destVirtual) || '.',
      `.archive-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    const { abs: tmpAbs } = await this.files.resolveSafe(root, tmpVirtual);
    await fs.mkdir(tmpAbs, { recursive: true });

    try {
      const extractArgs = [
        gz ? '-xzf' : '-xf',
        archiveAbs,
        '-C',
        tmpAbs,
        '--no-same-owner',
      ];
      await execFileAsync('tar', extractArgs, { timeout: TAR_TIMEOUT_MS });

      // (c) walk the extracted tree; reject symlink-escapes + enforce byte cap.
      const totalBytes = await this.verifyExtractedTree(tmpAbs);

      // (d) move validated tree into the real destination.
      const entries = await this.mergeTree(tmpAbs, destAbs);
      return { dest: destVirtual, entries, totalBytes };
    } finally {
      await fs.rm(tmpAbs, { recursive: true, force: true });
    }
  }

  /**
   * Recursively walk `rootAbs` (an already-extracted temp tree). Rejects any
   * symlink whose realpath escapes `rootAbs`, and enforces the total-bytes cap
   * against the real on-disk sizes. Returns the total bytes.
   */
  private async verifyExtractedTree(rootAbs: string): Promise<number> {
    const realRoot = await fs.realpath(rootAbs);
    let total = 0;
    let count = 0;
    const walk = async (absDir: string): Promise<void> => {
      const dirents = await fs.readdir(absDir, { withFileTypes: true });
      for (const d of dirents) {
        const abs = join(absDir, d.name);
        if (++count > MAX_ENTRIES()) {
          throw new PayloadTooLargeException(
            `Archive has too many entries (max ${MAX_ENTRIES()})`,
          );
        }
        if (d.isSymbolicLink()) {
          // A symlink may not resolve anywhere outside the temp root.
          let realTarget: string;
          try {
            realTarget = await fs.realpath(abs);
          } catch {
            // Broken/dangling link — still verify its literal target can't climb
            // out lexically before rejecting outright.
            const target = await fs.readlink(abs);
            throw new BadRequestException(
              `Refusing symlink entry pointing outside the archive: ${target}`,
            );
          }
          if (
            realTarget !== realRoot &&
            !realTarget.startsWith(realRoot + sep)
          ) {
            throw new BadRequestException(
              'Refusing symlink entry that escapes the extraction directory',
            );
          }
          continue;
        }
        if (d.isDirectory()) {
          await walk(abs);
        } else if (d.isFile()) {
          const st = await fs.stat(abs);
          // Hardlink guard: a regular file with >1 link is a hardlink entry
          // sharing an inode with a file outside the temp tree (a symlink it is
          // not, so the check above missed it). GNU tar sanitises these, but the
          // `tar` binary is resolved from PATH — don't depend on its behaviour.
          if (st.nlink > 1) {
            throw new BadRequestException(
              'Refusing hardlink entry in archive (shares an inode outside the extraction directory)',
            );
          }
          total += st.size;
          if (total >= MAX_TOTAL_BYTES()) {
            throw new PayloadTooLargeException(
              `Archive uncompresses past the size cap (max ${MAX_TOTAL_BYTES()} bytes)`,
            );
          }
        }
      }
    };
    await walk(rootAbs);
    return total;
  }

  /** Move the top-level children of `fromAbs` into `toAbs`. Returns file count. */
  private async mergeTree(fromAbs: string, toAbs: string): Promise<number> {
    let files = 0;
    const countFiles = async (abs: string): Promise<void> => {
      const dirents = await fs.readdir(abs, { withFileTypes: true });
      for (const d of dirents) {
        if (d.isDirectory()) await countFiles(join(abs, d.name));
        else files++;
      }
    };
    await countFiles(fromAbs);

    const top = await fs.readdir(fromAbs);
    for (const name of top) {
      const src = join(fromAbs, name);
      const dst = join(toAbs, name);
      await fs.rm(dst, { recursive: true, force: true });
      await fs.rename(src, dst);
    }
    return files;
  }

  // ── compress ─────────────────────────────────────────────────────────────

  async compress(
    root: string,
    paths: string[],
    dest: string,
    format: ArchiveFormat,
  ): Promise<CompressResult> {
    const { rootDir } = await this.files.resolveSafe(root, '');
    const { abs: destAbs } = await this.files.resolveSafe(root, dest);

    // Resolve + existence-check every source through the jail.
    const sources: { abs: string; rel: string }[] = [];
    for (const p of paths) {
      const { abs } = await this.files.resolveSafe(root, p);
      if (!(await this.exists(abs))) {
        throw new NotFoundException(`Not found: ${p}`);
      }
      sources.push({ abs, rel: relative(rootDir, abs) });
    }

    await fs.mkdir(dirname(destAbs), { recursive: true });

    if (format === 'zip') {
      return this.compressZip(sources, destAbs);
    }
    return this.compressTarGz(rootDir, sources, destAbs);
  }

  private async compressZip(
    sources: { abs: string; rel: string }[],
    destAbs: string,
  ): Promise<CompressResult> {
    const tree: AsyncZippable = {};
    let bytes = 0;
    let entries = 0;

    const addFile = async (abs: string, name: string): Promise<void> => {
      const st = await fs.stat(abs);
      bytes += st.size;
      entries++;
      if (entries > MAX_ENTRIES()) {
        throw new PayloadTooLargeException(
          `Too many files to compress (max ${MAX_ENTRIES()})`,
        );
      }
      if (bytes > MAX_TOTAL_BYTES()) {
        throw new PayloadTooLargeException(
          `Selection is too large to compress (max ${MAX_TOTAL_BYTES()} bytes)`,
        );
      }
      const buf = await fs.readFile(abs);
      tree[name] = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    };

    const addDir = async (abs: string, prefix: string): Promise<void> => {
      const dirents = await fs.readdir(abs, { withFileTypes: true });
      for (const d of dirents) {
        // Skip symlinks: never chase a link out of the jail while packing.
        if (d.isSymbolicLink()) continue;
        const childAbs = join(abs, d.name);
        const childName = posix.join(prefix, d.name);
        if (d.isDirectory()) await addDir(childAbs, childName);
        else if (d.isFile()) await addFile(childAbs, childName);
      }
    };

    for (const s of sources) {
      const st = await fs.lstat(s.abs);
      if (st.isSymbolicLink()) continue;
      const name = basename(s.rel);
      if (st.isDirectory()) await addDir(s.abs, name);
      else await addFile(s.abs, name);
    }

    // Async `zip` (not `zipSync`): deflating a large selection runs chunked off
    // the main thread instead of blocking all HTTP + PTY for seconds.
    const zipped = await new Promise<Uint8Array>((resolve, reject) => {
      zip(tree, (err, out) => {
        if (err) reject(err instanceof Error ? err : new Error(err));
        else resolve(out);
      });
    });
    await fs.writeFile(destAbs, zipped);
    return { dest: relative(dirname(destAbs), destAbs), entries, bytes };
  }

  private async compressTarGz(
    rootDir: string,
    sources: { abs: string; rel: string }[],
    destAbs: string,
  ): Promise<CompressResult> {
    // Relative member names, packed with cwd = the jail root. No shell.
    const rels = sources.map((s) => s.rel);
    await execFileAsync(
      'tar',
      ['-czf', destAbs, '-C', rootDir, '--no-same-owner', ...rels],
      { timeout: TAR_TIMEOUT_MS },
    );
    // Count members for the response (list back the built archive).
    const { stdout } = await execFileAsync('tar', ['-tzf', destAbs], {
      timeout: TAR_TIMEOUT_MS,
      maxBuffer: TAR_MAX_BUFFER,
    });
    const members = stdout.split('\n').filter((l) => l && !l.endsWith('/'));
    const st = await fs.stat(destAbs);
    return { dest: basename(destAbs), entries: members.length, bytes: st.size };
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /**
   * THE per-entry jail check. Rejects absolute names and any lexical `..`
   * segment up front (belt-and-suspenders), then joins the (normalised) entry
   * name to the destination and runs it through `resolveSafe`, which enforces
   * the lexical + realpath containment jail. Returns the safe absolute path.
   */
  private async resolveEntry(
    root: string,
    destVirtual: string,
    _destAbs: string,
    entryName: string,
  ): Promise<string> {
    const name = entryName.replace(/\/+$/, ''); // tolerate dir trailing slash
    if (name.length === 0) {
      // Root entry ('./' or '/') — maps to the dest itself.
      const { abs } = await this.files.resolveSafe(root, destVirtual);
      return abs;
    }
    if (name.includes('\0')) {
      throw new BadRequestException('Invalid entry name (NUL byte)');
    }
    // Reject absolute + drive-letter + UNC style names outright.
    if (/^([/\\]|[a-zA-Z]:)/.test(name)) {
      throw new BadRequestException(`Refusing absolute archive entry: ${name}`);
    }
    // Reject any `..` path segment (forward or back slash).
    const segs = name.split(/[/\\]+/);
    if (segs.some((s) => s === '..')) {
      throw new BadRequestException(
        `Refusing archive entry that escapes the destination: ${name}`,
      );
    }
    const virtual = posix.join(destVirtual, ...segs);
    const { abs } = await this.files.resolveSafe(root, virtual);
    return abs;
  }

  private detectFormat(path: string): ArchiveFormat | 'tar' {
    const lower = path.toLowerCase();
    if (lower.endsWith('.zip')) return 'zip';
    if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'targz';
    if (lower.endsWith('.tar')) return 'tar';
    throw new BadRequestException(
      'Unsupported archive format (expected .zip, .tar, .tar.gz or .tgz)',
    );
  }

  private deriveDest(path: string): string {
    const dir = dirname(path);
    const base = basename(path).replace(/\.(zip|tgz|tar\.gz|tar)$/i, '');
    return dir === '.' ? base : posix.join(dir, base);
  }

  private async statFile(abs: string): Promise<Stats> {
    let stat: Stats;
    try {
      stat = await fs.stat(abs);
    } catch {
      throw new NotFoundException('Archive not found');
    }
    if (stat.isDirectory()) {
      throw new BadRequestException('Path is a directory, not an archive');
    }
    return stat;
  }

  private async exists(abs: string): Promise<boolean> {
    try {
      await fs.stat(abs);
      return true;
    } catch {
      return false;
    }
  }
}
