import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** Query params for endpoints that need a root and an optional sub-path. */
export class ListQueryDto {
  @IsString()
  @IsNotEmpty()
  root: string;

  @IsOptional()
  @IsString()
  path?: string;
}

/** Query params for endpoints that need both a root and a path. */
export class RootPathQueryDto {
  @IsString()
  @IsNotEmpty()
  root: string;

  @IsString()
  @IsNotEmpty()
  path: string;
}

/**
 * Query params for GET /files/search. `query` is capped so a pathological
 * needle can't blow up the per-entry substring compare; `content` opts into the
 * (heavier) text-content grep and accepts the usual truthy query-string forms.
 */
export class SearchQueryDto {
  @IsString()
  @IsNotEmpty()
  root: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  query: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  content?: boolean;

  /**
   * Optional folder to search under, relative to the root (brief 112).
   *
   * Additive: omitting it keeps the whole-root walk every existing consumer
   * (the command palette) gets today. Jailed through the same `resolveSafe`
   * as every other path, and emitted hit paths stay ROOT-relative either way,
   * so the response shape does not change with the scope.
   */
  @IsOptional()
  @IsString()
  path?: string;

  /**
   * Ask for the matching line numbers and text on content hits (brief 113).
   *
   * Opt-in on top of `content`, and additive: without it the response is the
   * one every existing consumer already gets. The editor's find-in-files panel
   * needs something to group under; the palette and the file manager do not,
   * and should not pay for it.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  matches?: boolean;
}

export class WriteContentDto {
  @IsString()
  @IsNotEmpty()
  root: string;

  @IsString()
  @IsNotEmpty()
  path: string;

  @IsString()
  @IsNotEmpty()
  content: string;
}

export class CreateDirectoryDto {
  @IsString()
  @IsNotEmpty()
  root: string;

  @IsString()
  @IsNotEmpty()
  path: string;
}

export class MoveDto {
  @IsString()
  @IsNotEmpty()
  root: string;

  @IsString()
  @IsNotEmpty()
  from: string;

  @IsString()
  @IsNotEmpty()
  to: string;
}

export class CopyDto {
  @IsString()
  @IsNotEmpty()
  root: string;

  @IsString()
  @IsNotEmpty()
  from: string;

  @IsString()
  @IsNotEmpty()
  to: string;
}
