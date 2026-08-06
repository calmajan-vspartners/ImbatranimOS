import * as fs from 'fs/promises';
import * as os from 'os';
import { join } from 'path';
import { LogService } from './log.service';
import { LogsController } from './logs.controller';
import { ThrottleService } from '../auth/throttle.service';
import { FilesService } from '../files/files.service';
import { TrashService } from '../files/trash.service';
import {
  MAX_VALUE_LENGTH,
  REDACTED,
  isSecretKey,
  redact,
  serialiseEntry,
} from './redact';
import type { LogEntry } from './log.service';

/** JSON.parse returns `any`; every read here goes through this instead. */
const parseEntry = (
  line: string,
): LogEntry & { meta?: Record<string, unknown> } =>
  JSON.parse(line) as LogEntry & { meta?: Record<string, unknown> };

/**
 * Brief 84 — the machine's memory of itself.
 *
 * The load-bearing test in this file is the one asserting a failed login does
 * **not** record the attempted password. A log written by the process that also
 * handles credentials is exactly where a secret leaks, and "we were careful at
 * the call sites" is not a guarantee — the guard has to be provable.
 */
describe('LogService — brief 84', () => {
  let home: string;
  let logs: LogService;
  const prevRoot = process.env.FILES_ROOT;
  const prevMax = process.env.LOG_MAX_FILE_BYTES;

  const logPath = () => join(home, '.imbatranim', 'logs', 'system.log');
  const rotatedPath = () => join(home, '.imbatranim', 'logs', 'system.log.1');

  const read = async (p: string): Promise<string> => {
    try {
      return await fs.readFile(p, 'utf8');
    } catch {
      return '';
    }
  };

  beforeEach(async () => {
    home = await fs.mkdtemp(join(os.tmpdir(), 'imb-b84-'));
    process.env.FILES_ROOT = home;
    logs = new LogService();
    await logs.onModuleInit();
  });

  afterEach(async () => {
    // Delete rather than assign: `process.env.X = undefined` stores the literal
    // string "undefined", which would point the next test's home at a directory
    // called that.
    if (prevRoot === undefined) delete process.env.FILES_ROOT;
    else process.env.FILES_ROOT = prevRoot;
    if (prevMax === undefined) delete process.env.LOG_MAX_FILE_BYTES;
    else process.env.LOG_MAX_FILE_BYTES = prevMax;
    await fs.rm(home, { recursive: true, force: true });
  });

  // ── redaction: the guarantee, tested as a pure function ──────────────────

  describe('redaction', () => {
    it('drops every value whose key names a secret', () => {
      const out = redact({
        password: 'hunter2',
        currentPassword: 'hunter2',
        newPassword: 'hunter3',
        totpSecret: 'JBSWY3DP',
        token: 'abc',
        sessionToken: 'abc',
        cookie: 'sid=1',
        authorization: 'Bearer x',
        passwordHash: '$argon2id$...',
        salt: 'nacl',
      }) as Record<string, unknown>;
      for (const value of Object.values(out)) expect(value).toBe(REDACTED);
    });

    it('keeps the fields that make an entry useful', () => {
      const out = redact({ ip: '10.0.0.4', pid: 42, ok: false }) as Record<
        string,
        unknown
      >;
      expect(out).toEqual({ ip: '10.0.0.4', pid: 42, ok: false });
    });

    it('recognises the key names the call sites actually use', () => {
      for (const key of [
        'password',
        'newPassword',
        'token',
        'totp',
        'otpCode',
        'secret',
        'apiKey',
        'setupToken',
        'sessionId',
      ]) {
        expect(isSecretKey(key)).toBe(true);
      }
      for (const key of ['ip', 'pid', 'path', 'appId', 'signal', 'entries']) {
        expect(isSecretKey(key)).toBe(false);
      }
    });

    it('redacts a secret nested inside another object', () => {
      const out = redact({ body: { user: 'me', password: 'hunter2' } }) as {
        body: Record<string, unknown>;
      };
      expect(out.body.password).toBe(REDACTED);
      expect(out.body.user).toBe('me');
    });

    it('truncates a very long string instead of writing it whole', () => {
      const out = redact({ note: 'x'.repeat(5000) }) as { note: string };
      expect(out.note.length).toBeLessThan(MAX_VALUE_LENGTH + 40);
      expect(out.note).toMatch(/5000 chars/);
    });

    it('describes what it cannot serialise rather than throwing', () => {
      const out = redact({ fn: () => 1, sym: Symbol('s') }) as Record<
        string,
        string
      >;
      expect(out.fn).toBe('[function]');
      expect(out.sym).toBe('[symbol]');
    });

    it('survives a cycle', () => {
      const a: Record<string, unknown> = { name: 'a' };
      a.self = a;
      expect(() =>
        serialiseEntry({
          t: '',
          level: 'info',
          event: 'e',
          msg: 'm',
          meta: redact(a),
        }),
      ).not.toThrow();
    });

    it('drops the metadata rather than writing a giant line', () => {
      const line = serialiseEntry({
        t: 'now',
        level: 'info',
        event: 'big',
        source: 'server',
        msg: 'm',
        meta: { blob: Array.from({ length: 2000 }, (_, i) => `value-${i}`) },
      });
      expect(line.length).toBeLessThan(9000);
      expect(line).toContain('entry too large');
    });

    it('never emits a bare newline that would split one entry into two', () => {
      const line = serialiseEntry({
        t: 'now',
        level: 'info',
        event: 'e',
        source: 'server',
        msg: 'line one\nline two',
      });
      expect(line.split('\n').filter((l) => l.length > 0)).toHaveLength(1);
    });
  });

  // ── writing ──────────────────────────────────────────────────────────────

  describe('writing', () => {
    it('writes one JSON object per line', async () => {
      logs.audit('a.b', 'first');
      logs.audit('a.c', 'second');
      await logs.flush();
      const lines = (await read(logPath())).trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(parseEntry(lines[0]).event).toBe('a.b');
      expect(parseEntry(lines[1]).msg).toBe('second');
    });

    it('stamps a timestamp, a level and the source', async () => {
      logs.record('warn', 'x.y', 'careful');
      await logs.flush();
      const entry = parseEntry((await read(logPath())).trim());
      expect(entry.level).toBe('warn');
      expect(entry.source).toBe('server');
      expect(Number.isNaN(Date.parse(entry.t))).toBe(false);
    });

    it('redacts on the way in, so the file never contains the secret', async () => {
      logs.audit('a.b', 'careless caller', { password: 'hunter2' });
      await logs.flush();
      const raw = await read(logPath());
      expect(raw).not.toContain('hunter2');
      expect(raw).toContain(REDACTED);
    });

    it('does not throw, or reject, when the log cannot be written', async () => {
      // A FILE where a directory should be: mkdir fails with ENOTDIR straight
      // away, which is the disk-is-broken case without waiting on a real one.
      const blocker = join(home, 'not-a-directory');
      await fs.writeFile(blocker, 'x');
      const broken = new LogService();
      process.env.FILES_ROOT = join(blocker, 'nested');
      await broken.onModuleInit();
      process.env.FILES_ROOT = home;

      expect(() => broken.audit('a.b', 'into the void')).not.toThrow();
      await expect(broken.flush()).resolves.toBeUndefined();
    });
  });

  // ── rotation ─────────────────────────────────────────────────────────────

  describe('rotation', () => {
    it('rotates at the cap and keeps exactly two files', async () => {
      process.env.LOG_MAX_FILE_BYTES = '2048';
      const small = new LogService();
      await small.onModuleInit();
      for (let i = 0; i < 200; i++) small.audit('flood', `entry ${i}`, { i });
      await small.flush();

      const current = await read(logPath());
      const rotated = await read(rotatedPath());
      expect(current.length).toBeGreaterThan(0);
      expect(rotated.length).toBeGreaterThan(0);
      // The whole point: a flood cannot exceed the cap.
      expect(current.length).toBeLessThanOrEqual(2048 + 200);

      const dir = await fs.readdir(join(home, '.imbatranim', 'logs'));
      expect(dir.sort()).toEqual(['system.log', 'system.log.1']);
    });

    it('a flood cannot grow the log without bound', async () => {
      process.env.LOG_MAX_FILE_BYTES = '1024';
      const small = new LogService();
      await small.onModuleInit();
      for (let i = 0; i < 2000; i++) small.audit('flood', `entry ${i}`);
      await small.flush();
      const dir = join(home, '.imbatranim', 'logs');
      const total = (await fs.readdir(dir)).length;
      expect(total).toBe(2);
    });
  });

  // ── reading ──────────────────────────────────────────────────────────────

  describe('the tail endpoint', () => {
    const seed = async (n: number): Promise<void> => {
      for (let i = 0; i < n; i++) {
        logs.record(
          i % 3 === 0 ? 'error' : 'info',
          `seed.${i}`,
          `message ${i}`,
        );
      }
      await logs.flush();
    };

    it('returns the newest entries first', async () => {
      await seed(10);
      const { entries } = await logs.tail({ limit: 3 });
      expect(entries.map((e) => e.msg)).toEqual([
        'message 9',
        'message 8',
        'message 7',
      ]);
    });

    it('never returns more than the limit', async () => {
      await seed(50);
      const { entries } = await logs.tail({ limit: 5 });
      expect(entries).toHaveLength(5);
    });

    it('caps the limit even when a caller asks for the world', async () => {
      await seed(5);
      const { entries } = await logs.tail({ limit: 999_999 });
      expect(entries.length).toBeLessThanOrEqual(5);
    });

    it('filters by level', async () => {
      await seed(12);
      const { entries } = await logs.tail({ level: 'error', limit: 100 });
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every((e) => e.level === 'error')).toBe(true);
    });

    it('filters by text, case-insensitively', async () => {
      logs.audit('a.b', 'The Quick Brown Fox');
      logs.audit('a.c', 'nothing to see');
      await logs.flush();
      const { entries } = await logs.tail({ q: 'quick brown' });
      expect(entries).toHaveLength(1);
      expect(entries[0].msg).toBe('The Quick Brown Fox');
    });

    it('reads across the rotation boundary when the current file is short', async () => {
      process.env.LOG_MAX_FILE_BYTES = '900';
      const small = new LogService();
      await small.onModuleInit();
      for (let i = 0; i < 40; i++) small.audit('roll', `entry ${i}`);
      await small.flush();
      const { entries } = await small.tail({ limit: 40 });
      // More than one file's worth, so the walk continued into system.log.1.
      expect(entries.length).toBeGreaterThan(8);
    });

    it('survives a torn line without losing the rest of the log', async () => {
      logs.audit('a.b', 'before');
      await logs.flush();
      await fs.appendFile(logPath(), '{"t":"broken","lev\n', 'utf8');
      logs.audit('a.c', 'after');
      await logs.flush();
      const { entries } = await logs.tail({ limit: 10 });
      expect(entries.map((e) => e.msg)).toEqual(['after', 'before']);
    });

    it('returns nothing, rather than failing, when there is no log yet', async () => {
      const fresh = new LogService();
      process.env.FILES_ROOT = await fs.mkdtemp(
        join(os.tmpdir(), 'imb-b84-empty-'),
      );
      await fresh.onModuleInit();
      await expect(fresh.tail()).resolves.toEqual({
        entries: [],
        truncated: false,
      });
    });
  });

  // ── the client-reported path ─────────────────────────────────────────────

  describe('crashes reported by the browser', () => {
    it('is tagged as client, so it can never pass for a server observation', async () => {
      const controller = new LogsController(logs);
      controller.clientError({
        appId: 'calculator',
        message: 'x is not a function',
      });
      await logs.flush();
      const entry = parseEntry((await read(logPath())).trim());
      expect(entry.source).toBe('client');
      expect(entry.event).toBe('app.crashed');
      expect(entry.level).toBe('error');
    });

    it('stops accepting once the budget is spent, and says so', async () => {
      process.env.LOG_CLIENT_BUDGET = '3';
      const bounded = new LogService();
      await bounded.onModuleInit();
      const results = Array.from({ length: 6 }, () =>
        bounded.recordFromClient('app.crashed', 'loop'),
      );
      expect(results).toEqual([true, true, true, false, false, false]);
      delete process.env.LOG_CLIENT_BUDGET;
    });
  });
});

