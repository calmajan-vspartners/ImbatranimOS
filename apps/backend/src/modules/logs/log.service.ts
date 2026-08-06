import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createReadStream, promises as fs } from 'fs';
import * as os from 'os';
import { join, resolve } from 'path';
import { serialiseEntry, redact } from './redact';

/** Where the log lives, relative to the home volume. */
const LOG_DIR = join('.imbatranim', 'logs');
const LOG_NAME = 'system.log';
/** One rotated generation. Two files total; the cap is per file. */
const ROTATED_NAME = 'system.log.1';

/**
 * Per-file cap. Two files, so the log can never cost more than ~4 MB of a volume
 * that brief 83 exists because it fills up. Read per call, not at import, so an
 * env change takes effect without a module reload — the same pattern the archive
 * module's caps use.
 */
const MAX_FILE_BYTES = () =>
  Number(process.env.LOG_MAX_FILE_BYTES) || 2 * 1024 * 1024;

/** Ceiling on a single read, so the tail endpoint cannot be asked for the world. */
const MAX_READ_LIMIT = 2000;
const DEFAULT_READ_LIMIT = 200;

/**
 * How many client-reported entries this process will accept before it stops.
 *
 * The browser can write here (brief 47's crash boundary), and a render loop is
 * exactly the thing that would fill the disk with identical lines. The frontend
 * already dedupes its toasts; this is the backstop that does not trust it.
 */
const CLIENT_ENTRY_BUDGET = () => Number(process.env.LOG_CLIENT_BUDGET) || 500;

export type LogLevel = 'info' | 'warn' | 'error';
export type LogSource = 'server' | 'client';

export interface LogEntry {
  /** ISO timestamp. */
  t: string;
  level: LogLevel;
  /** Stable dotted event name, e.g. `auth.login.failed`. */
  event: string;
  /**
   * Who observed it. A `client` line was **reported by the browser** and is
   * therefore only as trustworthy as the session that sent it; keeping the two
   * apart means a client-supplied string can never be read as something the
   * server saw for itself.
   */
  source: LogSource;
  msg: string;
  meta?: unknown;
}

export interface LogQuery {
  level?: LogLevel;
  q?: string;
  limit?: number;
}

/**
 * The machine's memory of itself (brief 84).
 *
 * `/var/log` is empty and nothing runs there: `entrypoint.sh` execs node as PID
 * 1, so Nest's logger goes to stdout and only `docker logs` ever sees it. From
 * inside the OS — and on the kiosk ISO, where there is no host shell at all —
 * "was anyone trying to log in as me last week?" was unanswerable.
 *
 * **This is an audit log with deliberate call sites, not a mirror of stdout.**
 * The brief proposed a Nest logger transport; that is the wrong shape and the
 * brief says why two paragraphs earlier — "an audit trail assembled from
 * incidental log lines is not a trail". A transport would pour every
 * `RouterExplorer` mapping line into the file and push the events that matter
 * out of the rotation window faster, while also putting the stdout path the
 * brief asks to preserve at risk. Nest's logging is untouched; this writes
 * beside it, and the things worth auditing call {@link record} on purpose.
 *
 * No daemon, no supervisor, no second process — the kill-list stays intact.
 */
@Injectable()
export class LogService implements OnModuleInit {
  private readonly logger = new Logger(LogService.name);

  /** Serialises appends so two concurrent requests cannot interleave a line. */
  private queue: Promise<void> = Promise.resolve();
  /** Tracked in memory so the common path never stats the file. */
  private currentBytes = 0;
  private ready = false;
  private clientEntries = 0;
  /** Reported once, not once per failed write. */
  private warnedAboutWriteFailure = false;

  async onModuleInit(): Promise<void> {
    try {
      await fs.mkdir(this.dir(), { recursive: true });
      this.currentBytes = await this.sizeOf(this.path());
      this.ready = true;
    } catch (err) {
      // A log that cannot be created must not stop the OS from booting.
      this.logger.warn(`System log unavailable: ${String(err)}`);
    }
  }

  private dir(): string {
    return join(resolve(process.env.FILES_ROOT || os.homedir()), LOG_DIR);
  }
  private path(): string {
    return join(this.dir(), LOG_NAME);
  }
  private rotatedPath(): string {
    return join(this.dir(), ROTATED_NAME);
  }

  private async sizeOf(p: string): Promise<number> {
    try {
      return (await fs.stat(p)).size;
    } catch {
      return 0;
    }
  }

  /**
   * Record an event.
   *
   * **Fire and forget on purpose.** Nothing awaits this, so a full disk or a
   * read-only volume cannot fail the request that triggered it — the failure is
   * reported once to stdout and then swallowed. A login should not stop working
   * because the audit log cannot be written; that would turn a disk problem into
   * a lockout.
   */
  record(
    level: LogLevel,
    event: string,
    msg: string,
    meta?: unknown,
    source: LogSource = 'server',
  ): void {
    const entry: LogEntry = {
      t: new Date().toISOString(),
      level,
      event,
      source,
      msg,
      // Redaction happens HERE rather than at the call sites: a rule applied in
      // one place is a rule, and a rule each caller has to remember is a leak
      // waiting for the one caller who forgets.
      ...(meta === undefined ? {} : { meta: redact(meta) }),
    };
    const line = serialiseEntry(entry as unknown as Record<string, unknown>);
    this.queue = this.queue
      .then(() => this.append(line))
      .catch(() => undefined);
  }

