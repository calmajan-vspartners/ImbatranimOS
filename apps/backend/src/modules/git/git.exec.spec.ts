import * as fs from 'fs/promises';
import * as os from 'os';
import { join } from 'path';

// Replace the real git binary with a mock so we can assert EXACTLY what is
// handed to execa: the file, the arg array, and the options — proving no shell
// and no command string, without depending on git being installed. The mock fn
// is `mock`-prefixed so the (hoisted) jest.mock factory may reference it.
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

/** The shape of the execa options object the service passes. */
type ExecaOpts = {
  shell?: boolean;
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
  env?: Record<string, string>;
};
type ExecaCall = [string, string[], ExecaOpts];

/** Typed view over the recorded execa calls (mock.calls is otherwise `any[]`). */
const calls = (): ExecaCall[] => mockExeca.mock.calls as ExecaCall[];

describe('GitService.exec (execa contract — no shell, array args)', () => {
  let service: GitService;
  let jail: string;
  const prevEnv = process.env.FILES_ROOT;

  beforeEach(async () => {
    jail = await fs.mkdtemp(join(os.tmpdir(), 'imb-git-exec-'));
    process.env.FILES_ROOT = jail;
    mockExeca.mockReset();
    // `--is-inside-work-tree` → "true"; `--show-toplevel` → the jail dir itself
    // (so the new top-level-within-jail containment check passes); everything
    // else → "true". Context-aware so resolveRepo's guards are satisfied.
    mockExeca.mockImplementation((_file: string, args: string[]) => {
      const stdout = args.includes('--show-toplevel') ? jail : 'true';
      return Promise.resolve({ stdout, stderr: '', exitCode: 0 });
    });
    service = new GitService(new FilesService(), testDb());
  });

  afterEach(async () => {
    process.env.FILES_ROOT = prevEnv;
    await fs.rm(jail, { recursive: true, force: true });
  });

  it('spawns "git" with an explicit array and never enables a shell', async () => {
    await service.exec('/some/repo', ['status', '--porcelain']);

    expect(mockExeca).toHaveBeenCalledTimes(1);
    const [file, args, opts] = calls()[0];
    expect(file).toBe('git');
    expect(Array.isArray(args)).toBe(true);
    expect(args).toEqual(['status', '--porcelain']);
    // The load-bearing assertions: no shell, bounded, fixed cwd.
    expect(opts.shell).toBe(false);
    expect(opts.cwd).toBe('/some/repo');
    expect(typeof opts.timeout).toBe('number');
    expect(typeof opts.maxBuffer).toBe('number');
    // Pathspec magic disabled so a pathspec is always a literal path.
    expect(opts.env?.GIT_LITERAL_PATHSPECS).toBe('1');
  });

  it('stage passes pathspecs after a `--` separator, even a `-`-leading one', async () => {
    // resolveRepo stat check needs the dir to exist; rev-parse is mocked "true".
    const { entries } = await service.stage('home', ['-rf', 'a.txt'], '');
    expect(Array.isArray(entries)).toBe(true);

    const addCall = calls().find((c) => c[1].includes('add'));
    expect(addCall).toBeDefined();
    const args = addCall![1];
    expect(args).toContain('--');
    // Both pathspecs sit AFTER the `--`, so neither can be read as a flag.
    expect(args.indexOf('--')).toBeLessThan(args.indexOf('-rf'));
    expect(args.indexOf('--')).toBeLessThan(args.indexOf('a.txt'));
    // Every execa call is (string, string[]) — never a single command string.
    for (const call of calls()) {
      expect(typeof call[0]).toBe('string');
      expect(Array.isArray(call[1])).toBe(true);
    }
  });

  it('commit passes the message as a single `-m <msg>` array element', async () => {
    await service.commit('home', 'hello; rm -rf ~', '');
    const commitCall = calls().find((c) => c[1].includes('commit'));
    expect(commitCall).toBeDefined();
    const args = commitCall![1];
    const mIdx = args.indexOf('-m');
    expect(mIdx).toBeGreaterThan(-1);
    // The whole message is ONE argument — never split, never shell-interpreted.
    expect(args[mIdx + 1]).toBe('hello; rm -rf ~');
  });
});
