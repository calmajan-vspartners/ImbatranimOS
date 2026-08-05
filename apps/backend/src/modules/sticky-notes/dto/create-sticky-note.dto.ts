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

/** A sticky note is a scrap, not a document (rich text is out of scope). */
export const MAX_CONTENT = 10_000;

/**
 * The shared palette, matching Calendar's event colours (brief 72).
 *
 * Same names, same reason: the OS identity is B&W plus one accent, so a
 * saturated "sticky yellow" is off-identity, and these are applied as a tinted
 * border plus a low-alpha fill rather than a solid block of colour. Reusing the
 * set rather than inventing a second one is the point — see the brief outcome.
 */
export const COLORS = [
  'blue',
  'green',
  'amber',
  'red',
  'purple',
  'slate',
] as const;

/** Bounds for a desktop note, so a bad drag cannot store something unusable. */
export const MIN_SIZE = 120;
export const MAX_SIZE = 1200;

export class CreateStickyNoteDto {
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