  /** `info` for something that happened, `warn` for something suspicious. */
  audit(event: string, msg: string, meta?: unknown): void {
    this.record('info', event, msg, meta);
  }

  /**
   * A crash the **browser** reported. Bounded and tagged, because this is the one
   * path a client can write to the disk.
   */
  recordFromClient(event: string, msg: string, meta?: unknown): boolean {
    if (this.clientEntries >= CLIENT_ENTRY_BUDGET()) return false;
    this.clientEntries++;
    this.record('error', event, msg, meta, 'client');
    return true;
  }

  private async append(line: string): Promise<void> {
    if (!this.ready) return;
    try {
      const bytes = Buffer.byteLength(line);
      if (this.currentBytes + bytes > MAX_FILE_BYTES()) await this.rotate();
      await fs.appendFile(this.path(), line, 'utf8');
      this.currentBytes += bytes;
    } catch (err) {
      if (!this.warnedAboutWriteFailure) {
        this.warnedAboutWriteFailure = true;
        this.logger.warn(
          `System log write failed (further failures silent): ${String(err)}`,
        );
      }
    }
  }

  /**
   * Move the current file aside and start fresh.
   *
   * A rename, not a copy: it is atomic on the same filesystem and costs nothing
   * regardless of file size. The previous generation is discarded — two files is
   * the cap, and a log that grows without bound is the failure mode brief 83 was
   * written about.
   */
  private async rotate(): Promise<void> {
    try {
      await fs.rename(this.path(), this.rotatedPath());
    } catch {
      // Nothing to rotate (first write) — fine.
    }
    this.currentBytes = 0;
  }

  /**
   * The tail, newest first.
   *
   * Reads **backwards in bounded chunks** rather than loading the file: the point
   * of a size cap is undone if reading it needs the whole thing in the heap.
   * Filtering happens as lines are parsed, and the walk stops the moment `limit`
   * matches are in hand — so a narrow filter over a full log is a short read, not
   * a full one.
   */
  async tail(
    query: LogQuery = {},
  ): Promise<{ entries: LogEntry[]; truncated: boolean }> {
    const limit = Math.min(
      Math.max(query.limit ?? DEFAULT_READ_LIMIT, 1),
      MAX_READ_LIMIT,
    );
    const needle = query.q?.trim().toLowerCase() ?? '';
    const entries: LogEntry[] = [];

    for (const file of [this.path(), this.rotatedPath()]) {
      if (entries.length >= limit) break;
      const lines = await this.readLinesBackwards(
        file,
        limit - entries.length,
        (line) => this.matches(line, query.level, needle),
      );
      entries.push(...lines);
    }
    return { entries, truncated: entries.length >= limit };
  }

  /** Cheap pre-filter on the raw text, before paying for a JSON parse. */
  private matches(
    line: string,
    level: LogLevel | undefined,
    needle: string,
  ): boolean {
    if (level && !line.includes(`"level":"${level}"`)) return false;
    if (needle && !line.toLowerCase().includes(needle)) return false;
    return true;
  }

  /**
   * Read `file` from the end, returning up to `want` parsed entries that pass
   * `keep`, newest first.
   */
  private async readLinesBackwards(
    file: string,
    want: number,
    keep: (line: string) => boolean,
  ): Promise<LogEntry[]> {
    const size = await this.sizeOf(file);
    if (size === 0) return [];

    const CHUNK = 64 * 1024;
    const out: LogEntry[] = [];
    let end = size;
    /** Bytes of a line split across the chunk boundary, carried into the next read. */
    let carry = '';

    while (end > 0 && out.length < want) {
      const start = Math.max(0, end - CHUNK);
      const chunk = await this.readRange(file, start, end - 1);
      const text = chunk + carry;
      const parts = text.split('\n');
      // The first part is only a whole line when this chunk started at byte 0.
      carry = start === 0 ? '' : (parts.shift() ?? '');
      for (let i = parts.length - 1; i >= 0 && out.length < want; i--) {
        const line = parts[i];
        if (line.length === 0 || !keep(line)) continue;
        const parsed = this.parse(line);
        if (parsed) out.push(parsed);
      }
      end = start;
    }
    if (carry.length > 0 && out.length < want && keep(carry)) {
      const parsed = this.parse(carry);
      if (parsed) out.push(parsed);
    }
    return out;
  }

  private readRange(file: string, start: number, end: number): Promise<string> {
    return new Promise((res, rej) => {
      const chunks: Buffer[] = [];
      createReadStream(file, { start, end })
        .on('data', (c: string | Buffer) => chunks.push(Buffer.from(c)))
        .on('end', () => res(Buffer.concat(chunks).toString('utf8')))
        .on('error', rej);
    });
  }

  private parse(line: string): LogEntry | null {
    try {
      const value = JSON.parse(line) as LogEntry;
      return typeof value?.event === 'string' ? value : null;
    } catch {
      // A torn line from a crash mid-append. Skipping it is right: one damaged
      // record must not make the rest of the log unreadable.
      return null;
    }
  }

  /** Flush pending appends. Tests need this; nothing in a request path does. */
  async flush(): Promise<void> {
    await this.queue;
  }
}
