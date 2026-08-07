import * as fs from 'fs/promises';
import * as os from 'os';
import { join } from 'path';

// Same stand-in as git.service.spec.ts: REAL git runs via execFile; only the ESM
// module Jest cannot parse is swapped out. Nothing under test is simulated.
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
        input?: string;
      } = {},
    ) =>
      new Promise((resolve) => {
        const child = execFile(
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
        // execa's `input` option, reproduced: the patch reaches git on stdin.
        if (opts.input !== undefined) child.stdin?.end(opts.input);
      }),
  };
});

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

/**
 * Brief 76's new commands against REAL git in a REAL jailed repo.
 *
 * The mocked spec (`git.brief76.spec.ts`) proves the argument arrays; this one
 * proves the behaviour those arrays actually produce — that a branch is really
 * created, that discard really restores, and above all that `git apply --cached`
 * stages **one hunk of a two-hunk file** and leaves the working tree alone. That
 * last one cannot be established by asserting flags.
 */
describe('Brief 76 against real git', () => {
  let service: GitService;
  let jail: string;
  const repoRel = 'repo';
  const prevEnv = process.env.FILES_ROOT;
  const repoAbs = () => join(jail, repoRel);
  const read = (name: string) => fs.readFile(join(repoAbs(), name), 'utf8');

  beforeEach(async () => {
    jail = await fs.mkdtemp(join(os.tmpdir(), 'imb-git76-'));
    process.env.FILES_ROOT = jail;
    service = new GitService(new FilesService(), testDb());
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

  async function commitFile(name: string, content: string, message: string) {
    await fs.writeFile(join(repoAbs(), name), content);
    await service.exec(repoAbs(), ['add', '--', name]);
    await service.exec(repoAbs(), ['commit', '-q', '-m', message]);
  }

  describe('branches', () => {
    it('lists, creates and switches for real', async () => {
      await commitFile('a.txt', 'one\n', 'init');

      expect((await service.branches('home', repoRel)).current).toBe('main');

      await service.createBranch('home', 'feature/x', repoRel);
      let state = await service.branches('home', repoRel);
      expect(state.current).toBe('feature/x');
      expect(state.branches.map((b) => b.name).sort()).toEqual([
        'feature/x',
        'main',
      ]);
      expect(state.branches.find((b) => b.name === 'feature/x')?.current).toBe(
        true,
      );

      await service.switchBranch('home', 'main', repoRel);
      state = await service.branches('home', repoRel);
      expect(state.current).toBe('main');
      expect(state.dirty).toBe(false);
    });

    it('refuses to create a branch that already exists, with git own words', async () => {
      await commitFile('a.txt', 'one\n', 'init');
      await service.createBranch('home', 'dup', repoRel);
      await service.switchBranch('home', 'main', repoRel);
      await expect(
        service.createBranch('home', 'dup', repoRel),
      ).rejects.toThrow(/already exists/i);
    });

    it('reports a dirty tree', async () => {
      await commitFile('a.txt', 'one\n', 'init');
      await fs.writeFile(join(repoAbs(), 'a.txt'), 'changed\n');
      expect((await service.branches('home', repoRel)).dirty).toBe(true);
    });
  });

  describe('discard', () => {
    it('restores a wrecked file from HEAD and leaves a staged change alone', async () => {
      await commitFile('a.txt', 'original\n', 'init');
      await commitFile('b.txt', 'b-original\n', 'add b');

      // b.txt is deliberately staged; a.txt is merely wrecked.
      await fs.writeFile(join(repoAbs(), 'b.txt'), 'b-staged\n');
      await service.stage('home', ['b.txt'], repoRel);
      await fs.writeFile(join(repoAbs(), 'a.txt'), 'WRECKED\n');

      await service.discard('home', ['a.txt'], repoRel);

      expect(await read('a.txt')).toBe('original\n');
      // --worktree, so the staged b.txt survives untouched.
      expect(await read('b.txt')).toBe('b-staged\n');
      const { entries } = await service.status('home', repoRel);
      expect(entries.find((e) => e.path === 'b.txt')?.staged).toBe(true);
    });

    it('refuses an untracked file rather than doing nothing', async () => {
      await commitFile('a.txt', 'one\n', 'init');
      await fs.writeFile(join(repoAbs(), 'new.txt'), 'hi\n');
      await expect(
        service.discard('home', ['new.txt'], repoRel),
      ).rejects.toThrow(/Not tracked by git/);
      // And the file is still there — a refusal, not a silent delete.
      expect(await read('new.txt')).toBe('hi\n');
    });
  });

  describe('stash', () => {
    it('stashes, lists and pops for real', async () => {
      await commitFile('a.txt', 'one\n', 'init');
      await fs.writeFile(join(repoAbs(), 'a.txt'), 'work in progress\n');

      await service.stashPush('home', 'wip', repoRel);
      expect(await read('a.txt')).toBe('one\n');

      const { stashes } = await service.stashList('home', repoRel);
      expect(stashes).toHaveLength(1);
      expect(stashes[0].label).toContain('wip');

      await service.stashPop('home', undefined, repoRel);
      expect(await read('a.txt')).toBe('work in progress\n');
      expect((await service.stashList('home', repoRel)).stashes).toHaveLength(
        0,
      );
    });

    it('refuses when there is nothing to stash', async () => {
      await commitFile('a.txt', 'one\n', 'init');
      await expect(
        service.stashPush('home', undefined, repoRel),
      ).rejects.toThrow(/nothing to stash/i);
    });
  });

  describe('amend', () => {
    it('replaces the last commit instead of adding one', async () => {
      await commitFile('a.txt', 'one\n', 'first');
      await commitFile('b.txt', 'two\n', 'typpo');
      const before = await service.log('home', repoRel);
      expect(before.commits).toHaveLength(2);

      expect((await service.lastCommitMessage('home', repoRel)).message).toBe(
        'typpo',
      );
      await service.amend('home', 'typo fixed', repoRel);

      const after = await service.log('home', repoRel);
      expect(after.commits).toHaveLength(2);
      expect(after.commits[0].subject).toBe('typo fixed');
      // A real amend rewrites the commit, so the hash changes.
      expect(after.commits[0].hash).not.toBe(before.commits[0].hash);
    });
  });

  describe('per-hunk staging — the thing flags cannot prove', () => {
    /** A file with two well-separated hunks. */
    const ORIGINAL =
      Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    const EDITED = ORIGINAL.replace('line 2', 'CHANGED TOP').replace(
      'line 19',
      'CHANGED BOTTOM',
    );

    it('stages ONE hunk of two, leaving the other unstaged and the file intact', async () => {
      await commitFile('f.txt', ORIGINAL, 'init');
      await fs.writeFile(join(repoAbs(), 'f.txt'), EDITED);

      const { diff } = await service.diff('home', repoRel, false, 'f.txt');
      const lines = diff.split('\n');
      const header = lines.slice(
        0,
        lines.findIndex((l) => l.startsWith('@@')),
      );
      const hunkStarts = lines
        .map((l, i) => (l.startsWith('@@') ? i : -1))
        .filter((i) => i >= 0);
      expect(hunkStarts.length).toBe(2);

      // Take only the FIRST hunk, exactly as the UI's per-hunk control does.
      const firstHunk = lines.slice(hunkStarts[0], hunkStarts[1]);
      const patch = [...header, ...firstHunk, ''].join('\n');

      await service.applyPatch('home', patch, false, repoRel);

      // The index has the top change and NOT the bottom one.
      const staged = await service.diff('home', repoRel, true, 'f.txt');
      expect(staged.diff).toContain('CHANGED TOP');
      expect(staged.diff).not.toContain('CHANGED BOTTOM');

      // The remaining unstaged diff has the bottom change and not the top.
      const unstaged = await service.diff('home', repoRel, false, 'f.txt');
      expect(unstaged.diff).toContain('CHANGED BOTTOM');
      expect(unstaged.diff).not.toContain('CHANGED TOP');

      // --cached: the working tree still holds BOTH edits, untouched.
      expect(await read('f.txt')).toBe(EDITED);
    });

    it('unstages that same hunk again with --reverse', async () => {
      await commitFile('f.txt', ORIGINAL, 'init');
      await fs.writeFile(join(repoAbs(), 'f.txt'), EDITED);
      const { diff } = await service.diff('home', repoRel, false, 'f.txt');
      const lines = diff.split('\n');
      const at = lines
        .map((l, i) => (l.startsWith('@@') ? i : -1))
        .filter((i) => i >= 0);
      const patch = [
        ...lines.slice(0, at[0]),
        ...lines.slice(at[0], at[1]),
        '',
      ].join('\n');

      await service.applyPatch('home', patch, false, repoRel);
      expect(
        (await service.diff('home', repoRel, true, 'f.txt')).diff,
      ).toContain('CHANGED TOP');

      await service.applyPatch('home', patch, true, repoRel);
      // Nothing staged any more, and the file is still fully edited.
      expect((await service.diff('home', repoRel, true, 'f.txt')).diff).toBe(
        '',
      );
      expect(await read('f.txt')).toBe(EDITED);
    });

    it('commits ONLY the staged hunk', async () => {
      await commitFile('f.txt', ORIGINAL, 'init');
      await fs.writeFile(join(repoAbs(), 'f.txt'), EDITED);
      const { diff } = await service.diff('home', repoRel, false, 'f.txt');
      const lines = diff.split('\n');
      const at = lines
        .map((l, i) => (l.startsWith('@@') ? i : -1))
        .filter((i) => i >= 0);
      const patch = [
        ...lines.slice(0, at[0]),
        ...lines.slice(at[0], at[1]),
        '',
      ].join('\n');
      await service.applyPatch('home', patch, false, repoRel);

      await service.commit('home', 'only the top change', repoRel);

      // HEAD has the top change; the bottom one is still a pending edit.
      const head = await service.exec(repoAbs(), ['show', 'HEAD:f.txt']);
      expect(head.stdout).toContain('CHANGED TOP');
      expect(head.stdout).not.toContain('CHANGED BOTTOM');
      expect((await service.status('home', repoRel)).entries).toHaveLength(1);
    });

    it('CANNOT write outside the work tree, however the patch is crafted', async () => {
      // The security property the brief's review demands. Measured, not asserted
      // from documentation: a patch that tries to reach a sibling of the repo, and
      // one that tries an absolute-ish escape, must both fail AND leave the target
      // untouched.
      await commitFile('a.txt', 'one\n', 'init');
      const victim = join(jail, 'outside.txt');
      await fs.writeFile(victim, 'SECRET\n');

      const traversal = [
        'diff --git a/../outside.txt b/../outside.txt',
        '--- a/../outside.txt',
        '+++ b/../outside.txt',
        '@@ -1 +1 @@',
        '-SECRET',
        '+PWNED',
        '',
      ].join('\n');
      await expect(
        service.applyPatch('home', traversal, false, repoRel),
      ).rejects.toThrow();

      const creation = [
        'diff --git a/x b/../../tmp/imb-pwned-76',
        '--- /dev/null',
        '+++ b/../../tmp/imb-pwned-76',
        '@@ -0,0 +1 @@',
        '+pwned',
        '',
      ].join('\n');
      await expect(
        service.applyPatch('home', creation, false, repoRel),
      ).rejects.toThrow();

      // The decisive check: the file outside the repo is exactly as it was.
      expect(await fs.readFile(victim, 'utf8')).toBe('SECRET\n');
      await expect(fs.stat('/tmp/imb-pwned-76')).rejects.toThrow();
    });
  });

  describe('recent repos', () => {
    it('records a repo once, newest first, and forgets it again', async () => {
      await commitFile('a.txt', 'one\n', 'init');
      const other = join(jail, 'repo2');
      await fs.mkdir(other);
      await service.exec(other, ['init', '-q', '-b', 'main']);

      await service.rememberRepo('home', repoRel);
      await service.rememberRepo('home', 'repo2');
      // Opening the first again must move it, not duplicate it.
      await service.rememberRepo('home', repoRel);

      const { repos } = await service.recentRepos();
      expect(repos.map((r) => r.path)).toEqual([repoRel, 'repo2']);

      service.forgetRepo('home', 'repo2');
      expect((await service.recentRepos()).repos.map((r) => r.path)).toEqual([
        repoRel,
      ]);
    });

    it('refuses to remember something outside the jail or not a repo', async () => {
      await expect(service.rememberRepo('home', '../..')).rejects.toThrow();
      await fs.mkdir(join(jail, 'plain'));
      await expect(service.rememberRepo('home', 'plain')).rejects.toThrow(
        /Not a git work tree/,
      );
      expect((await service.recentRepos()).repos).toEqual([]);
    });

    it('drops an entry whose directory has since been deleted', async () => {
      await commitFile('a.txt', 'one\n', 'init');
      await service.rememberRepo('home', repoRel);
      await fs.rm(repoAbs(), { recursive: true, force: true });
      // A stale row must vanish from the list rather than 404 when clicked.
      expect((await service.recentRepos()).repos).toEqual([]);
    });
  });

  // Brief 114: one file's contents at HEAD, for Git GUI's Compare with HEAD.
  describe('showAtHead against real git', () => {
    it('returns the COMMITTED text, not the working copy', async () => {
      await commitFile('a.txt', 'committed\n', 'init');
      await fs.writeFile(join(repoAbs(), 'a.txt'), 'working\n');

      const res = await service.showAtHead('home', repoRel, 'a.txt');
      expect(res).toEqual({ content: 'committed\n', exists: true });
      // And the working tree is untouched by having asked.
      expect(await read('a.txt')).toBe('working\n');
    });

    it('reads a file in a subdirectory by its repo-relative path', async () => {
      await fs.mkdir(join(repoAbs(), 'src'));
      await commitFile('src/deep.txt', 'nested\n', 'init');
      const res = await service.showAtHead('home', repoRel, 'src/deep.txt');
      expect(res).toEqual({ content: 'nested\n', exists: true });
    });

    it('reports a file that is not in HEAD as new rather than failing', async () => {
      await commitFile('a.txt', 'one\n', 'init');
      await fs.writeFile(join(repoAbs(), 'brand-new.txt'), 'fresh\n');
      // Staged but never committed — the exact state a "new file" row is in.
      await service.stage('home', ['brand-new.txt'], repoRel);

      expect(
        await service.showAtHead('home', repoRel, 'brand-new.txt'),
      ).toEqual({
        content: '',
        exists: false,
      });
    });

    it('refuses a path that tries to leave the repository', async () => {
      await commitFile('a.txt', 'one\n', 'init');
      await expect(
        service.showAtHead('home', repoRel, '../outside.txt'),
      ).rejects.toThrow(/must not leave/i);
      await expect(
        service.showAtHead('home', repoRel, 'src/../../outside.txt'),
      ).rejects.toThrow(/must not leave/i);
    });

    it('refuses an absolute path and a leading dash', async () => {
      await commitFile('a.txt', 'one\n', 'init');
      await expect(
        service.showAtHead('home', repoRel, '/etc/passwd'),
      ).rejects.toThrow(/relative to the repository/i);
      // A leading '-' could otherwise be read as a flag by some git version.
      await expect(
        service.showAtHead('home', repoRel, '--help'),
      ).rejects.toThrow(/invalid path/i);
    });

    it('keeps a path full of shell metacharacters literal', async () => {
      const nasty = '$(touch imb-pwned-show)`id`;.txt';
      await commitFile(nasty, 'safe\n', 'init');
      const res = await service.showAtHead('home', repoRel, nasty);
      expect(res.content).toBe('safe\n');
      await expect(
        fs.stat(join(repoAbs(), 'imb-pwned-show')),
      ).rejects.toThrow();
    });
  });

  describe('a commit message full of shell metacharacters is still literal', () => {
    it('stores it verbatim through amend, the newest message path', async () => {
      await commitFile('a.txt', 'one\n', 'init');
      const nasty = '$(touch /tmp/imb-pwned-amend) && `id` ; rm -rf ~';
      await service.amend('home', nasty, repoRel);
      const { commits } = await service.log('home', repoRel);
      expect(commits[0].subject).toBe(nasty);
      await expect(fs.stat('/tmp/imb-pwned-amend')).rejects.toThrow();
    });

    it('stores it verbatim through a stash message', async () => {
      await commitFile('a.txt', 'one\n', 'init');
      await fs.writeFile(join(repoAbs(), 'a.txt'), 'wip\n');
      const nasty = '$(touch /tmp/imb-pwned-stash)';
      await service.stashPush('home', nasty, repoRel);
      const { stashes } = await service.stashList('home', repoRel);
      expect(stashes[0].label).toContain(nasty);
      await expect(fs.stat('/tmp/imb-pwned-stash')).rejects.toThrow();
    });
  });
});
