import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

/** A folder name long enough for anything a browser export contains. */
export const MAX_NAME = 200;

export class CreateGroupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(64)
  icon?: string;

  /**
   * Parent folder, or absent/null for a root folder (brief 75).
   *
   * Nullable rather than optional-only because "move this folder to the root" has
   * to be expressible — `undefined` means "don't touch", `null` means "the root".
   */
  @IsInt()
  @IsPositive()
  @IsOptional()
  parentId?: number | null;
}
