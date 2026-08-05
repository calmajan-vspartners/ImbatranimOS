import dayjs from 'dayjs'
import type { Occurrence } from './recurrence'
import type { EventColor } from './types'

/**
 * How an event is painted, in one place.
 *
 * Kept out of the view components because the month grid, the week grid and the
 * agenda list must agree — an event that is amber in one and blue in another is
 * worse than having no colours at all. Also keeps the colour classes out of a
 * component file, which `react-refresh/only-export-components` would object to.
 */

/**
 * Border-left + background per colour. Deliberately a fixed map of literal class
 * strings rather than an interpolated `border-${color}` — Tailwind cannot see
 * constructed class names, and they would silently not exist in the bundle.
 */
const COLOR_CLASS: Record<EventColor, string> = {
  blue: 'border-l-sky-500 bg-sky-500/15',
  green: 'border-l-emerald-500 bg-emerald-500/15',
  amber: 'border-l-amber-500 bg-amber-500/15',
  red: 'border-l-rose-500 bg-rose-500/15',
  purple: 'border-l-violet-500 bg-violet-500/15',
  slate: 'border-l-slate-400 bg-slate-400/15',
}

/** The accent-tinted default, for an event with no colour of its own. */
const DEFAULT_CLASS = 'border-l-primary bg-surface-container-high'

export function eventColorClass(color: EventColor | undefined): string {
  return color ? COLOR_CLASS[color] : DEFAULT_CLASS
}

/** The swatch used by the colour picker in the dialog. */
export const COLOR_SWATCH: Record<EventColor, string> = {
  blue: 'bg-sky-500',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-rose-500',
  purple: 'bg-violet-500',
  slate: 'bg-slate-400',
}

export const COLOR_OPTIONS: EventColor[] = ['blue', 'green', 'amber', 'red', 'purple', 'slate']

/**
 * The label for one occurrence on one day.
 *
 * Multi-day events read differently depending on which day you are looking at,
 * and saying "09:00" on every day of a three-day trip is actively misleading —
 * the event does not start at 09:00 on days two and three.
 */
export function occurrenceLabel(occurrence: Occurrence, day: dayjs.Dayjs): string {
  const { event } = occurrence
  const startsToday = dayjs(occurrence.start).isSame(day, 'day')
  const endsToday = dayjs(occurrence.end).isSame(day, 'day')

  if (event.allDay) return event.title
  if (startsToday && endsToday) return `${dayjs(occurrence.start).format('HH:mm')} ${event.title}`
  if (startsToday) return `${dayjs(occurrence.start).format('HH:mm')} ${event.title} →`
  if (endsToday) return `→ ${event.title} until ${dayjs(occurrence.end).format('HH:mm')}`
  return `→ ${event.title}`
}

/** Sort for a day cell: all-day and continuing events above the timed ones. */
export function compareForDay(a: Occurrence, b: Occurrence): number {
  const rank = (o: Occurrence) => (o.event.allDay ? 0 : 1)
  return rank(a) - rank(b) || a.start - b.start || a.event.title.localeCompare(b.event.title)
}
