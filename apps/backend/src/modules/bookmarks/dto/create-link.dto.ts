import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsBookmarkUrl, MAX_URL_LENGTH } from './bookmark-url';

/** A title long enough for a real page title, short enough for a row. */
export const MAX_TITLE = 300;

export class CreateLinkDto {
  @IsInt()
  @IsPositive()
  groupId: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TITLE)
  title: string;

  // Not `@IsUrl()` — see `bookmark-url.ts` for what that actually accepts.
  @IsBookmarkUrl()
  @MaxLength(MAX_URL_LENGTH)
  url: string;

  @IsString()
  @IsOptional()
  @MaxLength(64)
  icon?: string;
}
