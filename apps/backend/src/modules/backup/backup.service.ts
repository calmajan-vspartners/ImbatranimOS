import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { execFile, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join, relative, sep } from 'path';
import type { Readable } from 'stream';
import { promisify } from 'util';
import { DbService } from '../../db/db.service';
import { FilesService } from '../files/files.service';
import { TRASH_DIR } from '../files/trash.service';
import { ArchiveService, parseTarListLine } from '../archive/archive.service';
import { SessionService } from '../auth/session.service';
import type {
  BackupInfo,
  BackupManifest,
  RestoreEntry,
  RestorePreview,
} from './dto/backup.dto';

const execFileAsync = promisify(execFile);

/** Wall-clock cap for a tar invocation that is not the streaming backup. */
const TAR_TIMEOUT_MS = Number(process.env.BACKUP_TAR_TIMEOUT_MS) || 120_000;
/** Cap on a captured member listing. */
const TAR_MAX_BUFFER =
  Number(process.env.BACKUP_TAR_MAX_BUFFER) || 32 * 1024 * 1024;
/** How many members a restorable backup may declare. */
const MAX_MEMBERS = Number(process.env.BACKUP_MAX_MEMBERS) || 200_000;
/** How long an inspected upload stays applicable, and how many are kept. */
const UPLOAD_TTL_MS = 30 * 60 * 1000;
const MAX_PENDING_UPLOADS = 3;
/**
 * Disk left over after a restore. Filling the volume to the last byte leaves the
 * user with an OS that cannot write its own database, so the check refuses a
 * restore that would land inside this margin rather than technically fitting.
 */
const FREE_SPACE_MARGIN_BYTES =
  Number(process.env.BACKUP_FREE_MARGIN_BYTES) || 64 * 1024 * 1024;

/** Where the manifest and the database snapshot ride inside the archive. */
const STAGING_REL = join('.imbatranim', 'backup-staging');
const MANIFEST_MEMBER = `${STAGING_REL}/manifest.json`;
const DB_SNAPSHOT_MEMBER = `${STAGING_REL}/db.sqlite`;

/** Prefixes for restore scratch directories, kept at the home root. */
const RESTORE_STAGING_PREFIX = '.imbatranim-restore-';
const RESTORE_ROLLBACK_PREFIX = '.imbatranim-rollback-';

/**
 * Strip the leading `./` tar puts on member names.
 *
 * Both tars that matter here store `./notes/a.txt` rather than `notes/a.txt` —
 * busybox's `strip_unsafe_prefix` removes a leading `/` and any `../`, but
 * deliberately not `./` — so this is normalisation for robustness against a
 * hand-rolled tarball, not a workaround for a divergence.
 */
