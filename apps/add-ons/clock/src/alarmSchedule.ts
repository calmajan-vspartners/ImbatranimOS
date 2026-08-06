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

/**
 * The guard key for an alarm's *scheduled* minute on `now`'s day — the same
 * string `minuteKey` yields at the scheduled minute, but built from the alarm's
 * configured time rather than the current clock. The catch-up (below) may ring an
 * alarm several minutes after its minute; keying the guard on the scheduled
 * minute rather than `now` is what still lets it ring exactly once.
 */
function scheduledKey(alarm: SchedulableAlarm, now: Date): string {
  return `${now.toDateString()} ${alarm.time}`
}

/** The scheduled instant of an alarm on `now`'s local day. */
function scheduledInstant(alarm: SchedulableAlarm, now: Date): number {
  const [h, m] = alarm.time.split(':').map(Number)
  const d = new Date(now)
  d.setHours(h ?? 0, m ?? 0, 0, 0)
  return d.getTime()
}

/**
 * How long after its scheduled minute an alarm may still catch up and ring.
 *
 * A background tab is throttled to ~1-minute ticks and a slept machine may not
 * tick at all, so a check can land minutes after the exact minute (07:03 for a
 * 07:00 alarm). Firing on `now >= scheduled` within this window — the same
 * timestamp-comparison the timer (`now >= endAt`) and snooze (`now >=
 * snoozedUntil`) already use — rings it once on the next tick instead of dropping
 * it. Bounded so a machine slept for hours does not resurrect a stale morning
 * alarm in the afternoon; the daily repeat cycle is 24h, so an hour is safely
 * inside it.
 */
export const ALARM_CATCHUP_MS = 60 * 60 * 1000

/** Just the fields the decision reads — keeps the tests free of API shape. */
export type SchedulableAlarm = {
  time: string
  enabled: boolean
  days: DayMask
  lastFiredAt: string | null
  snoozedUntil: number | null
}

/**
 * Why an alarm is ringing right now, or `null` if it is not.
 *
 * A pending snooze suppresses the scheduled time: snoozing at 07:00:10 must not
 * re-ring at 07:00:11 just because the wall clock still reads 07:00.
 */
export function dueReason(alarm: SchedulableAlarm, now: Date): 'snooze' | 'scheduled' | null {
  if (!alarm.enabled) return null

  if (alarm.snoozedUntil !== null) {
    return now.getTime() >= alarm.snoozedUntil ? 'snooze' : null
  }

  // Fire from the scheduled instant onward, catching up a throttled or slept tab
  // that only ticked after the exact minute, rather than requiring an exact HH:mm
  // match that a missed tick would skip entirely.
  const elapsed = now.getTime() - scheduledInstant(alarm, now)
  if (elapsed < 0 || elapsed > ALARM_CATCHUP_MS) return null
  if (alarm.lastFiredAt === scheduledKey(alarm, now)) return null
  // An unrepeated alarm rings at the next occurrence of its time, whatever day
  // that is; a repeating one only on the days it names.
  if (alarm.days !== NO_REPEAT && !repeatsOn(alarm.days, dayIndex(now))) return null
  return 'scheduled'
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
  // Record the *scheduled* minute, not `now`: a catch-up ring at 07:03 must mark
  // the 07:00 occurrence so `dueReason` does not ring it again on the next tick.
  const patch = { lastFiredAt: scheduledKey(alarm, now), snoozedUntil: null } as const
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
