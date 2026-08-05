import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsBookmarkUrl, MAX_URL_LENGTH } from './bookmark-url';
import { MAX_TITLE } from './create-link.dto';

export class UpdateLinkDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TITLE)
  @IsOptional()
  title?: string;

  @IsBookmarkUrl()
  @MaxLength(MAX_URL_LENGTH)
  @IsOptional()
  url?: string;

  @IsString()
  @MaxLength(64)
  @IsOptional()
  icon?: string;

  /** Moving a bookmark into another folder. */
  @IsInt()
  @IsPositive()
  @IsOptional()
  groupId?: number;
}
