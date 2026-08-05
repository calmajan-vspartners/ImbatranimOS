import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  COLORS,
  MAX_CONTENT,
  MAX_SIZE,
  MIN_SIZE,
} from './create-sticky-note.dto';

/** Every field optional. `color: null` clears back to the default surface. */
export class UpdateStickyNoteDto {
  @IsString()
  @MaxLength(MAX_CONTENT)
  @IsOptional()
  content?: string;

  @IsInt()
  @IsOptional()
  x?: number;

  @IsInt()
  @IsOptional()
  y?: number;

  @IsInt()
  @Min(MIN_SIZE)
  @Max(MAX_SIZE)
  @IsOptional()
  width?: number;

  @IsInt()
  @Min(MIN_SIZE)
  @Max(MAX_SIZE)
  @IsOptional()
  height?: number;

  @IsIn(COLORS)
  @IsOptional()
  color?: (typeof COLORS)[number] | null;

  @IsBoolean()
  @IsOptional()
  onDesktop?: boolean;
}
