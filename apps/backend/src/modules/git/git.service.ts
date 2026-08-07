import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  RequestTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as fs from 'fs/promises';
import { sep } from 'path';
import { FilesService } from '../files/files.service';
import { DbService } from '../../db/db.service';

// execa ships pure ESM; import it lazily (dynamic import) so this module still
// loads under ts-jest's CommonJS transform in unit tests. Same idiom as
// SystemService.
type ExecaFn = typeof import('execa').execa;
let execaFn: ExecaFn | null = null;
async function getExeca(): Promise<ExecaFn> {
  if (!execaFn) {
    ({ execa: execaFn } = await import('execa'));
  }
  return execaFn;
}

/** Per-call wall-clock cap so a wedged git can't hang a request. */
const GIT_TIMEOUT_MS = Number(process.env.GIT_TIMEOUT_MS) || 15_000;
/** Output cap (bytes) so a huge diff/log can't OOM the process. */
const GIT_MAX_BUFFER = Number(process.env.GIT_MAX_BUFFER) || 10 * 1024 * 1024;
/** How many commits `log` returns by default / at most. */
const DEFAULT_LOG_LIMIT = 50;
const MAX_LOG_LIMIT = 500;
/**
 * Cap on a patch fed to `git apply --cached`. One hunk plus its file headers, with
 * very generous room — far below the 10 MB output cap, because this direction is
 * client-supplied and should be the tighter of the two.
 */
const MAX_PATCH_BYTES = 1024 * 1024;
/** How many repos the recents list keeps. The UI shows a short menu, not a history. */
const MAX_RECENT_REPOS = 10;

/**
 * Environment forced onto every git invocation:
 *  - GIT_TERMINAL_PROMPT=0  — never block waiting on a credential prompt.
 *  - GIT_LITERAL_PATHSPECS=1 — a pathspec is ALWAYS a literal path, so magic
 *    like `:(exclude)` / `:/` can't broaden the operation beyond the given path.
 *  - GIT_OPTIONAL_LOCKS=0   — don't take optional locks for read commands.
 */
const GIT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_LITERAL_PATHSPECS: '1',
  GIT_OPTIONAL_LOCKS: '0',
} as const;

export interface GitStatusEntry {
  /** Index (staged) status char, e.g. 'M', 'A', 'D', 'R', '?', ' '. */
  index: string;
  /** Work-tree (unstaged) status char. */
  worktree: string;
  /** Current path (the new name for a rename). */
  path: string;
  /** Original path for a rename/copy, if any. */
  origPath?: string;
  /** True when the index side shows a staged change (not '?'/'!'/' '). */
  staged: boolean;
}

export interface GitCommit {
  hash: string;
  authorName: string;
  authorEmail: string;
  date: string;
  subject: string;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const FIELD_SEP = '\x1f'; // unit separator — between log fields
const RECORD_SEP = '\0'; // NUL — between records (status entries / commits)

/**
 * True when a spawn failed because the binary itself is not on PATH.
 *
 * We run execa with `reject: false` so git's benign non-zero exits (e.g.
 * "nothing to commit") come back as results. That also swallows a missing
 * binary: the result carries no exitCode and an empty stderr, which the
 * mapping below would flatten to `exitCode: 1` with no message — every Git
 * operation failing with nothing to show the user. That is precisely how the
 * shipped image behaved, since its prod stage installed no git.
 *
 * execa reports this as `code: 'ENOENT'`, but the property has moved between
 * versions and is nested under `cause` in some module/interop combinations, so
 * check the shapes rather than pin one.
 */
export function isBinaryMissing(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) return false;
  const r = result as {
    code?: unknown;
    cause?: { code?: unknown };
    originalMessage?: unknown;
    shortMessage?: unknown;
  };
  if (r.code === 'ENOENT') return true;
  if (r.cause?.code === 'ENOENT') return true;
  const original =
    typeof r.originalMessage === 'string' ? r.originalMessage : '';
  const short = typeof r.shortMessage === 'string' ? r.shortMessage : '';
  return /\bENOENT\b/.test(`${original} ${short}`);
}

