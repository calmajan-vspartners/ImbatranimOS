import { IsIn, IsInt, IsString, MaxLength, Min } from 'class-validator';

/** The three domains that fire scheduled notifications (brief 93). */
export const SCHEDULE_DOMAINS = ['clock', 'calendar', 'todo'] as const;
export type ScheduleDomain = (typeof SCHEDULE_DOMAINS)[number];

/**
 * One occurrence of a scheduled thing: "alarm 4 at 07:30 on 2026-08-06" or
 * "event 12's reminder instant". `itemId` is a string because a domain may
 * need a composite key (todo announces `<id>:today` and `<id>:due`
 * separately); `occurrenceMs` is the client's wall-clock instant for the
 * occurrence — it only ever has to equal *itself* across tabs, which share a
 * clock, so the server never interprets it.
 */
export class ClaimDto {
  @IsIn(SCHEDULE_DOMAINS)
  domain!: ScheduleDomain;

  @IsString()
  @MaxLength(128)
  itemId!: string;

  @IsInt()
  @Min(0)
  occurrenceMs!: number;
}
