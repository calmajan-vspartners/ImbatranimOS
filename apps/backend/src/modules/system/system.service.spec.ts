import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { parseProcStat, SystemService } from './system.service';

describe('SystemService.killProcess (uid scoping)', () => {
  let service: SystemService;
  let killSpy: jest.SpyInstance;
  let getuidSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new SystemService();
    killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
    getuidSpy = jest
      .spyOn(process, 'getuid' as never)
      .mockImplementation(() => 1000 as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('signals a process owned by the same uid as the current process', async () => {
    jest.spyOn(service, 'getProcessUid').mockResolvedValue(1000);

    const result = await service.killProcess(4242);

    expect(result).toEqual({ pid: 4242, signaled: true });
    expect(killSpy).toHaveBeenCalledWith(4242, 'SIGTERM');
  });

  it('refuses (403) to signal a process owned by a different uid', async () => {
    jest.spyOn(service, 'getProcessUid').mockResolvedValue(0); // e.g. root-owned

    await expect(service.killProcess(1)).rejects.toThrow(ForbiddenException);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('never calls process.kill before the uid check resolves', async () => {
    let uidChecked = false;
    jest.spyOn(service, 'getProcessUid').mockImplementation(() => {
      uidChecked = true;
      return Promise.resolve(1000);
    });
    killSpy.mockImplementation(() => {
      expect(uidChecked).toBe(true);
      return true;
    });

    await service.killProcess(4242);
    expect(killSpy).toHaveBeenCalled();
  });

  it('translates a missing pid (ESRCH from getProcessUid) to 404', async () => {
    jest
      .spyOn(service, 'getProcessUid')
      .mockRejectedValue(new NotFoundException('No such process: 99999'));

    await expect(service.killProcess(99999)).rejects.toThrow(NotFoundException);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('translates an ESRCH error from process.kill itself to 404', async () => {
    jest.spyOn(service, 'getProcessUid').mockResolvedValue(1000);
    killSpy.mockImplementation(() => {
      const err = new Error('No such process') as NodeJS.ErrnoException;
      err.code = 'ESRCH';
      throw err;
    });

    await expect(service.killProcess(4242)).rejects.toThrow(NotFoundException);
  });

  it('falls back to uid 0 when process.getuid is unavailable (non-POSIX)', async () => {
    getuidSpy.mockRestore();
    Object.defineProperty(process, 'getuid', {
      value: undefined,
      configurable: true,
    });
    jest.spyOn(service, 'getProcessUid').mockResolvedValue(0);

    const result = await service.killProcess(4242);
    expect(result.signaled).toBe(true);
  });
});

describe('SystemService.getProcessUid (real /proc read)', () => {
  it('reads the uid of the current test process from /proc/self equivalent', async () => {
    // Not mocked here: exercises the real /proc/<pid>/status parser against
    // this Jest process itself, which is guaranteed to exist and be owned
    // by the current uid — a real (non-simulated) sanity check.
    const service = new SystemService();
    const ownUid = typeof process.getuid === 'function' ? process.getuid() : 0;
    const uid = await service.getProcessUid(process.pid);
    expect(uid).toBe(ownUid);
  });

  it('throws NotFoundException for a pid that does not exist', async () => {
    const service = new SystemService();
    // PID 4-billion-ish is never valid; guaranteed to miss /proc.
    await expect(service.getProcessUid(999999999)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('parseProcStat', () => {
  // Real line shapes from /proc/<pid>/stat. Fields after the comm are, in
  // order: state ppid pgrp session tty tpgid flags minflt cminflt majflt
  // cmajflt utime stime ... so utime is the 12th token after ')'.
  const line = (comm: string, utime: number, stime: number, rss: number) =>
    `1234 (${comm}) S 1 1234 1234 0 -1 4194560 900 0 0 0 ` +
    `${utime} ${stime} 0 0 20 0 1 0 4242 12345678 ${rss} ` +
    '18446744073709551615 1 1 0 0 0 0 0 0 0 0 0 0 17 3 0 0 0 0 0';

  it('reads pid, comm, summed jiffies and rss pages', () => {
    const out = parseProcStat(line('node', 130, 70, 5000));
    expect(out).toEqual({
      pid: 1234,
      comm: 'node',
      jiffies: 200,
      rssPages: 5000,
    });
  });

  it('handles a comm containing spaces without shifting later fields', () => {
    // Naive whitespace tokenising misreads every field after a spaced comm.
    const out = parseProcStat(line('Web Content', 10, 5, 99));
    expect(out).toMatchObject({
      comm: 'Web Content',
      jiffies: 15,
      rssPages: 99,
    });
  });

  it('handles a comm containing parentheses (splits on the LAST one)', () => {
    const out = parseProcStat(line('(sd-pam)', 3, 4, 7));
    expect(out).toMatchObject({ comm: '(sd-pam)', jiffies: 7, rssPages: 7 });
  });

  it('returns null for a malformed line rather than throwing', () => {
    expect(parseProcStat('')).toBeNull();
    expect(parseProcStat('no parens here')).toBeNull();
    expect(parseProcStat('1234 (node) S 1 2 3')).toBeNull();
  });
});

describe('SystemService.getProcesses', () => {
  it('reports 0% on the first poll and real busy time on the second', async () => {
    const service = new SystemService();

    const first = await service.getProcesses();
    expect(Array.isArray(first)).toBe(true);
    // /proc always has at least this process.
    expect(first.length).toBeGreaterThan(0);
    // NULL, not 0, on the first poll — brief 58. There is no baseline to diff
    // against yet, so nothing is known about any process's CPU use, and a confident
    // `0.0` for a busy process is a lie that persists until the next poll. This
    // assertion previously required 0; the change is deliberate.
    expect(first.every((p) => p.cpuPercent === null)).toBe(true);

    // Every row must be shaped correctly and carry real memory numbers.
    for (const p of first) {
      expect(Number.isInteger(p.pid)).toBe(true);
      expect(Number.isInteger(p.uid)).toBe(true);
      expect(typeof p.name).toBe('string');
      expect(p.memBytes).toBeGreaterThanOrEqual(0);
      expect(p.memPercent).toBeGreaterThanOrEqual(0);
    }

    // Burn CPU so the delta is non-zero, then poll again.
    const spin = Date.now();
    while (Date.now() - spin < 120) {
      /* busy */
    }
    const second = await service.getProcesses();
    // Second poll HAS a baseline, so the values are real numbers again.
    expect(second.some((p) => p.cpuPercent !== null && p.cpuPercent > 0)).toBe(
      true,
    );
  });

  it('finds this very process in the table', async () => {
    const service = new SystemService();
    const rows = await service.getProcesses();
    expect(rows.some((p) => p.pid === process.pid)).toBe(true);
  });
});
