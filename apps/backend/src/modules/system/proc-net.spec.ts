import { parseNetDev, bytesPerSecond, toSwapStats } from './proc-net';

describe('parseNetDev', () => {
  const HEADER = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed`;

  it('sums real interfaces and ignores the headers', () => {
    const raw = `${HEADER}
    eth0: 1000      10    0    0    0     0          0         0     2000      20    0    0    0     0       0          0
   wlan0:  500       5    0    0    0     0          0         0      250       3    0    0    0     0       0          0`;
    expect(parseNetDev(raw)).toEqual({ rxBytes: 1500, txBytes: 2250 });
  });

  it('excludes loopback', () => {
    // The load-bearing exclusion: in this OS the desktop talks to its own backend
    // over `lo`, so counting it would report the machine's internal chatter as
    // network traffic — a box with no network at all would show megabytes.
    const raw = `${HEADER}
      lo: 999999    100    0    0    0     0          0         0   999999     100    0    0    0     0       0          0
    eth0:   1000     10    0    0    0     0          0         0     2000      20    0    0    0     0       0          0`;
    expect(parseNetDev(raw)).toEqual({ rxBytes: 1000, txBytes: 2000 });
  });

  it('excludes virtual plumbing that would double-count', () => {
    const raw = `${HEADER}
    eth0:  1000  10 0 0 0 0 0 0   2000  20 0 0 0 0 0 0
docker0:  1000  10 0 0 0 0 0 0   2000  20 0 0 0 0 0 0
   br-ab:  1000  10 0 0 0 0 0 0   2000  20 0 0 0 0 0 0
veth123:  1000  10 0 0 0 0 0 0   2000  20 0 0 0 0 0 0
    ifb0:  1000  10 0 0 0 0 0 0   2000  20 0 0 0 0 0 0`;
    expect(parseNetDev(raw)).toEqual({ rxBytes: 1000, txBytes: 2000 });
  });

  it('reads a counter with NO space after the colon', () => {
    // The trap: once a counter outgrows the column the kernel prints the digits
    // flush against the colon. Tokenising the whole line on whitespace would read
    // "eth0:123456789012" as the interface name — and it only happens on the busy
    // machines whose numbers you actually care about.
    const raw = `${HEADER}
    eth0:123456789012 900 0 0 0 0 0 0 987654321098 800 0 0 0 0 0 0`;
    expect(parseNetDev(raw)).toEqual({
      rxBytes: 123456789012,
      txBytes: 987654321098,
    });
  });

  it('handles the real zero-traffic file from a container', () => {
    // Copied from this host, which has lo + ifb devices and nothing else.
    const raw = `${HEADER}
    lo:       0       0    0    0    0     0          0         0        0       0    0    0    0     0       0          0
  ifb0:       0       0    0    0    0     0          0         0        0       0    0    0    0     0       0          0
  ifb1:       0       0    0    0    0     0          0         0        0       0    0    0    0     0       0          0`;
    expect(parseNetDev(raw)).toEqual({ rxBytes: 0, txBytes: 0 });
  });

  it('skips a malformed line instead of returning NaN', () => {
    // One bad line must not poison every rate the UI shows.
    const raw = `${HEADER}
    eth0: garbage nonsense
    eth1: 100 1 0 0 0 0 0 0 200 2 0 0 0 0 0 0`;
    expect(parseNetDev(raw)).toEqual({ rxBytes: 100, txBytes: 200 });
  });

  it('returns zeros for empty input', () => {
    expect(parseNetDev('')).toEqual({ rxBytes: 0, txBytes: 0 });
  });
});

describe('bytesPerSecond', () => {
  it('computes a rate over the elapsed window', () => {
    expect(bytesPerSecond(0, 1500, 1500)).toBe(1000);
    expect(bytesPerSecond(1000, 2000, 500)).toBe(2000);
  });

  it('returns 0 for a zero or negative window rather than dividing by it', () => {
    expect(bytesPerSecond(0, 1000, 0)).toBe(0);
    expect(bytesPerSecond(0, 1000, -5)).toBe(0);
    expect(bytesPerSecond(0, 1000, NaN)).toBe(0);
  });

  it('returns 0 when the counter went backwards', () => {
    // Interface reset, removed, or a 32-bit counter wrapped. A huge spike or a
    // negative rate would both be lies; 0 for one tick is not.
    expect(bytesPerSecond(5000, 100, 1500)).toBe(0);
  });

  it('is zero when nothing moved', () => {
    expect(bytesPerSecond(4242, 4242, 1500)).toBe(0);
  });
});

describe('toSwapStats', () => {
  it('reports zeros on a host with no swap, without dividing by zero', () => {
    // This container has SwapTotal: 0. `0/0` is NaN, and a gauge fed NaN renders an
    // empty bar that reads as a broken component rather than "there is no swap".
    expect(toSwapStats(0, 0)).toEqual({
      totalBytes: 0,
      usedBytes: 0,
      freeBytes: 0,
      percent: 0,
    });
  });

  it('computes used and percent from total and free', () => {
    expect(toSwapStats(1000, 250)).toEqual({
      totalBytes: 1000,
      usedBytes: 750,
      freeBytes: 250,
      percent: 75,
    });
  });

  it('never reports more free than total', () => {
    // Defensive: a torn read of /proc/meminfo between the two lines would otherwise
    // produce a negative "used".
    const s = toSwapStats(1000, 5000);
    expect(s.freeBytes).toBe(1000);
    expect(s.usedBytes).toBe(0);
    expect(s.percent).toBe(0);
  });

  it('treats missing or nonsense figures as no swap', () => {
    expect(toSwapStats(NaN, NaN).totalBytes).toBe(0);
    expect(toSwapStats(-1, -1).totalBytes).toBe(0);
    expect(toSwapStats(1000, NaN).usedBytes).toBe(1000);
  });

  it('rounds percent to one decimal', () => {
    expect(toSwapStats(3000, 1000).percent).toBe(66.7);
  });
});
