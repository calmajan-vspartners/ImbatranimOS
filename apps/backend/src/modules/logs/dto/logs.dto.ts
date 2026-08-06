import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const LOG_LEVELS = ['info', 'warn', 'error'] as const;

export class LogQueryDto {
  @IsOptional()
  @IsIn(LOG_LEVELS)
  level?: (typeof LOG_LEVELS)[number];

  /** Free-text filter, matched case-insensitively against the raw line. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(2000)
  limit?: number;
}

/**
 * A crash the browser is reporting (brief 47's error boundary → brief 84's log).
 *
 * Everything here is **untrusted text from the client**, which is why the shape
 * is this narrow: an app id, a one-line message, and nothing else. There is no
 * free-form metadata field, because a client-controlled object in a log file is
 * a log-injection surface with no upside. The recorded entry is tagged
 * `source: 'client'` so it can never be read as something the server observed.
 */
export class ClientErrorDto {
  @IsString()
  @MaxLength(64)
  appId!: string;

  @IsString()
  @MaxLength(300)
  message!: string;
}
