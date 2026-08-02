import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as fs from 'fs/promises';
import { sep } from 'path';
import { FilesService } from '../files/files.service';

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

@Injectable()
export class GitService {
  constructor(private readonly filesService: FilesService) {}

  // ---------------------------------------------------------------------------
  // execa seam — THE ONLY place a git process is spawned.
  //
  // Always: file 'git', an explicit string[] of args (never a command string),
  // no `shell`, a fixed cwd, bounded time + output. This shape is what makes
  // command injection structurally impossible: nothing the client sends is ever
  // interpreted by a shell. Kept public so tests can assert the arg array.
  // ---------------------------------------------------------------------------
  async exec(cwd: string, args: string[]): Promise<ExecResult> {
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
    });
    if (isBinaryMissing(result)) {
      throw new ServiceUnavailableException(
        'git is not available in this image — the Git app cannot run',
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
}
