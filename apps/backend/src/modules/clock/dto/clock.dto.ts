import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

/** 24-hour wall-clock time, zero-padded. The only alarm time format. */
export const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Weekday repeat mask: 7 characters of '0'/'1', Monday-first. */
export const DAY_MASK = /^[01]{7}$/;

/** Labels are shown, not parsed — bounded so a row cannot be a novel. */
const MAX_LABEL = 120;

/**
 * An IANA zone name is only valid if this platform's ICU knows it, so ask ICU
 * rather than pattern-matching `Region/City`. Both halves matter: a bad zone
 * stored here would throw inside `Intl.DateTimeFormat` on every render in the
 * browser, which is a far worse failure than a 400 at write time.
 */
export function isKnownTimeZone(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function IsTimeZone(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isTimeZone',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => isKnownTimeZone(value),
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} must be an IANA time zone this system knows`,
      },
    });
  };
}

export class CreateWorldClockDto {
  @IsString()
  @MaxLength(MAX_LABEL)
  label: string;

  @IsTimeZone()
  timeZone: string;
}

export class CreateAlarmDto {
  @IsString()
  @MaxLength(MAX_LABEL)
  @IsOptional()
  label?: string;

  @Matches(HH_MM, { message: 'time must be 24-hour HH:mm' })
  time: string;

  @Matches(DAY_MASK, {
    message: 'days must be 7 characters of 0/1, Monday-first',
  })
  @IsOptional()
  days?: string;
}

export class UpdateAlarmDto {
  @IsString()
  @MaxLength(MAX_LABEL)
  @IsOptional()
  label?: string;

  @Matches(HH_MM, { message: 'time must be 24-hour HH:mm' })
  @IsOptional()
  time?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @Matches(DAY_MASK, {
    message: 'days must be 7 characters of 0/1, Monday-first',
  })
  @IsOptional()
  days?: string;

  /**
   * The within-minute double-fire guard key, written by the client that rang the
   * alarm. Opaque to the server on purpose: the *client's* wall clock decides
   * when a local-time alarm is due, so the server storing its own idea of "now"
   * here would be a second, disagreeing source of truth.
   */
  @IsString()
  @MaxLength(64)
  @IsOptional()
  lastFiredAt?: string | null;

  /** Epoch ms a snooze expires, or null to clear it. */
  @IsInt()
  @Min(0)
  @IsOptional()
  snoozedUntil?: number | null;
}

/** One imported alarm — same shape the old localStorage store held. */
export class ImportAlarmDto {
  @IsString()
  @MaxLength(MAX_LABEL)
  @IsOptional()
  label?: string;

  @Matches(HH_MM, { message: 'time must be 24-hour HH:mm' })
  time: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @Matches(DAY_MASK)
  @IsOptional()
  days?: string;
}

export class ImportWorldClockDto {
  @IsString()
  @MaxLength(MAX_LABEL)
  label: string;

  @IsTimeZone()
  timeZone: string;
}

/**
 * The one-time hand-over from a browser's `localStorage` to the container.
 *
 * Bounded, and applied only when the tables are still empty (see the service) so
 * two tabs racing on first load cannot double-import.
 */
export class ImportClockStateDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ImportWorldClockDto)
  @IsOptional()
  worldClocks?: ImportWorldClockDto[];

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ImportAlarmDto)
  @IsOptional()
  alarms?: ImportAlarmDto[];
}
