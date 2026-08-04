/**
 * `/proc/net/dev` parsing, and the rate maths over two samples.
 *
 * Its own module with its own tests because the file's format has two traps that
 * are invisible until they bite, and because "how much network is this machine
 * doing" is a number a user will believe.
 */

export type NetTotals = { rxBytes: number; txBytes: number };

/**
 * Interfaces excluded from the totals.
 *
 * **Loopback is the important one.** In this OS the desktop talks to its own
 * backend over `lo` — every file read, every stats poll, the PTY stream. Counting
 * it would report the OS's own internal chatter as "network activity", so a machine
 * with no network at all would show megabytes of traffic. That is worse than
 * reporting nothing.
 *
 * The rest are virtual plumbing that would double-count real traffic: bridges and
 * veth pairs carry the same packets the physical interface already counted, and
 * `ifb` is the kernel's ingress-redirect device.
 */
const EXCLUDED_PREFIXES = [
  'lo',
  'ifb',
  'docker',
  'br-',
  'veth',
  'virbr',
  'tun',
  'tap',
];

function isCounted(name: string): boolean {
  return !EXCLUDED_PREFIXES.some((p) => name === p || name.startsWith(p));
}

/**
 * Sum received and transmitted bytes across the real interfaces.
 *
 * The format is `name: <8 receive fields> <8 transmit fields>`, with `bytes` first
 * in each group. Two traps:
 *
 * 1. **The name is right-padded with spaces** (`    lo:`), so it has to be trimmed.
 * 2. **There may be no space after the colon.** Once a counter grows past the
 *    column width the kernel prints `eth0:1234567890` with the digits flush against
 *    it — so tokenising the whole line on whitespace silently reads the byte count
 *    as the interface name on exactly the busy machines you care about. Splitting on
 *    the first colon avoids it.
 */
export function parseNetDev(raw: string): NetTotals {
  let rxBytes = 0;
  let txBytes = 0;

  for (const line of raw.split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue; // the two header lines
    const name = line.slice(0, colon).trim();
    if (!name || !isCounted(name)) continue;

    const fields = line
      .slice(colon + 1)
      .trim()
      .split(/\s+/);
    const rx = Number(fields[0]);
    const tx = Number(fields[8]);
    // A malformed line is skipped rather than poisoning the sum with NaN, which
    // would propagate into every rate the UI shows.
    if (Number.isFinite(rx)) rxBytes += rx;
    if (Number.isFinite(tx)) txBytes += tx;
  }

  return { rxBytes, txBytes };
}

/**
 * Bytes per second between two cumulative samples.
 *
 * Guards the three ways this goes wrong in practice:
 *
 * - **A zero or negative window** would divide by zero. Returns 0.
 * - **A counter that went backwards** means the interface was reset or removed
 *   (or a 32-bit counter wrapped). Reporting a huge negative rate — or a huge
 *   positive one from an unsigned wrap — is worse than reporting 0 for one tick.
 * - **A too-short window** exaggerates: at a 20 ms gap a single packet reads as a
 *   large rate. The caller holds the baseline until it is old enough, the same way
 *   the CPU delta does.
 */
export function bytesPerSecond(
  previousBytes: number,
  currentBytes: number,
  elapsedMs: number,
): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  const delta = currentBytes - previousBytes;
  if (!Number.isFinite(delta) || delta < 0) return 0;
  return Math.round((delta / elapsedMs) * 1000);
}

/** Swap figures, tolerating a host with no swap configured at all. */
export type SwapStats = {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  percent: number;
};

/**
 * Swap from parsed `/proc/meminfo` values.
 *
 * A container commonly has `SwapTotal: 0`, which must report zeros rather than
 * dividing by it — `0/0` is `NaN`, and a gauge fed NaN renders an empty bar that
 * looks like a broken component instead of "there is no swap".
 */
export function toSwapStats(totalBytes: number, freeBytes: number): SwapStats {
  const total = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0;
  const free =
    Number.isFinite(freeBytes) && freeBytes > 0
      ? Math.min(freeBytes, total)
      : 0;
  const used = Math.max(total - free, 0);
  const percent = total === 0 ? 0 : Math.round((used / total) * 1000) / 10;
  return { totalBytes: total, usedBytes: used, freeBytes: free, percent };
}
