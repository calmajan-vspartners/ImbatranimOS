import * as fs from 'fs/promises';
import * as os from 'os';
import { join } from 'path';

// Same mocking shape as git.exec.spec.ts: replace the real binary so we can assert
// EXACTLY what reaches execa — file, arg array, options, stdin — without depending
// on git being installed. `mock`-prefixed so the hoisted factory may reference it.
const mockExeca = jest.fn();
jest.mock('execa', () => ({
  __esModule: true,
  execa: mockExeca,
}));

import { GitService } from './git.service';
import { FilesService } from '../files/files.service';
import { DbService } from '../../db/db.service';

/**
 * A real in-memory DbService for the recent-repos table (brief 76). GitService
 * takes one now; a stub would let the recents SQL rot untested, and an in-memory
 * database costs nothing.
 */
function testDb(): DbService {
  const db = new DbService({
    get: () => ':memory:',
  } as unknown as ConstructorParameters<typeof DbService>[0]);
  db.onModuleInit();
  return db;
}

type ExecaOpts = {
  shell?: boolean;
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
  env?: Record<string, string>;
  input?: string;
};
type ExecaCall = [string, string[], ExecaOpts];
const calls = (): ExecaCall[] => mockExeca.mock.calls as ExecaCall[];
const callWith = (sub: string): ExecaCall | undefined =>
  calls().find((c) => c[1].includes(sub));

/**
 * Brief 76 added five subcommands to the allowlist. The brief's regression surface
 * names the single `exec` seam, array args, the `--` pathspec guard and the jail as
 * the things a reviewer will grep for — so each new command is asserted at the
 * level of the argument array it produces, not at the level of "it returned data".
 */