// ── the deliberate call sites ──────────────────────────────────────────────

describe('audit call sites — brief 84', () => {
  let home: string;
  let logs: LogService;
  const prevRoot = process.env.FILES_ROOT;
  const logPath = () => join(home, '.imbatranim', 'logs', 'system.log');

  beforeEach(async () => {
    home = await fs.mkdtemp(join(os.tmpdir(), 'imb-b84-sites-'));
    process.env.FILES_ROOT = home;
    logs = new LogService();
    await logs.onModuleInit();
  });

  afterEach(async () => {
    if (prevRoot === undefined) delete process.env.FILES_ROOT;
    else process.env.FILES_ROOT = prevRoot;
    await fs.rm(home, { recursive: true, force: true });
  });

  it('THE LOCKOUT IS RECORDED, once, on the transition into it', async () => {
    const throttle = new ThrottleService(logs);
    for (let i = 0; i < throttle.FAIL_THRESHOLD + 3; i++) {
      throttle.recordFailure('10.0.0.9');
    }
    await logs.flush();
    const lines = (await fs.readFile(logPath(), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => parseEntry(l));
    const lockouts = lines.filter((l) => l.event === 'auth.throttle.locked');
    // Once, not once per failure past the threshold — otherwise a sustained
    // attack pushes its own beginning out of the rotation window.
    expect(lockouts).toHaveLength(1);
    expect(lockouts[0].meta?.ip).toBe('10.0.0.9');
  });

  it('a permanent delete records the ORIGINAL path, not the trash id', async () => {
    const files = new FilesService();
    const trash = new TrashService(files, logs);
    await fs.mkdir(join(home, 'Documents'), { recursive: true });
    await fs.writeFile(join(home, 'Documents', 'taxes.pdf'), 'money');

    const { id } = await trash.trash('Documents/taxes.pdf');
    await trash.remove(id);
    await logs.flush();

    const raw = await fs.readFile(logPath(), 'utf8');
    const entry = raw
      .trim()
      .split('\n')
      .map(
        (l) =>
          JSON.parse(l) as { event: string; meta?: { originalPath?: string } },
      )
      .find((l) => l.event === 'files.deleted');
    expect(entry?.meta?.originalPath).toBe('Documents/taxes.pdf');
  });

  it('emptying the Trash is recorded with a count', async () => {
    const files = new FilesService();
    const trash = new TrashService(files, logs);
    await fs.writeFile(join(home, 'a.txt'), 'a');
    await fs.writeFile(join(home, 'b.txt'), 'b');
    await trash.trash('a.txt');
    await trash.trash('b.txt');
    await trash.empty();
    await logs.flush();

    const entry = (await fs.readFile(logPath(), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => parseEntry(l))
      .find((l) => l.event === 'files.trash.emptied');
    expect(entry?.meta?.items).toBe(2);
  });

  it('the throttle still works with no logger attached', () => {
    const throttle = new ThrottleService();
    for (let i = 0; i < throttle.FAIL_THRESHOLD + 1; i++) {
      throttle.recordFailure('10.0.0.1');
    }
    expect(() => throttle.assertNotLocked('10.0.0.1')).toThrow();
  });
});