/**
 * True when execa aborted the call because output passed `maxBuffer`.
 *
 * Brief 76 item 7: a big `diff` hits the 10 MB cap, and with `reject: false` that
 * arrives as a *result* whose stdout is truncated or empty — indistinguishable from
 * "no changes" unless it is detected here. The user then sees an empty diff pane and
 * concludes the app is broken. Shape-checked rather than pinned to one property,
 * for the same reason as {@link isBinaryMissing}.
 */
export function isTooBig(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) return false;
  const r = result as {
    isMaxBuffer?: unknown;
    shortMessage?: unknown;
    originalMessage?: unknown;
  };
  if (r.isMaxBuffer === true) return true;
  const text = `${typeof r.shortMessage === 'string' ? r.shortMessage : ''} ${
    typeof r.originalMessage === 'string' ? r.originalMessage : ''
  }`;
  return /maxBuffer|ENOBUFS/i.test(text);
}

/** True when the call was killed by the wall-clock cap rather than exiting. */
export function isTimeout(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) return false;
  const r = result as { timedOut?: unknown; shortMessage?: unknown };
  if (r.timedOut === true) return true;
  return /timed out/i.test(
    typeof r.shortMessage === 'string' ? r.shortMessage : '',
  );
}

@Injectable()
export class GitService {
  constructor(
    private readonly filesService: FilesService,
    private readonly db: DbService,
  ) {}

