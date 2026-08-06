import { Type } from 'class-transformer';
import {
  IsArray,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Longest a single dotfile value may be.
 *
 * Desktop icon positions are the biggest of these by a wide margin — one entry
 * per app — and they come to a couple of KB. 256 KB is far above anything the
 * stores can legitimately produce and far below anything that would matter to
 * the volume, which is the shape a cap should have: invisible in normal use,
 * present before a bug can fill the disk.
 */
export const MAX_PREF_BYTES = 256 * 1024;
/** How many keys one write may carry. There are four stores; ten is headroom. */
export const MAX_PREF_KEYS = 32;

export class PrefEntryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  key!: string;

  /** Serialised JSON. Opaque to the server — see {@link PrefsService}. */
  @IsString()
  @MaxLength(MAX_PREF_BYTES)
  value!: string;
}

export class PutPrefsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrefEntryDto)
  entries!: PrefEntryDto[];
}

/** What GET returns: key → serialised JSON, opaque to the server. */
export type PrefsMap = Record<string, string>;
