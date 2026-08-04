import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as os from 'os';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import {
  bytesPerSecond,
  parseNetDev,
  toSwapStats,
  type NetTotals,
  type SwapStats,
} from './proc-net';

export type CpuStats = {
  percent: number;
  cores: number;
  /**
   * Busy percent per core, same order as `os.cpus()`.
   *
   * `sampleCpus()` already computed per-core samples and then threw the detail
   * away by summing them — this exposes what was already being measured. Empty on
   * the very first poll, which has no baseline to diff against.
   */
  perCore: number[];
};

/** 1 / 5 / 15-minute load average, straight from `os.loadavg()`. */
export type LoadAverage = { one: number; five: number; fifteen: number };

export type NetStats = NetTotals & {
  /** Bytes/sec since the previous poll; 0 on the first one. */
  rxPerSec: number;
  txPerSec: number;
};

export type MemoryStats = {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  percent: number;
};

export type DiskStats = {
  path: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  percent: number;
};

/**
 * Everything the Overview shows.
 *
 * Fields were ADDED here, never renamed — the tray polls the same endpoint and a
 * rename would break it silently (`/api/system/stats` stays backward-compatible,
 * per brief 58's regression surface).
 */
export type SystemStats = {
  cpu: CpuStats;
  memory: MemoryStats;
  disk: DiskStats;
  swap: SwapStats;
  loadAvg: LoadAverage;
  net: NetStats;
  uptimeSeconds: number;
};

export type ProcessInfo = {
  pid: number;
  uid: number;
  name: string;
  /**
   * Busy percent since the previous poll, or **null when there is no baseline yet**.
   *
   * Nullable rather than 0 because the two are different facts and the UI must not
   * conflate them: on the very first poll nothing is known about any process's CPU
   * use, and printing a confident `0.0` for a busy process is a lie that
   * self-corrects 1.5s later — long enough for the user to read it.
   */
  cpuPercent: number | null;
  memPercent: number;
  memBytes: number;
};

export type AboutInfo = {
  hostname: string;
  kernel: string;
  platform: string;
  arch: string;
  uptimeSeconds: number;
  imageVersion: string;
  /**
   * The pid of this backend process.
   *
   * Exposed so System Monitor can warn before you kill the process serving the
   * desktop. The kill is uid-scoped, but the backend runs as that same uid — so
   * "you are allowed to" and "you meant to" are different questions, and only the
   * client can ask the second one. Not a secret: any process listing inside the
   * container shows it, and the caller is already authenticated.
   */
  serverPid: number;
};

type CpuSample = { idle: number; total: number };

/** Per-pid CPU jiffies from the previous poll, for the busy-time delta. */
type ProcSample = { at: number; jiffies: Map<number, number> };

/**
 * The kernel reports per-process CPU time in clock ticks (USER_HZ). It is 100
 * on every Linux/architecture combination Node runs on in practice, and glibc
 * only exposes it via sysconf(3), which we cannot call from Node.
 */
const CLOCK_TICKS_PER_SEC = 100;

/** `rss` in /proc/<pid>/stat is a page count; pages are 4 KiB on x86_64/arm64. */
const PAGE_SIZE_BYTES = 4096;

/**
 * Minimum age of the CPU baseline before it is replaced.
 *
 * The baseline is shared by every caller, so without this a second poll
 * arriving milliseconds after the first (two open System Monitor windows, or
 * the tray stats poll racing the app) would diff over a near-zero window and
 * report 0 % for everything. Below this age we still diff against the existing
 * baseline but leave it in place, so the window stays meaningful.
 */
const MIN_CPU_WINDOW_MS = 400;

/**
 * Parses one /proc/<pid>/stat line.
 *
 * The comm field is the raw executable name: it is arbitrary, may contain
 * spaces, and may contain parentheses (`(sd-pam)`), so the only safe split is
 * on the LAST ')' — tokenising the whole line shifts every later field for
 * any process with a space in its name.
 *
 * Exported for unit tests; the /proc walk itself is environment-dependent but
 * this parser is pure.
 */
export function parseProcStat(
  raw: string,
): { pid: number; comm: string; jiffies: number; rssPages: number } | null {
  const open = raw.indexOf('(');
  const close = raw.lastIndexOf(')');
  if (open < 0 || close < 0 || close < open) return null;

  const pid = Number(raw.slice(0, open).trim());
  const comm = raw.slice(open + 1, close);
  const rest = raw
    .slice(close + 1)
    .trim()
    .split(/\s+/);

  // rest[0] is field 3 (state), so documented field N lives at rest[N - 3]:
  // utime = 14, stime = 15, rss = 24.
  const utime = Number(rest[11]);
  const stime = Number(rest[12]);
  const rssPages = Number(rest[21]);

  if (
    !Number.isFinite(pid) ||
    !Number.isFinite(utime) ||
    !Number.isFinite(stime) ||
    !Number.isFinite(rssPages)
  ) {
    return null;
  }
  return { pid, comm, jiffies: utime + stime, rssPages };
}

