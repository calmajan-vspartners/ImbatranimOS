import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** `YYYY-MM-DD`, the only date-without-time format this API speaks. */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export const COLORS = [
  'blue',
  'green',
  'amber',
  'red',
  'purple',
  'slate',
] as const;

const MAX_TITLE = 300;
const MAX_NOTES = 10_000;

/** A generous ceiling: enough for "skip this one" for years, bounded so a row cannot grow without limit. */
const MAX_EXCEPTIONS = 500;

/**
 * The RRULE-shaped subset the app can express.
 *
 * `count` and `until` are both optional and mutually exclusive in meaning; the
 * expansion honours whichever is present (and `count` first if a client sends
 * both), so no cross-field validator is needed to keep the data sane.
 */
export class RecurrenceDto {
  @IsIn(FREQUENCIES)
  freq: (typeof FREQUENCIES)[number];

  @IsInt()
  @Min(1)
  @Max(365)
  interval: number;

  /** Sunday-first 0..6, matching the frontend's `dayjs().day()`. */
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  @IsOptional()
  byWeekday?: number[];

  @Matches(ISO_DATE, { message: 'until must be YYYY-MM-DD' })
  @IsOptional()
  until?: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  @IsOptional()
  count?: number;
}

export class CreateEventDto {
  @IsString()
  @MaxLength(MAX_TITLE)
  title: string;

  /** epoch ms, local-time semantics — see the service doc. */
  @IsInt()
  start: number;

  @IsInt()
  end: number;

  @IsBoolean()
  @IsOptional()
  allDay?: boolean;

  @IsString()
  @MaxLength(MAX_NOTES)
  @IsOptional()
  notes?: string | null;

  @IsIn(COLORS)
  @IsOptional()
  color?: (typeof COLORS)[number] | null;

  @IsInt()
  @Min(1)
  @Max(40_320) // four weeks, in minutes
  @IsOptional()
  reminderMinutes?: number | null;

  @ValidateNested()
  @Type(() => RecurrenceDto)
  @IsOptional()
  recurrence?: RecurrenceDto | null;

  @IsArray()
  @ArrayMaxSize(MAX_EXCEPTIONS)
  @Matches(ISO_DATE, { each: true, message: 'exceptions must be YYYY-MM-DD' })
  @IsOptional()
  exceptions?: string[];
}

/** Every field is optional; `null` clears the nullable ones. */
export class UpdateEventDto {
  @IsString()
  @MaxLength(MAX_TITLE)
  @IsOptional()
  title?: string;

  @IsInt()
  @IsOptional()
  start?: number;

  @IsInt()
  @IsOptional()
  end?: number;

  @IsBoolean()
  @IsOptional()
  allDay?: boolean;

  @IsString()
  @MaxLength(MAX_NOTES)
  @IsOptional()
  notes?: string | null;

  @IsIn(COLORS)
  @IsOptional()
  color?: (typeof COLORS)[number] | null;

  @IsInt()
  @Min(1)
  @Max(40_320)
  @IsOptional()
  reminderMinutes?: number | null;

  @ValidateNested()
  @Type(() => RecurrenceDto)
  @IsOptional()
  recurrence?: RecurrenceDto | null;

  @IsArray()
  @ArrayMaxSize(MAX_EXCEPTIONS)
  @Matches(ISO_DATE, { each: true, message: 'exceptions must be YYYY-MM-DD' })
  @IsOptional()
  exceptions?: string[];
}

/**
 * The one-time hand-over from a browser's `localStorage`, and the landing point
 * for an ICS import.
 *
 * Bounded, and (for the migration) applied only when the table is still empty —
 * see the service. Each entry is a full `CreateEventDto`, so a malformed
 * recurrence in an imported file is rejected here rather than stored.
 */
export class ImportEventsDto {
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => CreateEventDto)
  events: CreateEventDto[];

  /**
   * When true (the migration), the whole import is refused if the table already
   * has rows. When false or absent (an ICS import), events are appended.
   */
  @IsBoolean()
  @IsOptional()
  onlyIfEmpty?: boolean;
}
