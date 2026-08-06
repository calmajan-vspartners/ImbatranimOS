/** Formatting helpers — pure functions, no React, no component exports. */

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

/**
 * "HH:MM:SS" from a *remaining* duration (clamped to >= 0) — the countdown rule.
 *
 * `Math.ceil`, deliberately, and this is the opposite of `formatStopwatch` below.
 * A countdown answers "how long until it fires?", so any non-zero remainder must
 * still read as at least `00:01`, and `00:00` must mean finished. `Math.round`
 * broke both ends: a fresh 5:00 timer showed `05:00` for only ~500ms before
 * flipping to `04:59` (a visibly half-length first second), and at 400ms left it
 * already read `00:00` while the timer had not fired yet.
 *
 * Do not "unify" this with `formatStopwatch` — the asymmetry is the point.
 */
export function formatClockDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${pad2(h)}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`
}

/**
 * "MM:SS.CC" (centiseconds) — the stopwatch's *elapsed* rule.
 *
 * `Math.floor`, deliberately: elapsed time answers "how much has passed?", and
 * time that has not passed yet must not be shown. So a stopwatch reads `00:00.00`
 * at the instant it starts, where a countdown reads its full duration. Same
 * reason `formatClockDuration` ceils; see the note there before merging them.
 */
export function formatStopwatch(ms: number): string {
  const clamped = Math.max(0, ms)
  const totalCentis = Math.floor(clamped / 10)
  const centis = totalCentis % 100
  const totalSeconds = Math.floor(totalCentis / 100)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${pad2(m)}:${pad2(s)}.${pad2(centis)}`
}

/** Local wall-clock time as HH:mm (24h), used for alarm matching. */
export function currentHHmm(now: Date): string {
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
}

/**
 * Cache `Intl.DateTimeFormat` instances per zone.
 *
 * Constructing one is expensive (it loads locale/zone data), and the world-clock
 * list rebuilt three per row every second — visible jank with a handful of clocks
 * (L4). A formatter is immutable and reusable across instants, so one per zone per
 * shape is kept in a module `Map` and only the `.format(date)` call runs per tick.
 */
function cachedFormatter(
  cache: Map<string, Intl.DateTimeFormat>,
  timeZone: string,
  make: () => Intl.DateTimeFormat
): Intl.DateTimeFormat {
  let fmt = cache.get(timeZone)
  if (!fmt) {
    fmt = make()
    cache.set(timeZone, fmt)
  }
  return fmt
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>()
const dateFormatters = new Map<string, Intl.DateTimeFormat>()
const offsetFormatters = new Map<string, Intl.DateTimeFormat>()

/** Time-of-day in a given IANA zone, e.g. "14:07:52". */
export function formatTimeInZone(date: Date, timeZone: string): string {
  return cachedFormatter(
    timeFormatters,
    timeZone,
    () =>
      new Intl.DateTimeFormat(undefined, {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      })
  ).format(date)
}

/** Date-of-day in a given IANA zone, e.g. "Sat, Jul 18". */
export function formatDateInZone(date: Date, timeZone: string): string {
  return cachedFormatter(
    dateFormatters,
    timeZone,
    () =>
      new Intl.DateTimeFormat(undefined, {
        timeZone,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
  ).format(date)
}

/** UTC offset label for a zone at a given instant, e.g. "GMT+05:30". */
export function formatUtcOffset(date: Date, timeZone: string): string {
  const parts = cachedFormatter(
    offsetFormatters,
    timeZone,
    () => new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
  ).formatToParts(date)
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone
}