describe('GitService — brief 76 subcommands (arg arrays, no shell, guards)', () => {
  let service: GitService;
  let jail: string;
  const prevEnv = process.env.FILES_ROOT;

  beforeEach(async () => {
    jail = await fs.mkdtemp(join(os.tmpdir(), 'imb-git-76-'));
    process.env.FILES_ROOT = jail;
    mockExeca.mockReset();
    mockExeca.mockImplementation((_file: string, args: string[]) => {
      // resolveRepo's two probes must succeed, and `status` must look clean.
      if (args.includes('--show-toplevel')) {
        return Promise.resolve({ stdout: jail, stderr: '', exitCode: 0 });
      }
      if (args.includes('--is-inside-work-tree')) {
        return Promise.resolve({ stdout: 'true', stderr: '', exitCode: 0 });
      }
      if (args.includes('status')) {
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
      }
      if (args.includes('for-each-ref')) {
        return Promise.resolve({
          stdout: 'main\nfeature\n',
          stderr: '',
          exitCode: 0,
        });
      }
      if (args.includes('symbolic-ref')) {
        return Promise.resolve({ stdout: 'main', stderr: '', exitCode: 0 });
      }
      return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
    });
    service = new GitService(new FilesService(), testDb());
  });

  afterEach(async () => {
    process.env.FILES_ROOT = prevEnv;
    await fs.rm(jail, { recursive: true, force: true });
  });

  /** Applies to every command, new or old. */
  const assertNoShellAnywhere = () => {
    for (const [file, args, opts] of calls()) {
      expect(file).toBe('git');
      expect(Array.isArray(args)).toBe(true);
      expect(opts.shell).toBe(false);
      expect(opts.env?.GIT_LITERAL_PATHSPECS).toBe('1');
    }
  };

  describe('branches', () => {
    it('reads refs with for-each-ref and an explicit format, taking no input', async () => {
      const result = await service.branches('home', '');
      expect(result.branches.map((b) => b.name)).toEqual(['main', 'feature']);
      expect(result.current).toBe('main');
      expect(result.detached).toBe(false);

      const args = callWith('for-each-ref')![1];
      expect(args).toContain('--format=%(refname:short)');
      expect(args).toContain('refs/heads');
      assertNoShellAnywhere();
    });

    it('reports a detached HEAD instead of inventing a branch name', async () => {
      mockExeca.mockImplementation((_f: string, args: string[]) => {
        if (args.includes('--show-toplevel'))
          return Promise.resolve({ stdout: jail, stderr: '', exitCode: 0 });
        if (args.includes('symbolic-ref'))
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 1 });
        if (args.includes('for-each-ref'))
          return Promise.resolve({ stdout: 'main\n', stderr: '', exitCode: 0 });
        return Promise.resolve({ stdout: 'true', stderr: '', exitCode: 0 });
      });
      const result = await service.branches('home', '');
      expect(result.detached).toBe(true);
      expect(result.current).toBeNull();
    });

    it('reports a dirty tree so the UI can warn before a switch', async () => {
      mockExeca.mockImplementation((_f: string, args: string[]) => {
        if (args.includes('--show-toplevel'))
          return Promise.resolve({ stdout: jail, stderr: '', exitCode: 0 });
        if (args.includes('status'))
          return Promise.resolve({
            stdout: ' M a.txt\0',
            stderr: '',
            exitCode: 0,
          });
        if (args.includes('for-each-ref'))
          return Promise.resolve({ stdout: 'main\n', stderr: '', exitCode: 0 });
        if (args.includes('symbolic-ref'))
          return Promise.resolve({ stdout: 'main', stderr: '', exitCode: 0 });
        return Promise.resolve({ stdout: 'true', stderr: '', exitCode: 0 });
      });
      expect((await service.branches('home', '')).dirty).toBe(true);
    });
  });

  describe('branch names — the flag-injection surface `--` cannot cover', () => {
    // A ref is not a pathspec: `git switch -- <name>` is not a thing, so a name
    // beginning with `-` WOULD be read as an option. It never reaches git at all.
    const hostile = [
      '-D',
      '--upload-pack=/bin/sh',
      '--exec=/bin/sh',
      '-',
      '--',
      '.hidden',
      'a b',
      'a\tb',
      'a\nb',
      'a\0b',
      'a..b',
      'a~1',
      'a^',
      'a:b',
      'a?b',
      'a*b',
      'a[b',
      'a\\b',
      'refs/heads/@{now}',
      '@',
      'a//b',
      'a/',
      'a.',
      'a.lock',
      'feature/x.lock',
      '',
      '   ',
      'x'.repeat(256),
    ];

    it.each(hostile)(
      'refuses %j before it becomes an argument',
      async (name) => {
        await expect(service.createBranch('home', name, '')).rejects.toThrow();
        await expect(service.switchBranch('home', name, '')).rejects.toThrow();
        // The decisive assertion: git was never asked to switch anything.
        expect(callWith('switch')).toBeUndefined();
      },
    );

    const legal = [
      'main',
      'feature/x',
      'release-1.2',
      'a_b',
      'user/fix.2',
      'v1.0',
    ];
    it.each(legal)('accepts the ordinary name %j', async (name) => {
      await expect(service.switchBranch('home', name, '')).resolves.toEqual({
        current: name,
      });
      const args = callWith('switch')![1];
      // The name is the LAST element and its own array entry — never concatenated.
      expect(args[args.length - 1]).toBe(name);
    });

    it('creates with `switch --create <name>`, name as one element', async () => {
      await service.createBranch('home', 'feature/new', '');
      const args = callWith('switch')![1];
      expect(args).toContain('--create');
      expect(args[args.indexOf('--create') + 1]).toBe('feature/new');
    });

    it('surfaces git own refusal rather than pre-empting a dirty switch', async () => {
      // The considered departure from the brief: git allows carrying clean changes
      // across, and blocking that server-side would be worse than the Terminal.
      mockExeca.mockImplementation((_f: string, args: string[]) => {
        if (args.includes('--show-toplevel'))
          return Promise.resolve({ stdout: jail, stderr: '', exitCode: 0 });
        if (args.includes('switch'))
          return Promise.resolve({
            stdout: '',
            stderr: 'error: Your local changes would be overwritten',
            exitCode: 1,
          });
        return Promise.resolve({ stdout: 'true', stderr: '', exitCode: 0 });
      });
      await expect(service.switchBranch('home', 'main', '')).rejects.toThrow(
        /local changes would be overwritten/,
      );
    });
  });

  describe('discard', () => {
    it('restores the work tree only, with pathspecs after `--`', async () => {
      await service.discard('home', ['-rf', 'a.txt'], '');
      const args = callWith('restore')![1];
      expect(args).toContain('--worktree');
      expect(args).toContain('--');
      // A `-`-leading path sits after the separator, so it cannot be a flag.
      expect(args.indexOf('--')).toBeLessThan(args.indexOf('-rf'));
      // --worktree, so a deliberately staged change is not thrown away too.
      expect(args).not.toContain('--staged');
      assertNoShellAnywhere();
    });

    it('refuses an untracked file instead of silently doing nothing', async () => {
      mockExeca.mockImplementation((_f: string, args: string[]) => {
        if (args.includes('--show-toplevel'))
          return Promise.resolve({ stdout: jail, stderr: '', exitCode: 0 });
        if (args.includes('status'))
          return Promise.resolve({
            stdout: '?? new.txt\0',
            stderr: '',
            exitCode: 0,
          });
        return Promise.resolve({ stdout: 'true', stderr: '', exitCode: 0 });
      });
      await expect(service.discard('home', ['new.txt'], '')).rejects.toThrow(
        /Not tracked by git/,
      );
      // And it never ran restore on it.
      expect(callWith('restore')).toBeUndefined();
    });
  });

  describe('stash', () => {
    it('pushes with the message as one `-m` element', async () => {
      mockExeca.mockImplementation((_f: string, args: string[]) => {
        if (args.includes('--show-toplevel'))
          return Promise.resolve({ stdout: jail, stderr: '', exitCode: 0 });
        if (args.includes('stash'))
          return Promise.resolve({ stdout: 'Saved', stderr: '', exitCode: 0 });
        return Promise.resolve({ stdout: 'true', stderr: '', exitCode: 0 });
      });
      await service.stashPush('home', '; rm -rf ~', '');
      const args = callWith('stash')![1];
      expect(args[args.indexOf('-m') + 1]).toBe('; rm -rf ~');
    });

    it('says so rather than pretending, when there is nothing to stash', async () => {
      mockExeca.mockImplementation((_f: string, args: string[]) => {
        if (args.includes('--show-toplevel'))
          return Promise.resolve({ stdout: jail, stderr: '', exitCode: 0 });
        if (args.includes('stash'))
          return Promise.resolve({
            stdout: 'No local changes to save',
            stderr: '',
            exitCode: 0,
          });
        return Promise.resolve({ stdout: 'true', stderr: '', exitCode: 0 });
      });
      await expect(service.stashPush('home', undefined, '')).rejects.toThrow(
        /nothing to stash/i,
      );
    });

    it('builds `stash@{n}` from a validated integer, never from client text', async () => {
      await service.stashPop('home', 2, '');
      const args = callWith('stash')![1];
      expect(args).toContain('stash@{2}');
    });

    it('refuses an out-of-range index', async () => {
      await expect(service.stashPop('home', -1, '')).rejects.toThrow();
      await expect(service.stashPop('home', 100000, '')).rejects.toThrow();
    });

    it('pops the top when no index is given', async () => {
      await service.stashPop('home', undefined, '');
      const args = callWith('stash')![1];
      expect(args).toContain('pop');
      expect(args.some((a) => a.startsWith('stash@{'))).toBe(false);
    });
  });

  describe('amend', () => {
    it('passes --amend with the message as one element', async () => {
      await service.amend('home', 'fixed `it`; rm -rf ~', '');
      const args = callWith('commit')![1];
      expect(args).toContain('--amend');
      expect(args[args.indexOf('-m') + 1]).toBe('fixed `it`; rm -rf ~');
    });

    it('refuses an empty message', async () => {
      await expect(service.amend('home', '   ', '')).rejects.toThrow(
        /message required/i,
      );
    });
  });

  describe('applyPatch — per-hunk staging', () => {
    const PATCH = [
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '-hello',
      '+goodbye',
      '',
    ].join('\n');

    it('sends the patch on STDIN, never as an argument', async () => {
      await service.applyPatch('home', PATCH, false, '');
      const call = callWith('apply')!;
      expect(call[2].input).toBe(PATCH);
      // The patch text appears nowhere in the argument array.
      expect(call[1].some((a) => a.includes('goodbye'))).toBe(false);
      // `-` tells git to read the patch from stdin.
      expect(call[1]).toContain('-');
    });

    it('applies to the index only and NEVER passes --unsafe-paths', async () => {
      // Measured against git 2.43: without --unsafe-paths a patch naming
      // `../outside.txt` is refused ("does not exist in index") and one naming
      // `../../etc/x` is refused ("invalid path"). Git's default is the jail, so
      // the flag's absence is the security property — assert it explicitly.
      await service.applyPatch('home', PATCH, false, '');
      const args = callWith('apply')![1];
      expect(args).toContain('--cached');
      expect(args).not.toContain('--unsafe-paths');
      expect(args).not.toContain('--directory');
      expect(args).not.toContain('--3way');
      assertNoShellAnywhere();
    });

    it('unstages by applying the same hunk in reverse', async () => {
      await service.applyPatch('home', PATCH, true, '');
      expect(callWith('apply')![1]).toContain('--reverse');
    });

    it('does not pass --reverse when staging', async () => {
      await service.applyPatch('home', PATCH, false, '');
      expect(callWith('apply')![1]).not.toContain('--reverse');
    });

    it('rejects junk before it reaches git', async () => {
      for (const bad of [
        '',
        '   ',
        'not a patch at all',
        'diff\0--git a/x b/x',
      ]) {
        await expect(
          service.applyPatch('home', bad, false, ''),
        ).rejects.toThrow();
      }
      expect(callWith('apply')).toBeUndefined();
    });

    it('rejects an oversized patch', async () => {
      const huge = `--- a/x\n+++ b/x\n@@ -1 +1 @@\n+${'x'.repeat(1024 * 1024 + 10)}`;
      await expect(service.applyPatch('home', huge, false, '')).rejects.toThrow(
        /too large/i,
      );
      expect(callWith('apply')).toBeUndefined();
    });

    it('explains a stale hunk instead of leaking a raw git error', async () => {
      mockExeca.mockImplementation((_f: string, args: string[]) => {
        if (args.includes('--show-toplevel'))
          return Promise.resolve({ stdout: jail, stderr: '', exitCode: 0 });
        if (args.includes('apply'))
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 1 });
        return Promise.resolve({ stdout: 'true', stderr: '', exitCode: 0 });
      });
      await expect(
        service.applyPatch('home', PATCH, false, ''),
      ).rejects.toThrow(/no longer applies/i);
    });
  });

  describe('the jail still holds for every new command', () => {
    it('refuses a repo path escaping the root', async () => {
      for (const op of [
        () => service.branches('home', '../..'),
        () => service.createBranch('home', 'x', '../..'),
        () => service.switchBranch('home', 'x', '../..'),
        () => service.discard('home', ['a'], '../..'),
        () => service.stashPush('home', undefined, '../..'),
        () => service.stashPop('home', undefined, '../..'),
        () => service.amend('home', 'x', '../..'),
        () =>
          service.applyPatch(
            'home',
            '--- a/x\n+++ b/x\n@@ -1 +1 @@\n+y',
            false,
            '../..',
          ),
      ]) {
        await expect(op()).rejects.toThrow();
      }
    });

    it('refuses a work tree whose top-level is above the jail', async () => {
      // The ancestor-`.git` case closed in brief 42, re-asserted for the new
      // commands: git discovers a repo by walking UP, so a `.git` above the root
      // would otherwise let these operate on files outside it.
      mockExeca.mockImplementation((_f: string, args: string[]) => {
        if (args.includes('--show-toplevel'))
          return Promise.resolve({ stdout: '/', stderr: '', exitCode: 0 });
        return Promise.resolve({ stdout: 'true', stderr: '', exitCode: 0 });
      });
      await expect(service.branches('home', '')).rejects.toThrow(
        /outside the allowed root/,
      );
      await expect(service.switchBranch('home', 'main', '')).rejects.toThrow(
        /outside the allowed root/,
      );
    });
  });
});