export function normaliseMember(name: string): string {
  let out = name.replace(/^\.\//, '');
  while (out.startsWith('./')) out = out.slice(2);
  return out;
}

/** The first path segment of a member name, or '' for the archive root itself. */
export function topLevelOf(member: string): string {
  const normalised = normaliseMember(member).replace(/\/+$/, '');
  if (normalised === '' || normalised === '.') return '';
  return normalised.split('/')[0];
}

/**
 * Decide whether a parsed manifest is an ImbatranimOS backup we can apply.
 *
 * Pure and exported so the refusal is testable without a filesystem. Restoring
 * an unrelated tarball over `$HOME` would be a spectacular footgun, so the check
 * is positive identification — a marker we wrote — rather than "it looks
 * plausible".
 */
export function validateManifest(value: unknown): BackupManifest {
  if (typeof value !== 'object' || value === null) {
    throw new BadRequestException('That backup has an unreadable manifest');
  }
  const m = value as Record<string, unknown>;
  if (m.product !== 'ImbatranimOS') {
    throw new BadRequestException(
      'That file is not an ImbatranimOS backup — its manifest names a different product',
    );
  }
  if (m.manifestVersion !== 1) {
    throw new BadRequestException(
      `That backup was written by a newer version of ImbatranimOS (manifest v${String(
        m.manifestVersion,
      )}) and cannot be restored by this one`,
    );
  }
  const createdAt = typeof m.createdAt === 'string' ? m.createdAt : '';
  if (createdAt === '' || Number.isNaN(Date.parse(createdAt))) {
    throw new BadRequestException('That backup has no usable creation date');
  }
  return {
    product: 'ImbatranimOS',
    manifestVersion: 1,
    createdAt,
    imageVersion:
      typeof m.imageVersion === 'string' ? m.imageVersion : 'unknown',
    home: typeof m.home === 'string' ? m.home : '',
    database:
      typeof m.database === 'string' && m.database !== ''
        ? m.database
        : DB_SNAPSHOT_MEMBER,
    excluded: Array.isArray(m.excluded)
      ? m.excluded.filter((e): e is string => typeof e === 'string')
      : [],
  };
}

interface PendingUpload {
  tarballPath: string;
  manifest: BackupManifest;
  members: { name: string; size: number; directory: boolean }[];
  totalBytes: number;
  at: number;
}

/**
 * Back up and restore the home volume from inside the OS (brief 80).
 *
 * The only backup path the product used to offer was a host `docker run` in the
 * README — impossible for anyone on the kiosk ISO, who has no host shell, and for
 * anyone handed a running instance without docker access. This makes it a
 * feature of the OS instead.
 *
 * **Nothing about the download touches disk.** The tarball is streamed straight
 * out of `tar` to the HTTP response: writing it into the tree being archived is
 * both a recursion trap and a disk-space trap on a volume that may already be
 * near full.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  /** One backup at a time: they share a fixed staging path inside the home. */
  private backupInFlight = false;
  private readonly pending = new Map<string, PendingUpload>();

  constructor(
    private readonly files: FilesService,
    private readonly archive: ArchiveService,
    private readonly db: DbService,
    private readonly sessions: SessionService,
  ) {}

  // ── shared ───────────────────────────────────────────────────────────────

  private async homeRoot(): Promise<string> {
    const { rootDir } = await this.files.resolveSafe('home', '');
    return rootDir;
  }

  /**
   * The `--exclude` patterns for a backup, every one anchored with `./`.
   *
   * The anchoring is load-bearing and was verified rather than assumed. Both
   * tars match an exclude pattern against the member name at any `/` boundary,
   * so a bare `.imbatranim/db.sqlite` would also drop a user's own
   * `Documents/.imbatranim/db.sqlite` — silently. Because member names keep
   * their `./` prefix, only the archive root starts with `./`, so a `./`-prefixed
   * pattern can match nothing but the intended path. Measured on GNU tar 1.35 and
   * read out of busybox's `archival/tar.c` (`exclude_file`) plus
   * `libbb`'s `strip_unsafe_prefix` for the Alpine side.
   */
  private async excludePatterns(): Promise<string[]> {
    const home = await this.homeRoot();
    const patterns = [
      // The Trash is not worth carrying, and brief 79 made it a real directory
      // rather than a metaphor.
      `./${TRASH_DIR.split(sep).join('/')}`,
      // Scratch directories belonging to an in-flight restore or extraction.
      `./${RESTORE_STAGING_PREFIX}*`,
      `./${RESTORE_ROLLBACK_PREFIX}*`,
      './.archive-tmp-*',
    ];
    // The live database, if it lives inside the home volume — the snapshot
    // replaces it. If DB_PATH points outside the home it is not in the archive
    // at all and there is nothing to exclude.
    const dbRel = relative(home, this.db.path());
    if (dbRel !== '' && !dbRel.startsWith('..') && !dbRel.startsWith(sep)) {
      const posixRel = dbRel.split(sep).join('/');
      patterns.push(
        `./${posixRel}`,
        `./${posixRel}-wal`,
        `./${posixRel}-shm`,
        `./${posixRel}-journal`,
      );
    }
    return patterns;
  }

  private async freeBytes(): Promise<number> {
    const stats = await fs.statfs(await this.homeRoot());
    // bavail, not bfree: what an unprivileged process can actually use.
    return stats.bavail * stats.bsize;
  }

  // ── backup ───────────────────────────────────────────────────────────────

  /** What the UI shows before the user commits to a download. */
  async info(): Promise<BackupInfo> {
    const [size, free, excluded] = await Promise.all([
      this.files.dirSize('home', ''),
      this.freeBytes(),
      this.excludePatterns(),
    ]);
    let databaseBytes = 0;
    try {
      databaseBytes = (await fs.stat(this.db.path())).size;
    } catch {
      databaseBytes = 0;
    }
    return {
      homeBytes: size.bytes,
      homeBytesTruncated: size.truncated,
      databaseBytes,
      freeBytes: free,
      excluded,
      suggestedFilename: this.filename(),
    };
  }

  private filename(): string {
    const stamp = new Date().toISOString().slice(0, 10);
    return `imbatranim-home-${stamp}.tar.gz`;
  }

  /**
   * Start a backup and hand back its bytes as a stream.
   *
   * The caller pipes `stream` at the response and awaits `done`. If `done`
   * rejects **after** bytes have gone out there is no way to change the status
   * code, so the caller destroys the socket: the client then sees a truncated
   * gzip stream, which fails its own CRC. A half-written backup can therefore
   * never masquerade as a complete one.
   */
  async openBackupStream(): Promise<{
    filename: string;
    stream: Readable;
    done: Promise<void>;
    dispose: () => Promise<void>;
  }> {
    if (this.backupInFlight) {
      throw new ConflictException('A backup is already running');
    }
    this.backupInFlight = true;

    const home = await this.homeRoot();
    const stagingAbs = join(home, STAGING_REL);
    let disposed = false;

    const dispose = async (): Promise<void> => {
      if (disposed) return;
      disposed = true;
      this.backupInFlight = false;
      await fs.rm(stagingAbs, { recursive: true, force: true });
    };

    try {
      // The snapshot and the manifest have to live inside the directory tar is
      // told to change into, because only ONE `-C` is honoured: busybox parses
      // `-C` as a single-valued option and calls `xchdir` once, after option
      // parsing (archival/tar.c). GNU tar's "several -C interleaved with paths"
      // idiom would silently produce a different archive on Alpine.
      await fs.rm(stagingAbs, { recursive: true, force: true });
      await fs.mkdir(stagingAbs, { recursive: true });
      this.db.snapshotTo(join(stagingAbs, 'db.sqlite'));

      const excluded = await this.excludePatterns();
      const manifest: BackupManifest = {
        product: 'ImbatranimOS',
        manifestVersion: 1,
        createdAt: new Date().toISOString(),
        imageVersion: process.env.IMAGE_VERSION ?? 'unknown',
        home,
        database: DB_SNAPSHOT_MEMBER,
        excluded,
      };
      await fs.writeFile(
        join(stagingAbs, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf8',
      );

      const args = [
        '-czf',
        '-',
        '-C',
        home,
        ...excluded.map((p) => `--exclude=${p}`),
        '.',
      ];
      const child = spawn('tar', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (!child.stdout || !child.stderr) {
        child.kill('SIGKILL');
        throw new InternalServerErrorException('Could not start the backup');
      }
      const stdout = child.stdout;
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        // Bounded: a pathological tar could otherwise stream errors forever.
        if (stderr.length < 8192) stderr += chunk;
      });

      const done = new Promise<void>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => {
          if (code === 0) resolve();
          else
            reject(
              new InternalServerErrorException(
                `Backup failed (tar exited ${String(code)}): ${stderr.trim().slice(0, 300)}`,
              ),
            );
        });
      });

      return {
        filename: this.filename(),
        stream: stdout,
        done,
        dispose: async () => {
          if (child.exitCode === null) child.kill('SIGKILL');
          await dispose();
        },
      };
    } catch (err) {
      await dispose();
      throw err;
    }
  }

  // ── restore ──────────────────────────────────────────────────────────────

  /**
   * Read an uploaded archive and report what restoring it would do, applying
   * nothing.
   *
   * Refusal happens here, before a single byte is extracted: an archive without
   * our manifest is not a backup, and this is the last point at which the user
   * can be told so cheaply.
   */
  async inspect(tarballPath: string): Promise<RestorePreview> {
    this.sweepUploads();
    try {
      const listing = await this.listTarball(tarballPath);
      const manifest = await this.readManifest(tarballPath, listing.members);

      const home = await this.homeRoot();
      const seen = new Map<string, RestoreEntry>();
      for (const member of listing.members) {
        const top = topLevelOf(member.name);
        if (top === '' || seen.has(top)) continue;
        const isDir =
          member.directory || normaliseMember(member.name).includes('/');
        seen.set(top, {
          name: top,
          directory: isDir,
          replacesExisting: await this.exists(join(home, top)),
        });
      }

      const free = await this.freeBytes();
      const id = randomUUID();
      this.pending.set(id, {
        tarballPath,
        manifest,
        members: listing.members,
        totalBytes: listing.totalBytes,
        at: Date.now(),
      });
      this.capUploads();

      return {
        id,
        manifest,
        entries: [...seen.values()].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
        fileCount: listing.members.filter((m) => !m.directory).length,
        totalBytes: listing.totalBytes,
        freeBytes: free,
        fits: listing.totalBytes + FREE_SPACE_MARGIN_BYTES <= free,
      };
    } catch (err) {
      // The upload is ours to clean up the moment it turns out to be unusable.
      await fs.rm(tarballPath, { force: true });
      throw err;
    }
  }

  /**
   * Apply a previously inspected backup.
   *
   * The sequence is stage → verify → swap, and the swap is per top-level entry so
   * that each individual step is an atomic same-filesystem rename with a recorded
   * inverse. A failure part-way therefore rolls back to the tree the user started
   * with, rather than leaving a home directory that is half one backup and half
   * another.
   */
  async apply(id: string): Promise<{
    restored: string[];
    createdAt: string;
    totalBytes: number;
  }> {
    const upload = this.pending.get(id);
    if (!upload) {
      throw new NotFoundException(
        'That upload has expired — choose the backup file again',
      );
    }
    this.pending.delete(id);

    const free = await this.freeBytes();
    if (upload.totalBytes + FREE_SPACE_MARGIN_BYTES > free) {
      await fs.rm(upload.tarballPath, { force: true });
      throw new PayloadTooLargeException(
        `This backup needs ${upload.totalBytes} bytes but only ${free} are free. ` +
          'Free some space and try again.',
      );
    }

    const home = await this.homeRoot();
    const token = randomUUID();
    // Both scratch directories sit at the HOME ROOT, not inside `.imbatranim` —
    // `.imbatranim` is itself a top-level entry the swap moves, and staging
    // inside it would pull the staging area out from under the restore.
    const stagingVirtual = `${RESTORE_STAGING_PREFIX}${token}`;
    const rollbackAbs = join(home, `${RESTORE_ROLLBACK_PREFIX}${token}`);
    let stagingAbs = '';

    try {
      const staged = await this.archive.stageTarExtraction({
        root: 'home',
        destVirtual: '',
        tmpVirtual: stagingVirtual,
        archiveAbs: upload.tarballPath,
        flavour: 'targz',
        // The zip-bomb default (512 MB) is the wrong bound for a home volume;
        // free disk is the honest one. Every other guarantee is unchanged.
        maxTotalBytes: Math.max(free - FREE_SPACE_MARGIN_BYTES, 1),
      });
      stagingAbs = staged.stagingAbs;

      const names = (await fs.readdir(stagingAbs)).filter((n) => n !== '.');
      if (names.length === 0) {
        throw new BadRequestException(
          'That backup contains nothing to restore',
        );
      }

      // Check the snapshot is really there BEFORE anything moves. Discovering it
      // missing after the swap would leave a restored tree with no database at
      // the path the process reopens — an OS that boots into its setup screen
      // with the user's data present but unreachable.
      const snapshotStaged = join(
        stagingAbs,
        normaliseMember(upload.manifest.database),
      );
      if (!(await this.exists(snapshotStaged))) {
        throw new BadRequestException(
          'That backup carries no database snapshot and cannot be restored',
        );
      }

      await fs.mkdir(rollbackAbs, { recursive: true });
      const restored = await this.swapIn(home, stagingAbs, rollbackAbs, names);

      // The database last, and only once the tree it belongs to is in place.
      await this.installDatabase(home, upload.manifest);

      return {
        restored,
        createdAt: upload.manifest.createdAt,
        totalBytes: upload.totalBytes,
      };
    } catch (err) {
      throw this.translateDiskFull(err);
    } finally {
      await fs.rm(upload.tarballPath, { force: true });
      if (stagingAbs !== '') {
        await fs.rm(stagingAbs, { recursive: true, force: true });
      }
      // The pre-restore copy is deleted on the way out. Keeping it would double
      // the volume's usage on exactly the machine least able to afford it, and
      // the user has just typed a confirmation naming what would be replaced.
      await fs.rm(rollbackAbs, { recursive: true, force: true });
    }
  }

  /**
   * Move each staged top-level entry into place, remembering the inverse.
   *
   * Only the names the backup declares are touched. A file the user created
   * *after* the backup and that the backup knows nothing about is left alone —
   * making the home directory exactly match the archive would mean deleting it,
   * which is a bigger blast radius than the word "restore" implies and is not
   * what the confirmation asked about.
   */
  private async swapIn(
    home: string,
    stagingAbs: string,
    rollbackAbs: string,
    names: string[],
  ): Promise<string[]> {
    // The undo list records ONE ENTRY PER COMPLETED RENAME, not one per name.
    // Recording per name would lose the case that matters: a failure between
    // moving the live entry aside and moving the new one in, which leaves that
    // name missing from the home directory entirely.
    const undo: (() => Promise<void>)[] = [];
    const restored: string[] = [];
    try {
      for (const name of names) {
        const live = join(home, name);
        if (await this.exists(live)) {
          const parked = join(rollbackAbs, name);
          await fs.rename(live, parked);
          undo.push(() => fs.rename(parked, live));
        }
        const staged = join(stagingAbs, name);
        await fs.rename(staged, live);
        undo.push(() => fs.rename(live, staged));
        restored.push(name);
      }
      return restored;
    } catch (err) {
      // Undo in reverse. Each step is the exact inverse of a rename that already
      // succeeded, on the same filesystem, so the recovery cannot itself run out
      // of space or cross a device boundary.
      for (const step of [...undo].reverse()) {
        try {
          await step();
        } catch (rollbackErr) {
          this.logger.error(
            `Restore rollback step failed: ${String(rollbackErr)}`,
          );
        }
      }
      throw err;
    }
  }

  /**
   * Install the snapshot the archive carries as the live database.
   *
   * By this point the restored `.imbatranim/` is in place and — because a backup
   * excludes the live database — has no `db.sqlite` of its own, only the
   * snapshot. Every session is then revoked: the restored database carries the
   * *backup's* credentials, so whoever is holding this session is no longer
   * necessarily the owner of the password that now guards the machine.
   */
  private async installDatabase(
    home: string,
    manifest: BackupManifest,
  ): Promise<void> {
    const snapshotAbs = join(home, normaliseMember(manifest.database));
    if (!(await this.exists(snapshotAbs))) {
      throw new InternalServerErrorException(
        'The restored archive carried no database snapshot',
      );
    }
    this.db.replaceWith(snapshotAbs);
    await fs.rm(join(home, STAGING_REL), { recursive: true, force: true });
    this.sessions.destroyAll();
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /**
   * List an uploaded tarball with sizes, so the free-space check is an exact
   * figure rather than a guess about how well gzip did.
   */
  private async listTarball(tarballPath: string): Promise<{
    members: { name: string; size: number; directory: boolean }[];
    totalBytes: number;
  }> {
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync('tar', ['-tzvf', tarballPath], {
        timeout: TAR_TIMEOUT_MS,
        maxBuffer: TAR_MAX_BUFFER,
      }));
    } catch {
      throw new BadRequestException(
        'That file could not be read as a .tar.gz archive',
      );
    }
    const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length > MAX_MEMBERS) {
      throw new PayloadTooLargeException(
        `That archive declares too many entries (max ${MAX_MEMBERS})`,
      );
    }
    let totalBytes = 0;
    const members = lines.map((line) => {
      // parseTarListLine is brief 78's `tar -tv` parser, reused rather than
      // re-derived — the format is identical and it already handles symlinks.
      const entry = parseTarListLine(line);
      const size = entry.size ?? 0;
      if (!entry.directory) totalBytes += size;
      return { name: entry.name, size, directory: entry.directory };
    });
    return { members, totalBytes };
  }

  /** Extract only the manifest, and refuse anything that is not one of ours. */
  private async readManifest(
    tarballPath: string,
    members: { name: string }[],
  ): Promise<BackupManifest> {
    const match = members.find(
      (m) => normaliseMember(m.name) === MANIFEST_MEMBER,
    );
    if (!match) {
      throw new BadRequestException(
        'That file is not an ImbatranimOS backup — it has no backup manifest',
      );
    }
    // Staged outside the home volume: reading a manifest should not write into
    // the tree that is about to be replaced.
    const tmpDir = await fs.mkdtemp(join(tmpdir(), 'imbatranim-manifest-'));
    try {
      // The member name is taken from tar's own listing, never from the client,
      // and goes after `--` so a name beginning with `-` cannot become an option.
      await execFileAsync(
        'tar',
        [
          '-xzf',
          tarballPath,
          '-C',
          tmpDir,
          '--no-same-owner',
          '--',
          match.name,
        ],
        { timeout: TAR_TIMEOUT_MS },
      );
      const raw = await fs.readFile(
        join(tmpDir, normaliseMember(match.name)),
        'utf8',
      );
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new BadRequestException('That backup has an unreadable manifest');
      }
      return validateManifest(parsed);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  private async exists(p: string): Promise<boolean> {
    try {
      await fs.lstat(p);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Turn a full volume into the sentence brief 83 settled on, rather than a 500.
   * Restore is the operation most likely to hit it: it writes a second copy of
   * the home directory before it moves anything.
   */
  private translateDiskFull(err: unknown): Error {
    const code = (err as { code?: string } | null)?.code;
    const message = err instanceof Error ? err.message : '';
    if (code === 'ENOSPC' || code === 'EDQUOT' || /ENOSPC/.test(message)) {
      return new PayloadTooLargeException(
        'The disk filled up while restoring — your home directory was left unchanged. Free some space and try again.',
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  private sweepUploads(): void {
    const cutoff = Date.now() - UPLOAD_TTL_MS;
    for (const [id, upload] of this.pending) {
      if (upload.at < cutoff) {
        this.pending.delete(id);
        void fs.rm(upload.tarballPath, { force: true });
      }
    }
  }

  private capUploads(): void {
    while (this.pending.size > MAX_PENDING_UPLOADS) {
      const oldest = [...this.pending.entries()].sort(
        (a, b) => a[1].at - b[1].at,
      )[0];
      this.pending.delete(oldest[0]);
      void fs.rm(oldest[1].tarballPath, { force: true });
    }
  }
}

/** The members the archive reserves for its own metadata. */
export const BACKUP_METADATA = {
  manifest: MANIFEST_MEMBER,
  database: DB_SNAPSHOT_MEMBER,
} as const;
