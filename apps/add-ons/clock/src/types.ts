/**
 * The shapes the backend `clock` module speaks. camelCase all the way through —
 * this module maps its SQLite columns at the service boundary, unlike the older
 * `todos`/`sticky-notes` surfaces that leak `snake_case` into React props.
 */

export type WorldClock = {
  id: number
  label: string
  timeZone: string
}

export type Alarm = {
  id: number
  label: string
  /** 24h "HH:mm", local wall-clock time. */
  time: string
  enabled: boolean
  /** 7-char '0'/'1' weekday mask, Monday-first. All zeros = fires once. */
  days: string
  /**
   * The minute key this alarm last rang for — see `alarmSchedule.minuteKey`.
   * Written by whichever client rang it, because a local-time alarm is due
   * according to the *viewer's* clock, not the server's.
   */
  lastFiredAt: string | null
  /** Epoch ms a pending snooze expires, or null. */
  snoozedUntil: number | null
}

/** Everything a PATCH may carry. `null` is meaningful for the last two. */
export type AlarmPatch = {
  label?: string
  time?: string
  enabled?: boolean
  days?: string
  lastFiredAt?: string | null
  snoozedUntil?: number | null
}
