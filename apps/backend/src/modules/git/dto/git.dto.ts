import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * All git routes point at ONE repo, identified the same way the file manager
 * identifies a directory: a named `root` (see FilesService ROOTS / `home`) plus
 * an optional `path` under it. The directory is resolved through
 * `FilesService.resolveSafe` — the FS jail — and only used as an execa `cwd`;
 * it is never a client-controlled absolute path.
 */
class RepoRefDto {
  @IsString()
  @IsNotEmpty()
  root: string;

  @IsOptional()
  @IsString()
  path?: string;
}

/** GET /api/git/status?root=&path= */
export class StatusQueryDto extends RepoRefDto {}

/** GET /api/git/log?root=&path=&limit= */
export class LogQueryDto extends RepoRefDto {
  // Query strings arrive as text; ValidationPipe `transform` coerces via @Type.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

/** GET /api/git/diff?root=&path=&staged=&file= */
export class DiffQueryDto extends RepoRefDto {
  // Accept the common truthy string encodings for a query-string boolean.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  staged?: boolean;

  @IsOptional()
  @IsString()
  file?: string;
}

/** POST /api/git/stage | /api/git/unstage  { root, path?, paths[] } */
export class PathsBodyDto extends RepoRefDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  paths: string[];
}

/** POST /api/git/commit  { root, path?, message } */
export class CommitBodyDto extends RepoRefDto {
  @IsString()
  @IsNotEmpty()
  message: string;
}

// ---------------------------------------------------------------------------
// Brief 76. Note what is NOT here: no DTO accepts a raw ref pattern, an option
// string, or a remote. A branch name is validated again in the service by
// `assertRefName` — the DTO is the outer layer, not the only one, because `--`
// cannot protect a ref the way it protects a pathspec.
// ---------------------------------------------------------------------------

/** GET /api/git/branches?root=&path= */
export class BranchesQueryDto extends RepoRefDto {}

/** POST /api/git/branch { root, path?, name } — create; and /switch — switch */
export class BranchBodyDto extends RepoRefDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;
}

/** POST /api/git/discard { root, path?, paths[] } */
export class DiscardBodyDto extends PathsBodyDto {}

/** POST /api/git/stash { root, path?, message? } */
export class StashPushBodyDto extends RepoRefDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

/** POST /api/git/stash/pop { root, path?, index? } */
export class StashPopBodyDto extends RepoRefDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  index?: number;
}

/** POST /api/git/amend { root, path?, message } */
export class AmendBodyDto extends CommitBodyDto {}

/**
 * POST /api/git/apply { root, path?, patch, reverse? }
 *
 * `patch` is the one large free-text field this module accepts. It goes to git on
 * **stdin**, never as an argument, and `git apply --cached` (without
 * `--unsafe-paths`) is what keeps it inside the work tree.
 */
export class ApplyPatchBodyDto extends RepoRefDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024 * 1024)
  patch: string;

  @IsOptional()
  @IsBoolean()
  reverse?: boolean;
}

/** POST /api/git/recents | DELETE — a repo the user opened. */
export class RecentRepoBodyDto extends RepoRefDto {}
