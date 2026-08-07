import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { GitService } from './git.service';
import {
  AmendBodyDto,
  ApplyPatchBodyDto,
  BranchBodyDto,
  BranchesQueryDto,
  CommitBodyDto,
  DiffQueryDto,
  ShowQueryDto,
  DiscardBodyDto,
  LogQueryDto,
  PathsBodyDto,
  RecentRepoBodyDto,
  StashPopBodyDto,
  StashPushBodyDto,
  StatusQueryDto,
} from './dto/git.dto';

/**
 * Git operations over a single home-FS repo. Every route is authenticated by
 * the global SessionAuthGuard (no `@Public()` here); mutating routes also get
 * the guard's Origin/CSRF check. There is deliberately NO generic "run git"
 * route — only this fixed allowlist of subcommands exists.
 */
@Controller('git')
export class GitController {
  constructor(private readonly gitService: GitService) {}

  /** GET /api/git/status?root=&path= → parsed porcelain status */
  @Get('status')
  status(@Query() q: StatusQueryDto) {
    return this.gitService.status(q.root, q.path);
  }

  /** GET /api/git/log?root=&path=&limit= → recent commits */
  @Get('log')
  log(@Query() q: LogQueryDto) {
    return this.gitService.log(q.root, q.path, q.limit);
  }

  /** GET /api/git/diff?root=&path=&staged=&file= → unified diff (bounded) */
  @Get('diff')
  diff(@Query() q: DiffQueryDto) {
    return this.gitService.diff(q.root, q.path, q.staged, q.file);
  }

  /** POST /api/git/stage { root, path?, paths[] } → updated status */
  /**
   * GET /api/git/show?root=&path=&file= → { content, exists }
   *
   * One file's contents at HEAD (brief 114). `show` is one more literal at one
   * more call site — still no generic "run git" route, and no `rev` parameter.
   */
  @Get('show')
  show(@Query() q: ShowQueryDto) {
    return this.gitService.showAtHead(q.root, q.path, q.file);
  }

  @Post('stage')
  stage(@Body() dto: PathsBodyDto) {
    return this.gitService.stage(dto.root, dto.paths, dto.path);
  }

  /** POST /api/git/unstage { root, path?, paths[] } → updated status */
  @Post('unstage')
  unstage(@Body() dto: PathsBodyDto) {
    return this.gitService.unstage(dto.root, dto.paths, dto.path);
  }

  /** POST /api/git/commit { root, path?, message } → commit output */
  @Post('commit')
  commit(@Body() dto: CommitBodyDto) {
    return this.gitService.commit(dto.root, dto.message, dto.path);
  }

  // -------------------------------------------------------------------------
  // Brief 76. Still no generic "run git" route — this is a longer allowlist,
  // not a looser one, and every entry names one subcommand.
  // -------------------------------------------------------------------------

  /** GET /api/git/branches?root=&path= → local branches, HEAD, and dirtiness */
  @Get('branches')
  branches(@Query() q: BranchesQueryDto) {
    return this.gitService.branches(q.root, q.path);
  }

  /** POST /api/git/branch { root, path?, name } → create a branch and switch */
  @Post('branch')
  createBranch(@Body() dto: BranchBodyDto) {
    return this.gitService.createBranch(dto.root, dto.name, dto.path);
  }

  /** POST /api/git/switch { root, path?, name } → switch to an existing branch */
  @Post('switch')
  switchBranch(@Body() dto: BranchBodyDto) {
    return this.gitService.switchBranch(dto.root, dto.name, dto.path);
  }

  /** POST /api/git/discard { root, path?, paths[] } → restore tracked files */
  @Post('discard')
  discard(@Body() dto: DiscardBodyDto) {
    return this.gitService.discard(dto.root, dto.paths, dto.path);
  }

  /** GET /api/git/stash?root=&path= → the stash entries */
  @Get('stash')
  stashList(@Query() q: BranchesQueryDto) {
    return this.gitService.stashList(q.root, q.path);
  }

  /** POST /api/git/stash { root, path?, message? } → stash everything */
  @Post('stash')
  stashPush(@Body() dto: StashPushBodyDto) {
    return this.gitService.stashPush(dto.root, dto.message, dto.path);
  }

  /** POST /api/git/stash/pop { root, path?, index? } → restore a stash entry */
  @Post('stash/pop')
  stashPop(@Body() dto: StashPopBodyDto) {
    return this.gitService.stashPop(dto.root, dto.index, dto.path);
  }

  /** GET /api/git/last-message?root=&path= → HEAD's message, to seed an amend */
  @Get('last-message')
  lastCommitMessage(@Query() q: BranchesQueryDto) {
    return this.gitService.lastCommitMessage(q.root, q.path);
  }

  /** POST /api/git/amend { root, path?, message } → replace the last commit */
  @Post('amend')
  amend(@Body() dto: AmendBodyDto) {
    return this.gitService.amend(dto.root, dto.message, dto.path);
  }

  /** GET /api/git/recents → repos opened before, most recent first */
  @Get('recents')
  recents() {
    return this.gitService.recentRepos();
  }

  /** POST /api/git/recents { root, path? } → record a repo as opened */
  @Post('recents')
  @HttpCode(204)
  remember(@Body() dto: RecentRepoBodyDto) {
    return this.gitService.rememberRepo(dto.root, dto.path);
  }

  /** DELETE /api/git/recents { root, path? } → drop one from the list */
  @Delete('recents')
  @HttpCode(204)
  forget(@Body() dto: RecentRepoBodyDto) {
    return this.gitService.forgetRepo(dto.root, dto.path);
  }

  /** POST /api/git/apply { root, path?, patch, reverse? } → stage/unstage a hunk */
  @Post('apply')
  applyPatch(@Body() dto: ApplyPatchBodyDto) {
    return this.gitService.applyPatch(
      dto.root,
      dto.patch,
      dto.reverse,
      dto.path,
    );
  }
}