const ALLOWED_KILL_SIGNALS: NodeJS.Signals[] = [
  'SIGTERM',
  'SIGKILL',
  'SIGINT',
  'SIGHUP',
];

// Cap the process list returned per poll: the UI only renders a sorted table,
// so returning the whole `ps` output just bloats every payload. Top-N by CPU
// keeps the most relevant rows.
const MAX_PROCESSES = 200;

@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name);

  // Small CPU-delta cache: each stats() call samples os.cpus() once and
  // diffs against the previous call's sample, instead of blocking the
  // request with an internal setTimeout. Cheap and stateless per-request.
  private lastCpuSample: CpuSample[] | null = null;
  private lastCpuPercent = 0;
  private lastPerCore: number[] = [];

  // Previous per-pid CPU jiffies, so getProcesses() can report busy time
  // between polls rather than a since-boot average.
  private lastProcSample: ProcSample | null = null;

  /** Previous cumulative network counters, for the per-second rate. */
  private lastNetSample: { at: number; totals: NetTotals } | null = null;
  private lastNetRate = { rxPerSec: 0, txPerSec: 0 };

  async getStats(): Promise<SystemStats> {
    const [cpu, mem, disk, net] = await Promise.all([
      Promise.resolve(this.getCpuStats()),
      this.getMemoryStats(),
      this.getDiskStats(),
      this.getNetStats(),
    ]);
    return {
      cpu,
      memory: mem.memory,
      swap: mem.swap,
      disk,
      net,
      loadAvg: this.getLoadAverage(),
      uptimeSeconds: os.uptime(),
    };
  }

  private getLoadAverage(): LoadAverage {
    const [one, five, fifteen] = os.loadavg();
    // Rounded to two decimals to match what `uptime` prints; the raw floats carry
    // more precision than the number means.
    const round = (n: number) =>
      Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
    return { one: round(one), five: round(five), fifteen: round(fifteen) };
  }

  /**
   * Cumulative network counters plus a per-second rate.
   *
   * The baseline-age guard mirrors the CPU delta's: the sample is shared by every
   * caller, so a second poll arriving milliseconds after the first (two System
   * Monitor windows, or the tray racing the app) would divide a tiny byte delta by a
   * near-zero window and report an absurd rate. Below the threshold the last
   * computed rate is reused and the baseline is left in place.
   */
  private async getNetStats(): Promise<NetStats> {
    let totals: NetTotals = { rxBytes: 0, txBytes: 0 };
    try {
      totals = parseNetDev(await fsp.readFile('/proc/net/dev', 'utf8'));
    } catch (err) {
      // No /proc/net/dev (non-Linux dev machine): report zeros rather than failing
      // the whole stats call, which would blank the entire Overview.
      this.logger.warn(`/proc/net/dev unavailable: ${(err as Error).message}`);
      return { ...totals, ...this.lastNetRate };
    }

    const now = Date.now();
    const previous = this.lastNetSample;
    if (previous) {
      const elapsed = now - previous.at;
      if (elapsed >= MIN_CPU_WINDOW_MS) {
        this.lastNetRate = {
          rxPerSec: bytesPerSecond(
            previous.totals.rxBytes,
            totals.rxBytes,
            elapsed,
          ),
          txPerSec: bytesPerSecond(
            previous.totals.txBytes,
            totals.txBytes,
            elapsed,
          ),
        };
        this.lastNetSample = { at: now, totals };
      }
    } else {
      this.lastNetSample = { at: now, totals };
    }

    return { ...totals, ...this.lastNetRate };
  }

  private getCpuStats(): CpuStats {
    const samples = this.sampleCpus();
    let percent = this.lastCpuPercent;
    let perCore = this.lastPerCore;

    if (this.lastCpuSample && this.lastCpuSample.length === samples.length) {
      let totalIdle = 0;
      let totalTick = 0;
      const next: number[] = [];
      for (let i = 0; i < samples.length; i++) {
        const idleDelta = samples[i].idle - this.lastCpuSample[i].idle;
        const tickDelta = samples[i].total - this.lastCpuSample[i].total;
        totalIdle += idleDelta;
        totalTick += tickDelta;
        // Per-core comes free from the sample that was already being taken; the
        // old code summed it and discarded the detail.
        next.push(
          tickDelta <= 0
            ? 0
            : Math.round(((tickDelta - idleDelta) / tickDelta) * 1000) / 10,
        );
      }
      percent =
        totalTick <= 0
          ? this.lastCpuPercent
          : Math.round(((totalTick - totalIdle) / totalTick) * 1000) / 10;
      perCore = next;
    }

    this.lastCpuSample = samples;
    this.lastCpuPercent = percent;
    this.lastPerCore = perCore;
    return { percent, cores: samples.length, perCore };
  }

  private sampleCpus(): CpuSample[] {
    return os.cpus().map((cpu) => {
      const t = cpu.times;
      return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq };
    });
  }

  /**
   * Memory AND swap from one read.
   *
   * Both come out of `/proc/meminfo`, so reading it twice would be two syscalls and
   * two chances for the halves to disagree about the same instant.
   */
  private async getMemoryStats(): Promise<{
    memory: MemoryStats;
    swap: SwapStats;
  }> {
    try {
      const raw = await fsp.readFile('/proc/meminfo', 'utf8');
      const kv: Record<string, number> = {};
      for (const line of raw.split('\n')) {
        const m = line.match(/^(\w+):\s+(\d+)\s*kB/);
        if (m) kv[m[1]] = Number(m[2]) * 1024;
      }
      const totalBytes = kv.MemTotal ?? os.totalmem();
      // MemAvailable accounts for reclaimable cache/buffers, unlike freemem().
      const availableBytes = kv.MemAvailable ?? os.freemem();
      return {
        memory: this.toMemoryStats(totalBytes, availableBytes),
        // Absent on a container with no swap — `toSwapStats` reports zeros rather
        // than dividing by a zero total.
        swap: toSwapStats(kv.SwapTotal ?? 0, kv.SwapFree ?? 0),
      };
    } catch (err) {
      this.logger.warn(
        `/proc/meminfo unavailable, falling back to os module: ${(err as Error).message}`,
      );
      return {
        memory: this.toMemoryStats(os.totalmem(), os.freemem()),
        swap: toSwapStats(0, 0),
      };
    }
  }

  private toMemoryStats(
    totalBytes: number,
    availableBytes: number,
  ): MemoryStats {
    const usedBytes = Math.max(totalBytes - availableBytes, 0);
    const percent =
      totalBytes === 0 ? 0 : Math.round((usedBytes / totalBytes) * 1000) / 10;
    return { totalBytes, usedBytes, availableBytes, percent };
  }

  private async getDiskStats(): Promise<DiskStats> {
    const target = os.homedir();
    try {
      const stats = await fsp.statfs(target);
      const totalBytes = stats.blocks * stats.bsize;
      // bavail (not bfree) is what's actually usable by an unprivileged
      // user, matching what `df` reports for a non-root caller.
      const freeBytes = stats.bavail * stats.bsize;
      const usedBytes = Math.max(totalBytes - freeBytes, 0);
      const percent =
        totalBytes === 0 ? 0 : Math.round((usedBytes / totalBytes) * 1000) / 10;
      return { path: target, totalBytes, usedBytes, freeBytes, percent };
    } catch (err) {
      this.logger.warn(
        `statfs failed for ${target}: ${(err as Error).message}`,
      );
      return {
        path: target,
        totalBytes: 0,
        usedBytes: 0,
        freeBytes: 0,
        percent: 0,
      };
    }
  }

  /**
   * Reads the process table straight from /proc.
   *
   * This used to shell out to `ps -eo pid,ruid,pcpu,pmem,rss,comm
   * --no-headers`, which is procps syntax. The shipped image is Alpine, whose
   * `ps` is busybox: it takes short options only (no `--no-headers`), has no
   * `ruid` or `pmem` column, and has `pcpu` compiled out entirely. So the call
   * always threw in production, the catch below swallowed it, and System
   * Monitor showed an empty table while looking merely idle. It worked in
   * development only because a glibc host has GNU procps.
   *
   * Reading /proc has no such split: it is the same interface `ps` itself
   * reads, it needs no binary in the image, and it is what the rest of this
   * service already does (see getProcessUid).
   */
  async getProcesses(): Promise<ProcessInfo[]> {
    try {
      const entries = await fsp.readdir('/proc');
      const pids = entries
        .filter((e) => /^\d+$/.test(e))
        .map(Number)
        .filter((pid) => Number.isSafeInteger(pid));

      const now = Date.now();
      const previous = this.lastProcSample;
      const elapsedSec = previous ? (now - previous.at) / 1000 : 0;
      const totalMem = os.totalmem();
      const jiffiesNow = new Map<number, number>();

      const rows = await Promise.all(
        pids.map(async (pid): Promise<ProcessInfo | null> => {
          let raw: string;
          let uid: number;
          try {
            // A process can exit between readdir and these reads; that is
            // normal, not an error — skip it.
            [raw, uid] = await Promise.all([
              fsp.readFile(`/proc/${pid}/stat`, 'utf8'),
              fsp.stat(`/proc/${pid}`).then((s) => s.uid),
            ]);
          } catch {
            return null;
          }

          const stat = parseProcStat(raw);
          if (!stat) return null;
          jiffiesNow.set(pid, stat.jiffies);

          // Busy time since the previous poll. With no baseline — the first poll,
          // or a process that appeared since the last one — this is genuinely
          // UNKNOWN, so it is null and the UI renders an em dash.
          const before = previous?.jiffies.get(pid);
          const cpuPercent =
            before !== undefined && elapsedSec > 0
              ? Math.max(
                  0,
                  ((stat.jiffies - before) / CLOCK_TICKS_PER_SEC / elapsedSec) *
                    100,
                )
              : null;

          const memBytes = stat.rssPages * PAGE_SIZE_BYTES;
          return {
            pid,
            uid,
            name: stat.comm,
            cpuPercent:
              cpuPercent === null ? null : Math.round(cpuPercent * 10) / 10,
            memPercent:
              totalMem > 0 ? Math.round((memBytes / totalMem) * 1000) / 10 : 0,
            memBytes,
          };
        }),
      );

      // Only advance the baseline once it is old enough to give the next
      // caller a usable window (see MIN_CPU_WINDOW_MS).
      if (!previous || now - previous.at >= MIN_CPU_WINDOW_MS) {
        this.lastProcSample = { at: now, jiffies: jiffiesNow };
      }

      return (
        rows
          .filter((r): r is ProcessInfo => r !== null)
          // Memory is the tie-break so the very first poll, where every cpuPercent
          // is still unknown, is ordered by something meaningful. `?? -1` keeps a
          // null out of the subtraction — NaN there would make the sort order
          // depend on the input order and on the engine's sort implementation.
          .sort(
            (a, b) =>
              (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1) ||
              b.memBytes - a.memBytes,
          )
          .slice(0, MAX_PROCESSES)
      );
    } catch (err) {
      this.logger.error(`reading /proc failed: ${(err as Error).message}`);
      return [];
    }
  }

  getAbout(): Promise<AboutInfo> {
    return Promise.resolve({
      hostname: os.hostname(),
      kernel: os.release(),
      platform: os.platform(),
      arch: os.arch(),
      uptimeSeconds: Math.round(os.uptime()),
      serverPid: process.pid,
      imageVersion: this.getImageVersion(),
    });
  }

  private getImageVersion(): string {
    if (process.env.IMAGE_VERSION) return process.env.IMAGE_VERSION;
    try {
      const pkgPath = path.join(process.cwd(), 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
        version?: string;
      };
      return pkg.version ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  async killProcess(
    pid: number,
    signal: NodeJS.Signals = 'SIGTERM',
  ): Promise<{ pid: number; signaled: boolean }> {
    const safeSignal = ALLOWED_KILL_SIGNALS.includes(signal)
      ? signal
      : 'SIGTERM';
    const targetUid = await this.getProcessUid(pid);
    const ownUid = typeof process.getuid === 'function' ? process.getuid() : 0;

    if (targetUid !== ownUid) {
      throw new ForbiddenException(
        `Refusing to signal pid ${pid}: owned by a different user`,
      );
    }

    try {
      process.kill(pid, safeSignal);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ESRCH')
        throw new NotFoundException(`No such process: ${pid}`);
      throw err;
    }

    return { pid, signaled: true };
  }

  // Reads the real UID of `pid` from /proc/<pid>/status. Exposed (not
  // private) so unit tests can stub it directly when exercising the
  // ownership-scoping logic in killProcess().
  async getProcessUid(pid: number): Promise<number> {
    let raw: string;
    try {
      raw = await fsp.readFile(`/proc/${pid}/status`, 'utf8');
    } catch {
      throw new NotFoundException(`No such process: ${pid}`);
    }
    // Uid line: "Uid:\t<real>\t<effective>\t<saved>\t<fs>"
    const match = raw.match(/^Uid:\s+(\d+)/m);
    if (!match) {
      throw new NotFoundException(`Could not determine owner for pid ${pid}`);
    }
    return Number(match[1]);
  }
}
