import { currentHHmm } from './format'

/**
 * The alarm firing decision, as pure functions over `(alarm, now)`.
 *
 * This is where an alarm app goes wrong: fires twice in the same minute, fires
 * again the second the user snoozes it, or a "weekdays" alarm rings on Sunday.
 * Keeping the decision out of the interval callback makes all of those testable
 * without waiting for a real clock.
 */

/** Weekday repeat mask: 7 characters of '0'/'1', **Monday-first**. */
export type DayMask = string

/** No days selected — a one-shot alarm that disables itself after ringing. */
export const NO_REPEAT: DayMask = '0000000'
export const EVERY_DAY: DayMask = '1111111'
export const WEEKDAYS: DayMask = '1111100'

/** Monday-first, matching the mask order (JS `getDay()` is Sunday-first). */
export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
/** Single letters for the chip row; index-matched to DAY_LABELS. */
export const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const

export function isValidDayMask(mask: string): boolean {
  return /^[01]{7}$/.test(mask)
}

/** `getDay()` is 0=Sunday; the mask is 0=Monday. */
export function dayIndex(date: Date): number {
  return (date.getDay() + 6) % 7
}

export function toggleDay(mask: DayMask, index: number): DayMask {
  const chars = [...(isValidDayMask(mask) ? mask : NO_REPEAT)]
  chars[index] = chars[index] === '1' ? '0' : '1'
  return chars.join('')
}

export function repeatsOn(mask: DayMask, index: number): boolean {
  return isValidDayMask(mask) && mask[index] === '1'
}

/** Human label for the mask, as shown on an alarm row. */
export function describeDays(mask: DayMask): string {
  if (!isValidDayMask(mask) || mask === NO_REPEAT) return 'Once'
  if (mask === EVERY_DAY) return 'Every day'
  if (mask === WEEKDAYS) return 'Weekdays'
  if (mask === '0000011') return 'Weekends'
  return DAY_LABELS.filter((_, i) => mask[i] === '1').join(', ')
}

/**
 * Double-fire guard key: an alarm records the minute it last rang for, so a
 * 1s-interval check inside a single minute fires exactly once — and so an alarm
 * that rang at 07:00 today does not ring again if the window is closed and
 * reopened at 07:00:40.
 */
export function minuteKey(now: Date): string {
  return `${now.toDateString()} ${currentHHmm(now)}`
}

/** Just the fields the decision reads — keeps the tests free of API shape. */
export type SchedulableAlarm = {
  time: string
  enabled: boolean
  days: DayMask
  lastFiredAt: string | null
  snoozedUntil: number | null
}

/**
 * How late a scheduled alarm may fire and still count. Hidden tabs throttle
 * intervals to ~1/min, so a tick can land just *after* an alarm's minute; the
 * window lets that tick catch the occurrence rather than skip the alarm. Wide
 * enough for the worst throttle, narrow enough that reopening a desktop hours
 * later does not ring stale alarms.
 */
export const LATE_FIRE_WINDOW_MS = 90_000

export type DueOccurrence = {
  reason: 'snooze' | 'scheduled'
  /**
   * The instant the alarm names (or the snooze deadline) — NOT the tick that
   * observed it. Stable across tabs, so it doubles as the cross-tab claim key
   * (brief 93), and it is what `firedPatch` should record.
   */
  occurrenceMs: number
}

/**
 * The occurrence that makes this alarm ring, given that the previous check ran
 * at `sinceMs` — or `null`. Window-based rather than minute-equality so a
 * throttled background tick that lands at 07:00:45 (or 07:01:20) still catches
 * a 07:00 alarm instead of skipping it.
 *
 * A pending snooze suppresses the scheduled time: snoozing at 07:00:10 must not
 * re-ring at 07:00:11 just because the wall clock still reads 07:00.
 */
export function dueOccurrence(
  alarm: SchedulableAlarm,
  now: Date,
  sinceMs: number
): DueOccurrence | null {
  if (!alarm.enabled) return null

  if (alarm.snoozedUntil !== null) {
    return now.getTime() >= alarm.snoozedUntil
      ? { reason: 'snooze', occurrenceMs: alarm.snoozedUntil }
      : null
  }

  const nowMs = now.getTime()
  const [hh, mm] = alarm.time.split(':').map(Number)
  // The alarm's instant on `now`'s day — or the day before, so a tick just past
  // midnight still sees a 23:59 alarm that fell inside its window.
  for (const dayOffset of [0, -1]) {
    const day = new Date(now)
    day.setDate(day.getDate() + dayOffset)
    const occurrence = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm, 0, 0)
    const occurrenceMs = occurrence.getTime()

    if (occurrenceMs <= sinceMs || occurrenceMs > nowMs) continue
    if (nowMs - occurrenceMs > LATE_FIRE_WINDOW_MS) continue
    // An unrepeated alarm rings at the next occurrence of its time, whatever day
    // that is; a repeating one only on the days it names.
    if (alarm.days !== NO_REPEAT && !repeatsOn(alarm.days, dayIndex(occurrence))) continue
    if (alarm.lastFiredAt === minuteKey(occurrence)) continue
    return { reason: 'scheduled', occurrenceMs }
  }
  return null
}

/**
 * Why an alarm is ringing right now, or `null` — the single-instant view of
 * `dueOccurrence`, scoped to `now`'s own minute (the shape the in-window tests
 * and the ring banner reason about).
 */
export function dueReason(alarm: SchedulableAlarm, now: Date): 'snooze' | 'scheduled' | null {
  const minuteStart = new Date(now)
  minuteStart.setSeconds(0, 0)
  return dueOccurrence(alarm, now, minuteStart.getTime() - 1)?.reason ?? null
}

/** How long a snooze lasts. One value, so the button label cannot drift from it. */
export const SNOOZE_MS = 5 * 60 * 1000
export const SNOOZE_LABEL = 'Snooze 5 min'

/**
 * The patch to persist once an alarm has rung.
 *
 * A one-shot alarm turns itself off — the same thing a phone does, and the only
 * way "Once" means once when the app is the only thing running. A repeating one
 * stays armed and relies on `lastFiredAt` for the within-minute guard.
 */
export function firedPatch(
  alarm: SchedulableAlarm,
  now: Date
): { lastFiredAt: string; snoozedUntil: null; enabled?: false } {
  const patch = { lastFiredAt: minuteKey(now), snoozedUntil: null } as const
  return alarm.days === NO_REPEAT ? { ...patch, enabled: false } : patch
}

/**
 * The patch for pressing Snooze.
 *
 * `enabled: true` matters: a one-shot alarm has just disabled itself in
 * `firedPatch`, and a snooze has to re-arm it or the snooze silently never
 * arrives.
 */
export function snoozePatch(nowMs: number): { enabled: true; snoozedUntil: number } {
  return { enabled: true, snoozedUntil: nowMs + SNOOZE_MS }
}
