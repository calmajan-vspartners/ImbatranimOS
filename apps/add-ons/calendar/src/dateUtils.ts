import dayjs, { type Dayjs } from 'dayjs'

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** Every hour of a day, 0..23. */
export const HOURS = Array.from({ length: 24 }, (_, i) => i)

/** Pixel height of one hour row in the week view's time grid. */
export const HOUR_HEIGHT = 48

/**
 * The Sunday-first 6-row grid (42 days) that covers `anchor`'s month,
 * including leading/trailing days borrowed from neighboring months so every
 * row is full.
 */
export function buildMonthGrid(anchor: Dayjs): Dayjs[][] {
  const startOfMonth = anchor.startOf('month')
  const gridStart = startOfMonth.subtract(startOfMonth.day(), 'day')

  const weeks: Dayjs[][] = []
  let cursor = gridStart
  for (let w = 0; w < 6; w++) {
    const week: Dayjs[] = []
    for (let d = 0; d < 7; d++) {
      week.push(cursor)
      cursor = cursor.add(1, 'day')
    }
    weeks.push(week)
  }
  return weeks
}

/** The 7 days (Sunday-first) of the week containing `anchor`. */
export function buildWeekDays(anchor: Dayjs): Dayjs[] {
  const start = anchor.startOf('week')
  return Array.from({ length: 7 }, (_, i) => start.add(i, 'day'))
}

/**
 * Wall-clock minutes into the day for `ms` — `hour*60 + minute`.
 *
 * NOT elapsed minutes since midnight: the week grid is 24 fixed-height slots of
 * one wall-hour each, positioned by hour label. On a DST day, elapsed minutes and
 * wall-clock minutes diverge by an hour (a 23- or 25-hour day), which would place
 * or size events an hour off and overflow the grid. Positioning from the wall
 * components keeps events aligned with the hour labels they sit beside.
 */
export function minutesSinceMidnight(ms: number): number {
  const d = dayjs(ms)
  return d.hour() * 60 + d.minute()
}

export function formatHourLabel(hour: number): string {
  if (hour === 0) return '12 AM'
  if (hour === 12) return '12 PM'
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`
}