  // ---------------------------------------------------------------------------
  // execa seam — THE ONLY place a git process is spawned.
  //
  // Always: file 'git', an explicit string[] of args (never a command string),
  // no `shell`, a fixed cwd, bounded time + output. This shape is what makes
  // command injection structurally impossible: nothing the client sends is ever
  // interpreted by a shell. Kept public so tests can assert the arg array.
  // ---------------------------------------------------------------------------
  async exec(
    cwd: string,
    args: string[],
    /**
     * Optional stdin. Added by brief 76 for `git apply --cached`, which is how
     * every GUI stages a single hunk. It is stdin precisely so a patch — the one
     * piece of large, structured, client-supplied text this module handles —
     * never becomes an argument, a temp file, or anything a shell could see.
     */
    input?: string,
  ): Promise<ExecResult> {
    const execa = await getExeca();
    const result = await execa('git', args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      env: GIT_ENV,
      extendEnv: true,
      // Handle non-zero exits ourselves (git uses them for benign states like
      // "nothing to commit") instead of throwing.
      reject: false,
      // Never a shell — array args only.
      shell: false,
      ...(input === undefined ? {} : { input }),
    });
    if (isBinaryMissing(result)) {
      throw new ServiceUnavailableException(
        'git is not available in this image — the Git app cannot run',
      );
    }
    if (isTooBig(result)) {
      throw new PayloadTooLargeException(
        'That output is too large for the Git app to show — use the Terminal for this one',
      );
    }
    if (isTimeout(result)) {
      throw new RequestTimeoutException(
        `git took longer than ${Math.round(GIT_TIMEOUT_MS / 1000)}s and was stopped`,
      );
    }
    return {
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
      exitCode: typeof result.exitCode === 'number' ? result.exitCode : 1,
    };
  }

  /**
   * Top-level git args shared by every command: no pager and no colour, so git
   * never blocks on a pager and output is clean text to parse. The subcommand
   * (from the fixed allowlist at each call site) and its args follow.
   */
  private git(subcommand: string, ...rest: string[]): string[] {
    return [
      '-c',
      'core.pager=cat',
      '-c',
      'color.ui=never',
      '--no-pager',
      subcommand,
      ...rest,
    ];
  }

  /**
   * Resolve a {root, path} pair to a jailed absolute directory and confirm it
   * is a git work-tree. The directory comes exclusively from
   * `FilesService.resolveSafe` (percent-decode, NUL reject, lexical + symlink
   * containment) — never a client absolute path. Non-repo / missing dir → 404.
   */
  async resolveRepo(root: string, path?: string): Promise<string> {
    const { rootDir, abs } = await this.filesService.resolveSafe(
      root,
      path ?? '',
    );

    const stat = await fs.stat(abs).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      throw new NotFoundException('Repository directory not found');
    }

    const res = await this.exec(
      abs,
      this.git('rev-parse', '--is-inside-work-tree'),
    );
    if (res.exitCode !== 0 || res.stdout.trim() !== 'true') {
      throw new NotFoundException('Not a git work tree');
    }

    // Git discovers a repo by walking UP the tree, so a `.git` above the jail
    // root would make this dir "inside a work tree" whose top-level sits above
    // the jail — status/log/diff could then read files above the root. Require
    // the repo top-level to be within the jail root (realpath-compared, so a
    // symlinked root can't spoof containment).
    const top = await this.exec(abs, this.git('rev-parse', '--show-toplevel'));
    if (top.exitCode === 0 && top.stdout.trim()) {
      const realTop = await fs.realpath(top.stdout.trim()).catch(() => null);
      const realRoot = await fs.realpath(rootDir).catch(() => rootDir);
      if (
        !realTop ||
        (realTop !== realRoot && !realTop.startsWith(realRoot + sep))
      ) {
        throw new NotFoundException(
          'Repository top-level is outside the allowed root',
        );
      }
    }
    return abs;
  }

  async status(
    root: string,
    path?: string,
  ): Promise<{ entries: GitStatusEntry[] }> {
    const cwd = await this.resolveRepo(root, path);
    const res = await this.exec(
      cwd,
      this.git('status', '--porcelain=v1', '-z', '--untracked-files=all'),
    );
    if (res.exitCode !== 0) {
      throw new BadRequestException(res.stderr.trim() || 'git status failed');
    }
    return { entries: this.parseStatus(res.stdout) };
  }

  async log(
    root: string,
    path?: string,
    limit?: number,
  ): Promise<{ commits: GitCommit[] }> {
    const cwd = await this.resolveRepo(root, path);
    const n = Math.min(
      Math.max(Math.trunc(limit ?? DEFAULT_LOG_LIMIT), 1),
      MAX_LOG_LIMIT,
    );
    const format = ['%H', '%an', '%ae', '%at', '%s'].join(FIELD_SEP);
    const res = await this.exec(
      cwd,
      this.git('log', '-z', `--max-count=${n}`, `--pretty=format:${format}`),
    );
    // A repo with no commits yet exits non-zero ("does not have any commits") —
    // that is an empty history, not an error.
    if (res.exitCode !== 0) {
      return { commits: [] };
    }
    return { commits: this.parseLog(res.stdout) };
  }

  async diff(
    root: string,
    path?: string,
    staged?: boolean,
    file?: string,
  ): Promise<{ diff: string }> {
    const cwd = await this.resolveRepo(root, path);
    const rest: string[] = [];
    if (staged) rest.push('--staged');
    // `--` separates options from pathspecs so a `file` beginning with '-'
    // can never be read as a flag.
    rest.push('--');
    if (file) {
      this.assertPathspec(file);
      rest.push(file);
    }
    const res = await this.exec(cwd, this.git('diff', ...rest));
    if (res.exitCode !== 0) {
      throw new BadRequestException(res.stderr.trim() || 'git diff failed');
    }
    return { diff: res.stdout };
  }

  async stage(
    root: string,
    paths: string[],
    path?: string,
  ): Promise<{ entries: GitStatusEntry[] }> {
    const cwd = await this.resolveRepo(root, path);
    this.assertPaths(paths);
    const res = await this.exec(cwd, this.git('add', '--', ...paths));
    if (res.exitCode !== 0) {
      throw new BadRequestException(res.stderr.trim() || 'git add failed');
    }
    return this.status(root, path);
  }

  async unstage(
    root: string,
    paths: string[],
    path?: string,
  ): Promise<{ entries: GitStatusEntry[] }> {
    const cwd = await this.resolveRepo(root, path);
    this.assertPaths(paths);
    // `reset -- <paths>` unstages by resetting the index entries to HEAD; works
    // on an unborn HEAD (initial commit) too.
    const res = await this.exec(cwd, this.git('reset', '--', ...paths));
    if (res.exitCode !== 0) {
      throw new BadRequestException(res.stderr.trim() || 'git reset failed');
    }
    return this.status(root, path);
  }

  async commit(
    root: string,
    message: string,
    path?: string,
  ): Promise<{ output: string }> {
    const cwd = await this.resolveRepo(root, path);
    const msg = message.trim();
    if (!msg) {
      throw new BadRequestException('Commit message required');
    }
    // `-m <msg>` — the message is a single array element; even a value like
    // `"; rm -rf ~"` is just literal commit text, never shell input.
    const res = await this.exec(cwd, this.git('commit', '-m', msg));
    if (res.exitCode !== 0) {
      throw new BadRequestException(
        res.stderr.trim() || res.stdout.trim() || 'git commit failed',
      );
    }
    return { output: res.stdout.trim() };
  }

  // ---------------------------------------------------------------------------
  // Brief 76 — each new subcommand is added to the allowlist deliberately, goes
  // through `this.git(...)` and the one `exec` seam, takes array args only, and
  // has a test asserting the exact array it produces.
  // ---------------------------------------------------------------------------

  /**
   * Branches, plus whether the tree is dirty.
   *
   * `for-each-ref` rather than `branch --list`: it takes an explicit `--format`,
   * so the output is parseable without depending on `branch`'s presentation (the
   * `* ` marker, column alignment, HEAD-detached wording), and it takes no user
   * input at all — the only argument is a literal.
   *
   * `dirty` rides along because the UI needs it to warn **before** a switch, which
   * is where the brief's "dirty-tree guard" belongs. See {@link switchBranch} for
   * why the block is not enforced server-side.
   */
  async branches(
    root: string,
    path?: string,
  ): Promise<{
    branches: { name: string; current: boolean }[];
    current: string | null;
    detached: boolean;
    dirty: boolean;
  }> {
    const cwd = await this.resolveRepo(root, path);
    const res = await this.exec(
      cwd,
      this.git(
        'for-each-ref',
        '--format=%(refname:short)',
        '--sort=refname',
        'refs/heads',
      ),
    );
    if (res.exitCode !== 0) {
      throw new BadRequestException(res.stderr.trim() || 'git branch failed');
    }
    const names = res.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '');

    // `--quiet` so a detached HEAD is an exit code rather than an error on stderr.
    const head = await this.exec(
      cwd,
      this.git('symbolic-ref', '--quiet', '--short', 'HEAD'),
    );
    const current = head.exitCode === 0 ? head.stdout.trim() : null;

    const status = await this.exec(
      cwd,
      this.git('status', '--porcelain=v1', '-z', '--untracked-files=no'),
    );
    return {
      branches: names.map((name) => ({ name, current: name === current })),
      current,
      detached: current === null,
      dirty: status.stdout.length > 0,
    };
  }

  /** Create a branch at HEAD and switch to it. */
  async createBranch(
    root: string,
    name: string,
    path?: string,
  ): Promise<{ current: string }> {
    const cwd = await this.resolveRepo(root, path);
    this.assertRefName(name);
    const res = await this.exec(cwd, this.git('switch', '--create', name));
    if (res.exitCode !== 0) {
      throw new BadRequestException(
        res.stderr.trim() || res.stdout.trim() || 'git switch --create failed',
      );
    }
    return { current: name };
  }

  /**
   * Switch to an existing branch.
   *
   * **Deliberately no server-side dirty-tree block**, which is a considered
   * departure from the brief's wording. Git already refuses a switch that would
   * *overwrite* local changes, and it deliberately allows one that carries clean
   * changes across — that second case is a normal, safe, extremely common
   * workflow, and blocking it here would make the app worse than the Terminal it
   * is meant to save you from. So: the warning lives in the UI (which gets
   * `dirty` from {@link branches} and confirms, naming the files at risk), and
   * git's own refusal is surfaced verbatim rather than pre-empted by a guess.
   */
  async switchBranch(
    root: string,
    name: string,
    path?: string,
  ): Promise<{ current: string }> {
    const cwd = await this.resolveRepo(root, path);
    this.assertRefName(name);
    const res = await this.exec(cwd, this.git('switch', name));
    if (res.exitCode !== 0) {
      throw new BadRequestException(
        res.stderr.trim() || res.stdout.trim() || 'git switch failed',
      );
    }
    return { current: name };
  }

  /**
   * Discard work-tree changes to tracked files — the most common undo in Git.
   *
   * Tracked files only. An untracked file is not in HEAD, so "restore" has nothing
   * to restore it to: discarding it means *deleting* it, which is `git clean` — a
   * different and more dangerous verb that this brief does not add. The caller is
   * told that plainly rather than being silently given a no-op.
   */
  async discard(
    root: string,
    paths: string[],
    path?: string,
  ): Promise<{ entries: GitStatusEntry[] }> {
    const cwd = await this.resolveRepo(root, path);
    this.assertPaths(paths);

    const { entries } = await this.status(root, path);
    const untracked = new Set(
      entries.filter((e) => e.index === '?').map((e) => e.path),
    );
    const blocked = paths.filter((p) => untracked.has(p));
    if (blocked.length > 0) {
      throw new BadRequestException(
        `Not tracked by git, so there is nothing to restore: ${blocked.join(', ')}. Delete it in Files instead.`,
      );
    }

    // `restore --worktree` leaves the index alone: discarding an unstaged edit must
    // not also throw away something the user deliberately staged.
    const res = await this.exec(
      cwd,
      this.git('restore', '--worktree', '--', ...paths),
    );
    if (res.exitCode !== 0) {
      throw new BadRequestException(res.stderr.trim() || 'git restore failed');
    }
    return this.status(root, path);
  }

  async stashList(
    root: string,
    path?: string,
  ): Promise<{ stashes: { index: number; label: string }[] }> {
    const cwd = await this.resolveRepo(root, path);
    const res = await this.exec(
      cwd,
      this.git('stash', 'list', '-z', '--pretty=format:%gd%x1f%s'),
    );
    if (res.exitCode !== 0) return { stashes: [] };
    const stashes = res.stdout
      .split(RECORD_SEP)
      .filter((rec) => rec.length > 0)
      .map((rec, index) => {
        const [, subject] = rec.split(FIELD_SEP);
        return { index, label: subject ?? rec };
      });
    return { stashes };
  }

  /** Stash everything, with an optional message. */
  async stashPush(
    root: string,
    message?: string,
    path?: string,
  ): Promise<{ output: string }> {
    const cwd = await this.resolveRepo(root, path);
    const msg = (message ?? '').trim();
    // `--` before nothing is harmless and keeps a message that starts with '-'
    // from ever being read as a flag; `-m` already takes the next element whole.
    const args = msg ? ['push', '-m', msg] : ['push'];
    const res = await this.exec(cwd, this.git('stash', ...args));
    if (res.exitCode !== 0) {
      throw new BadRequestException(
        res.stderr.trim() || res.stdout.trim() || 'git stash failed',
      );
    }
    const out = res.stdout.trim();
    if (/no local changes/i.test(out)) {
      throw new BadRequestException('There is nothing to stash');
    }
    return { output: out };
  }

  /**
   * Pop a stash entry.
   *
   * The ref is built here as `stash@{n}` from a **validated integer**, never from
   * client text — `n` comes through the DTO as an int and is bounds-checked, so
   * there is no path by which a caller composes their own ref.
   */
  async stashPop(
    root: string,
    index?: number,
    path?: string,
  ): Promise<{ output: string }> {
    const cwd = await this.resolveRepo(root, path);
    const rest = ['pop'];
    if (index !== undefined) {
      const n = Math.trunc(index);
      if (!Number.isFinite(n) || n < 0 || n > 999) {
        throw new BadRequestException('Invalid stash index');
      }
      rest.push(`stash@{${n}}`);
    }
    const res = await this.exec(cwd, this.git('stash', ...rest));
    if (res.exitCode !== 0) {
      throw new BadRequestException(
        res.stderr.trim() || res.stdout.trim() || 'git stash pop failed',
      );
    }
    return { output: res.stdout.trim() };
  }

  /** The previous commit's message, so the amend UI can start from it. */
  async lastCommitMessage(
    root: string,
    path?: string,
  ): Promise<{ message: string }> {
    const cwd = await this.resolveRepo(root, path);
    const res = await this.exec(
      cwd,
      this.git('log', '-1', '--pretty=format:%B'),
    );
    return {
      message: res.exitCode === 0 ? res.stdout.replace(/\n+$/, '') : '',
    };
  }

  /** Replace the previous commit rather than stacking a "fix typo" on top of it. */
  async amend(
    root: string,
    message: string,
    path?: string,
  ): Promise<{ output: string }> {
    const cwd = await this.resolveRepo(root, path);
    const msg = message.trim();
    if (!msg) throw new BadRequestException('Commit message required');
    const res = await this.exec(cwd, this.git('commit', '--amend', '-m', msg));
    if (res.exitCode !== 0) {
      throw new BadRequestException(
        res.stderr.trim() || res.stdout.trim() || 'git commit --amend failed',
      );
    }
    return { output: res.stdout.trim() };
  }

  /**
   * Stage or unstage a single hunk by applying a patch to the **index only**.
   *
   * This is how every Git GUI does per-hunk staging, and the safety rests on three
   * things, all verified rather than assumed:
   *
   * 1. **`--cached`** — the patch touches the index and never the working tree, so
   *    a bad patch cannot damage a file the user has open.
   * 2. **No `--unsafe-paths`.** Measured against git 2.43: a patch naming
   *    `../outside.txt` is refused with "does not exist in index", and one naming
   *    `../../etc/x` with "invalid path". Git's default *is* the jail here, and the
   *    arg-array test asserts that flag never appears.
   * 3. **The patch goes in on stdin**, so it is never an argument and never a file
   *    on disk — see the `input` parameter on {@link exec}.
   *
   * `--reverse` unstages: applying the same hunk backwards is exactly "take this
   * back out of the index", so one code path serves both directions.
   */
  async applyPatch(
    root: string,
    patch: string,
    reverse?: boolean,
    path?: string,
  ): Promise<{ entries: GitStatusEntry[] }> {
    const cwd = await this.resolveRepo(root, path);
    this.assertPatch(patch);
    const rest = ['--cached'];
    if (reverse) rest.push('--reverse');
    // `--unidiff-zero` because a hunk selected in the UI can legitimately have no
    // context lines; without it git refuses those outright.
    rest.push('--unidiff-zero', '-');
    const res = await this.exec(cwd, this.git('apply', ...rest), patch);
    if (res.exitCode !== 0) {
      throw new BadRequestException(
        res.stderr.trim() ||
          'That hunk no longer applies — the file changed underneath it. Refresh and try again.',
      );
    }
    return this.status(root, path);
  }

  /**
   * Repos the user has opened, most recent first.
   *
   * Recorded explicitly by {@link rememberRepo} rather than as a side effect of
   * `resolveRepo`: status is polled, and a list that reorders itself while you read
   * it is not a recents list. Entries whose directory has since gone are filtered
   * out on read, so a deleted repo disappears instead of 404-ing when clicked.
   */
  async recentRepos(): Promise<{ repos: { root: string; path: string }[] }> {
    const rows = this.db.db
      .prepare(
        'SELECT root, path FROM git_recent_repos ORDER BY last_opened DESC LIMIT ?',
      )
      .all(MAX_RECENT_REPOS) as { root: string; path: string }[];

    const alive: { root: string; path: string }[] = [];
    for (const row of rows) {
      const ok = await this.filesService
        .resolveSafe(row.root, row.path)
        .then(({ abs }) => fs.stat(abs))
        .then((s) => s.isDirectory())
        .catch(() => false);
      if (ok) alive.push(row);
    }
    return { repos: alive };
  }

  /** Record a repo as opened. Only ever called after `resolveRepo` succeeded. */
  async rememberRepo(root: string, path?: string): Promise<void> {
    await this.resolveRepo(root, path);
    this.db.db
      .prepare(
        `INSERT INTO git_recent_repos (root, path, last_opened)
         VALUES (@root, @path, CURRENT_TIMESTAMP)
         ON CONFLICT(root, path)
         DO UPDATE SET last_opened = CURRENT_TIMESTAMP`,
      )
      .run({ root, path: path ?? '' });
    // Keep the table from growing without bound; the UI only ever shows the top few.
    this.db.db
      .prepare(
        `DELETE FROM git_recent_repos
          WHERE id NOT IN (
            SELECT id FROM git_recent_repos ORDER BY last_opened DESC LIMIT ?
          )`,
      )
      .run(MAX_RECENT_REPOS);
  }

  forgetRepo(root: string, path?: string): void {
    this.db.db
      .prepare('DELETE FROM git_recent_repos WHERE root = ? AND path = ?')
      .run(root, path ?? '');
  }

  // ---------------------------------------------------------------------------
  // Parsing (pure — unit-testable in isolation)
  // ---------------------------------------------------------------------------

  /**
   * Parse `git status --porcelain=v1 -z`. NUL-terminated records; each record
   * is `XY<space><path>`. For a rename/copy (X or Y is 'R'/'C') the ORIGINAL
   * path follows as the next NUL-terminated record. `-z` is used precisely so
   * paths with spaces/newlines/quotes parse unambiguously (no git quoting).
   */
  parseStatus(stdout: string): GitStatusEntry[] {
    const tokens = stdout.split(RECORD_SEP);
    const entries: GitStatusEntry[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.length < 3) continue; // trailing empty token / malformed
      const index = token[0];
      const worktree = token[1];
      const path = token.slice(3);
      let origPath: string | undefined;
      if (index === 'R' || index === 'C') {
        // A staged rename/copy: the ORIGINAL path is the following record.
        origPath = tokens[i + 1];
        i++;
      }
      entries.push({
        index,
        worktree,
        path,
        origPath,
        staged: index !== ' ' && index !== '?' && index !== '!',
      });
    }
    return entries;
  }

  /**
   * Parse `git log -z --pretty=format:%H\x1f%an\x1f%ae\x1f%at\x1f%s`. Commits
   * are NUL-separated; fields are unit-separator (0x1f) separated so a subject
   * containing any printable character parses cleanly.
   */
  parseLog(stdout: string): GitCommit[] {
    return stdout
      .split(RECORD_SEP)
      .filter((rec) => rec.length > 0)
      .map((rec) => {
        const [hash, authorName, authorEmail, at, subject] =
          rec.split(FIELD_SEP);
        const epoch = Number(at);
        return {
          hash: hash ?? '',
          authorName: authorName ?? '',
          authorEmail: authorEmail ?? '',
          date: Number.isFinite(epoch)
            ? new Date(epoch * 1000).toISOString()
            : '',
          subject: subject ?? '',
        };
      });
  }

  // ---------------------------------------------------------------------------
  // Pathspec guards (defence in depth on top of the DTO validators)
  // ---------------------------------------------------------------------------

  private assertPaths(paths: string[]): void {
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new BadRequestException('paths must be a non-empty array');
    }
    for (const p of paths) this.assertPathspec(p);
  }

  private assertPathspec(p: string): void {
    if (typeof p !== 'string' || p.length === 0 || p.includes('\0')) {
      throw new BadRequestException('Invalid pathspec');
    }
  }

  /**
   * Stricter than {@link assertPathspec}, for the one place a path becomes part
   * of a *revision* argument rather than a pathspec after `--` (brief 114).
   *
   * `git show HEAD:<file>` has no `--` to hide behind, so the argv element is
   * checked itself: no leading `-` (never a flag), never absolute, and no `..`
   * segment. The filesystem jail is still `resolveRepo`'s job — this is defence
   * in depth on the argument, not a substitute for it.
   */
  private assertRepoRelPath(p: string): void {
    this.assertPathspec(p);
    if (p.startsWith('-')) {
      throw new BadRequestException('Invalid path');
    }
    if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) {
      throw new BadRequestException('Path must be relative to the repository');
    }
    if (p.split('/').includes('..')) {
      throw new BadRequestException('Path must not leave the repository');
    }
  }

  /**
   * The committed contents of one file at HEAD (brief 114) — the left side of
   * Git GUI's "Compare with HEAD".
   *
   * The revision is the literal `HEAD`, never anything the client sends: the
   * feature is "compare with what is committed", and a `rev` parameter would
   * widen this to every object in the repository for nothing the UI asks for.
   *
   * A file with no blob at HEAD — newly added, or untracked — is a normal
   * answer, not an error: `{ content: '', exists: false }` lets the caller
   * diff against empty and say "new file" instead of showing a failure for a
   * file that is simply new.
   */
  async showAtHead(
    root: string,
    path: string | undefined,
    file: string,
  ): Promise<{ content: string; exists: boolean }> {
    const cwd = await this.resolveRepo(root, path);
    this.assertRepoRelPath(file);
    const res = await this.exec(cwd, this.git('show', `HEAD:${file}`));
    if (res.exitCode !== 0) {
      const err = res.stderr.toLowerCase();
      // git's wording for "that path is not in that revision". Anything else —
      // a corrupt object, an unborn branch we did not anticipate — still fails
      // loudly rather than pretending the file is new.
      if (
        err.includes('does not exist') ||
        err.includes('exists on disk, but not in') ||
        err.includes('invalid object name') ||
        err.includes('unknown revision')
      ) {
        return { content: '', exists: false };
      }
      throw new BadRequestException(res.stderr.trim() || 'git show failed');
    }
    return { content: res.stdout, exists: true };
  }

  /**
   * Shape check on a patch before it reaches `git apply`.
   *
   * Not a security boundary — git's own path handling is that, and it was measured
   * (see {@link applyPatch}). This is a cheap sanity gate so obvious junk fails with
   * a useful message instead of a git parse error, and so an unbounded blob never
   * gets piped into a subprocess.
   */
  private assertPatch(patch: string): void {
    if (typeof patch !== 'string' || patch.trim() === '') {
      throw new BadRequestException('Empty patch');
    }
    if (patch.includes('\0')) {
      throw new BadRequestException('Invalid patch');
    }
    if (patch.length > MAX_PATCH_BYTES) {
      throw new BadRequestException(
        'That hunk is too large to stage on its own',
      );
    }
    if (!/^(diff --git |--- )/m.test(patch)) {
      throw new BadRequestException('That does not look like a diff');
    }
  }

  /**
   * Guard for anything that reaches git as a **ref**, not a pathspec.
   *
   * This is the guard the brief's security review is aimed at, and it exists
   * because a branch name is the one new class of input that cannot be protected
   * by `--`. `--` separates options from *pathspecs*; there is no equivalent for
   * `git switch <name>`, so a name like `--upload-pack=/bin/sh` or `-D` would be
   * read as a flag. Everything that is not obviously a ref is refused **before**
   * it becomes an argument.
   *
   * The rules are git's own (`git check-ref-format`), enforced here rather than by
   * shelling out to check them — a name that fails is rejected without ever being
   * passed to git at all, which is the point:
   *
   * - never begins with `-` (the flag-injection case) or `.`
   * - no ASCII control characters, no space, and no NUL
   * - none of `~ ^ : ? * [ \` (git forbids these in ref names)
   * - no `..`, no `@{`, not a bare `@`
   * - no `//`, no trailing `/` or `.`, no `.lock` component
   *
   * `assertPathspec` is deliberately NOT reused: it permits `-` and `..`, which are
   * fine for a path after `--` and are exactly what must not be allowed here.
   */
  private assertRefName(name: string): void {
    const invalid = () =>
      new BadRequestException(
        'Invalid branch name — letters, digits, and - _ / . are allowed, and it cannot start with a dash',
      );
    if (typeof name !== 'string') throw invalid();
    const n = name.trim();
    if (n.length === 0 || n.length > 255) throw invalid();
    if (n.startsWith('-') || n.startsWith('.')) throw invalid();

    if (/[\0-\x20\x7f~^:?*[\\]/.test(n)) throw invalid();
    if (n.includes('..') || n.includes('@{') || n === '@') throw invalid();
    if (n.includes('//') || n.endsWith('/') || n.endsWith('.')) throw invalid();
    if (n.split('/').some((part) => part === '' || part.endsWith('.lock'))) {
      throw invalid();
    }
  }
}
