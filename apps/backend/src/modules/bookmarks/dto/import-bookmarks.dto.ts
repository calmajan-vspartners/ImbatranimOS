import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsBookmarkUrl, MAX_URL_LENGTH } from './bookmark-url';
import { MAX_NAME } from './create-group.dto';
import { MAX_TITLE } from './create-link.dto';

/**
 * The shape a parsed Netscape-HTML file arrives in.
 *
 * Every field is validated even though the client parsed the file, because the
 * client is not a trust boundary — this is an internet-exposable route, and the
 * URLs come from an arbitrary HTML file. `IsBookmarkUrl` is what keeps a
 * `javascript:` href out of a table the app renders as `<a href>`.
 *
 * The caps are what stop one import from becoming a denial of service: recursion is
 * bounded by `MAX_DEPTH` at the parser, and breadth by `ArrayMaxSize` here. Both are
 * far above any real browser export (Chrome's default profile has a handful of
 * folders; 500 siblings is already pathological).
 */
export const MAX_SIBLINGS = 500;

export class ImportLinkDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TITLE)
  title: string;

  @IsBookmarkUrl()
  @MaxLength(MAX_URL_LENGTH)
  url: string;
}

export class ImportFolderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME)
  name: string;

  @IsArray()
  @ArrayMaxSize(MAX_SIBLINGS)
  @ValidateNested({ each: true })
  @Type(() => ImportLinkDto)
  @IsOptional()
  links?: ImportLinkDto[];

  @IsArray()
  @ArrayMaxSize(MAX_SIBLINGS)
  @ValidateNested({ each: true })
  @Type(() => ImportFolderDto)
  @IsOptional()
  folders?: ImportFolderDto[];
}

export class ImportBookmarksDto {
  @IsArray()
  @ArrayMaxSize(MAX_SIBLINGS)
  @ValidateNested({ each: true })
  @Type(() => ImportFolderDto)
  folders: ImportFolderDto[];

  /** Import under an existing folder, or at the root when absent. */
  @IsInt()
  @IsPositive()
  @IsOptional()
  parentId?: number | null;
}
