import { NotFoundException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as os from 'os';
import { join } from 'path';

// execa is pure ESM and Jest (CommonJS transform) can't load it via the dynamic
// import. Swap it for a faithful stand-in backed by child_process.execFile:
// REAL git still runs — same array args, cwd, env, and output bounds execa
// would apply — we only avoid loading the ESM module Jest can't parse. Nothing
// about the git behaviour under test is simulated.
jest.mock('execa', () => {
  const { execFile } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('node:child_process') as typeof import('node:child_process');
  return {
    __esModule: true,
    execa: (
      file: string,
      args: string[],
      opts: {
        cwd?: string;
        env?: NodeJS.ProcessEnv;
        maxBuffer?: number;
        timeout?: number;
      } = {},
    ) =>
      new Promise((resolve) => {
        execFile(
          file,
          args,
          {
            cwd: opts.cwd,
            env: { ...process.env, ...(opts.env ?? {}) },
            maxBuffer: opts.maxBuffer,
            timeout: opts.timeout,
            encoding: 'utf8',
          },
          (
            err: (Error & { code?: number | string }) | null,
            stdout: string,
            stderr: string,
          ) => {
            resolve({
              stdout: stdout ?? '',
              stderr: stderr ?? '',
              exitCode:
                err && typeof err.code === 'number' ? err.code : err ? 1 : 0,
            });
          },
        );
      }),
  };
});

import { GitService, isBinaryMissing } from './git.service';
import { FilesService } from '../files/files.service';

/**
 * These run REAL git in a REAL temp repo that IS the `home` jail for the test
 * (FILES_ROOT), mirroring FilesService's "real filesystem, not simulated"
 * style. They prove behaviour end-to-end: the FS jail, the work-tree gate,
 * status/log/diff parsing, the `--` pathspec guard, and — critically — that a
 * commit message full of shell metacharacters is stored literally and never
 * executed.
 */
describe('GitService (real git in a jailed temp repo)', () => {
  let service: GitService;
  let jail: string;
  const repoRel = 'repo';
  const prevEnv = process.env.FILES_ROOT;

  const repoAbs = () => join(jail, repoRel);

  beforeEach(async () => {
    jail = await fs.mkdtemp(join(os.tmpdir(), 'imb-git-'));
    process.env.FILES_ROOT = jail;
    service = new GitService(new FilesService());

    const repo = repoAbs();
    await fs.mkdir(repo);
    await service.exec(repo, ['init', '-q', '-b', 'main']);
    await service.exec(repo, ['config', 'user.email', 't@example.com']);
    await service.exec(repo, ['config', 'user.name', 'Tester']);
    await service.exec(repo, ['config', 'commit.gpgsign', 'false']);
  }, 30000);

  afterEach(async () => {
    process.env.FILES_ROOT = prevEnv;
    await fs.rm(jail, { recursive: true, force: true });
  });

  /** Stage a file through the real index and commit it. */
  async function commitFile(name: string, content: string, message: string) {
    await fs.writeFile(join(repoAbs(), name), content);
    await service.exec(repoAbs(), ['add', '--', name]);
    await service.exec(repoAbs(), ['commit', '-q', '-m', message]);
  }

  describe('jail + work-tree gate', () => {
    it('rejects a path that escapes the jail (traversal)', async () => {
      await expect(service.status('home', '../../etc')).rejects.toThrow(
        /traversal/i,
      );
    });

    it('rejects percent-encoded traversal', async () => {
      await expect(service.status('home', '%2e%2e/%2e%2e/etc')).rejects.toThrow(
        /traversal/i,
      );
    });

    it('404s a directory that exists but is not a git work tree', async () => {
      await fs.mkdir(join(jail, 'plain'));
      await expect(service.status('home', 'plain')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.status('home', 'plain')).rejects.toThrow(
        /work tree/i,
      );
    });

    it('404s a directory that does not exist', async () => {
      await expect(service.status('home', 'nope')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('resolves the repo to the jailed absolute dir (never a client path)', async () => {
      const abs = await service.resolveRepo('home', repoRel);
      expect(abs).toBe(repoAbs());
    });
  });

  describe('status', () => {
    it('reports staged, unstaged, and untracked entries', async () => {
      await commitFile('a.txt', 'v1\n', 'init');
      // Unstaged modification of a tracked file.
      await fs.writeFile(join(repoAbs(), 'a.txt'), 'v2\n');
      // A staged new file.
      await fs.writeFile(join(repoAbs(), 'b.txt'), 'new\n');
      await service.exec(repoAbs(), ['add', '--', 'b.txt']);
      // A brand-new untracked file.
      await fs.writeFile(join(repoAbs(), 'c.txt'), 'untracked\n');

      const { entries } = await service.status('home', repoRel);
      const byPath = new Map(entries.map((e) => [e.path, e]));

      expect(byPath.get('a.txt')?.worktree).toBe('M');
      expect(byPath.get('a.txt')?.staged).toBe(false);

      expect(byPath.get('b.txt')?.index).toBe('A');
      expect(byPath.get('b.txt')?.staged).toBe(true);

      expect(byPath.get('c.txt')?.index).toBe('?');
      expect(byPath.get('c.txt')?.staged).toBe(false);
    });
  });

  describe('stage / unstage', () => {
    it('stage adds a file to the index; unstage removes it again', async () => {
      await fs.writeFile(join(repoAbs(), 'f.txt'), 'hi\n');

      const afterStage = await service.stage('home', ['f.txt'], repoRel);
      expect(afterStage.entries.find((e) => e.path === 'f.txt')?.index).toBe(
        'A',
      );

      const afterUnstage = await service.unstage('home', ['f.txt'], repoRel);
      const entry = afterUnstage.entries.find((e) => e.path === 'f.txt');
      // Back to untracked after unstaging a never-committed file.
      expect(entry?.index).toBe('?');
    });

    it('treats a pathspec beginning with "-" as a path, not a flag (`--` guard)', async () => {
      // Without the `--` guard, `git add -n` would be a dry-run flag; with it,
      // "-n" is the literal filename that was actually created on disk.
      await fs.writeFile(join(repoAbs(), '-n'), 'dash-leading name\n');

      const { entries } = await service.stage('home', ['-n'], repoRel);
      expect(entries.find((e) => e.path === '-n')?.index).toBe('A');
    });
  });

  describe('commit + log', () => {
    it('log returns [] for a repo with no commits yet', async () => {
      const { commits } = await service.log('home', repoRel);
      expect(commits).toEqual([]);
    });

    it('commit records a commit visible in log with author + subject', async () => {
      await fs.writeFile(join(repoAbs(), 'x.txt'), 'content\n');
      await service.stage('home', ['x.txt'], repoRel);

      const res = await service.commit('home', 'first real commit', repoRel);
      expect(typeof res.output).toBe('string');

      const { commits } = await service.log('home', repoRel);
      expect(commits).toHaveLength(1);
      expect(commits[0].subject).toBe('first real commit');
      expect(commits[0].authorName).toBe('Tester');
      expect(commits[0].authorEmail).toBe('t@example.com');
      expect(commits[0].hash).toMatch(/^[0-9a-f]{40}$/);
      expect(commits[0].date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('respects the log limit', async () => {
      await commitFile('a.txt', '1\n', 'c1');
      await commitFile('a.txt', '2\n', 'c2');
      await commitFile('a.txt', '3\n', 'c3');
      const { commits } = await service.log('home', repoRel, 2);
      expect(commits).toHaveLength(2);
      expect(commits[0].subject).toBe('c3');
    });

    it('stores a commit message full of shell metacharacters LITERALLY (no injection)', async () => {
      await fs.writeFile(join(repoAbs(), 'z.txt'), 'z\n');
      await service.stage('home', ['z.txt'], repoRel);

      // If the message were ever handed to a shell, `touch pwned` would run.
      const evil = "subj\"; touch pwned; echo '$(whoami)' `id` #";
      await service.commit('home', evil, repoRel);

      // The sentinel file must NOT exist — nothing was executed.
      await expect(fs.stat(join(repoAbs(), 'pwned'))).rejects.toBeTruthy();

      const { commits } = await service.log('home', repoRel);
      expect(commits[0].subject).toBe(evil);
    });
  });

  describe('diff', () => {
    it('shows an unstaged change, and the staged change with staged=true', async () => {
      await commitFile('d.txt', 'line1\n', 'seed');
      await fs.writeFile(join(repoAbs(), 'd.txt'), 'line1\nline2\n');

      const unstaged = await service.diff('home', repoRel, false);
      expect(unstaged.diff).toContain('+line2');

      // Nothing staged yet → staged diff empty.
      const stagedEmpty = await service.diff('home', repoRel, true);
      expect(stagedEmpty.diff).toBe('');

      await service.stage('home', ['d.txt'], repoRel);
      const staged = await service.diff('home', repoRel, true, 'd.txt');
      expect(staged.diff).toContain('+line2');
    });
  });

  describe('exec seam — every op uses array args, never a command string', () => {
    it('routes stage through git with `--` before the pathspec', async () => {
      await fs.writeFile(join(repoAbs(), 'g.txt'), 'g\n');
      const spy = jest.spyOn(service, 'exec');

      await service.stage('home', ['g.txt'], repoRel);

      // No call ever passes a string command — the 2nd arg is always string[].
      for (const call of spy.mock.calls) {
        expect(typeof call[0]).toBe('string');
        expect(Array.isArray(call[1])).toBe(true);
      }
      // The `add` invocation puts `--` immediately before the pathspec.
      const addCall = spy.mock.calls.find((c) => c[1].includes('add'));
      expect(addCall).toBeDefined();
      const args = addCall![1];
      expect(args).toContain('--');
      expect(args.indexOf('--')).toBeLessThan(args.indexOf('g.txt'));
      spy.mockRestore();
    });
  });
});

describe('GitService parsers (pure)', () => {
  const service = new GitService(new FilesService());

  it('parseStatus handles staged/unstaged/untracked and NUL-separated names', () => {
    // porcelain=v1 -z: `XY path\0` records; names may contain spaces.
    const z = 'M  src/a.ts\0 M "weird name.ts"\0?? new file.ts\0';
    const entries = service.parseStatus(z);
    expect(entries).toEqual([
      {
        index: 'M',
        worktree: ' ',
        path: 'src/a.ts',
        origPath: undefined,
        staged: true,
      },
      {
        index: ' ',
        worktree: 'M',
        path: '"weird name.ts"',
        origPath: undefined,
        staged: false,
      },
      {
        index: '?',
        worktree: '?',
        path: 'new file.ts',
        origPath: undefined,
        staged: false,
      },
    ]);
  });

  it('parseStatus pairs a staged rename with its original path (extra -z record)', () => {
    const z = 'R  new.ts\0old.ts\0 M other.ts\0';
    const entries = service.parseStatus(z);
    expect(entries[0]).toEqual({
      index: 'R',
      worktree: ' ',
      path: 'new.ts',
      origPath: 'old.ts',
      staged: true,
    });
    expect(entries[1].path).toBe('other.ts');
  });

  it('parseLog splits NUL-separated commits with unit-separated fields', () => {
    const rec = (h: string, s: string) =>
      [h, 'Alice', 'a@x.io', '1700000000', s].join('\x1f');
    const stdout = [
      rec('a'.repeat(40), 'first'),
      rec('b'.repeat(40), 'second'),
    ].join('\0');
    const commits = service.parseLog(stdout);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({
      hash: 'a'.repeat(40),
      authorName: 'Alice',
      authorEmail: 'a@x.io',
      subject: 'first',
    });
    expect(commits[0].date).toBe(new Date(1700000000 * 1000).toISOString());
  });
});

describe('isBinaryMissing — the git-not-in-image guard', () => {
  // Shape observed from execa v9 under plain Node ESM, i.e. production.
  it('detects the top-level ENOENT code', () => {
    expect(
      isBinaryMissing({
        code: 'ENOENT',
        failed: true,
        exitCode: undefined,
        stderr: '',
        shortMessage:
          'Command failed with ENOENT: git status\nspawn git ENOENT',
      }),
    ).toBe(true);
  });

  it('detects ENOENT nested under cause', () => {
    expect(isBinaryMissing({ failed: true, cause: { code: 'ENOENT' } })).toBe(
      true,
    );
  });

  it('detects ENOENT reported only in the message', () => {
    expect(
      isBinaryMissing({ failed: true, originalMessage: 'spawn git ENOENT' }),
    ).toBe(true);
  });

  it('does NOT fire on git’s ordinary non-zero exits', () => {
    // "nothing to commit" and friends must keep flowing through as results.
    expect(
      isBinaryMissing({
        exitCode: 1,
        failed: true,
        stdout: '',
        stderr: 'nothing to commit, working tree clean',
      }),
    ).toBe(false);
    expect(isBinaryMissing({ exitCode: 0, failed: false })).toBe(false);
    expect(isBinaryMissing(null)).toBe(false);
    expect(isBinaryMissing(undefined)).toBe(false);
  });

  it('does not mistake a file-not-found inside git output for a missing git', () => {
    // stderr is deliberately not searched: a git error mentioning ENOENT for a
    // path must not be reported as "git is not installed".
    expect(
      isBinaryMissing({
        exitCode: 128,
        failed: true,
        stderr: "fatal: could not open 'x': ENOENT",
      }),
    ).toBe(false);
  });
});

describe('GitService.exec — git present', () => {
  it('runs and reports a zero exit', async () => {
    const service = new GitService(new FilesService());
    const result = await service.exec(process.cwd(), ['--version']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^git version/);
  });
});
