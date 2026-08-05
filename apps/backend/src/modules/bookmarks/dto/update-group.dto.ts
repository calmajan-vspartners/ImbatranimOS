import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { MAX_NAME } from './create-group.dto';

export class UpdateGroupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME)
  @IsOptional()
  name?: string;

  @IsString()
  @MaxLength(64)
  @IsOptional()
  icon?: string;

  /**
   * `null` moves the folder to the root; `undefined` leaves it where it is. The
   * `ValidateIf` is what keeps those two apart — `@IsOptional()` alone would also
   * skip validation for an explicit `null`, and then any junk would pass.
   */
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @IsInt()
  @IsPositive()
  parentId?: number | null;
}
