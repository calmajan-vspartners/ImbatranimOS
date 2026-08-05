/**
 * Due dates: how they are encoded, when a todo is late, and what the row says.
 *
 * **A due date is stored as the instant the todo is actually due**, not as the day
 * it belongs to. A date-only due date therefore lands on `23:59:59.999` of that
 * day, and "is it overdue?" is a plain `dueAt < now` — no inference, no special
 * case, and correct across a day boundary by construction. The alternative
 * (storing midnight and remembering to treat it as end-of-day) puts that
 * reasoning into every caller, which is where off-by-a-day bugs live.
 *
 * The consequence is that *display* needs the inference instead: a value whose
 * time is exactly `23:59:59.999` is shown as a bare date, anything else with its
 * time. Someone who deliberately picks 23:59 gets a date-only label, which is off
 * by a minute in the label only — a far cheaper mistake than being off by a day in
 * the comparison.
 *
 * No `dayjs` here. Todo has no date dependency and does not need one for day
 * arithmetic plus `Intl`.
 */

import type { Todo } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

/** Local midnight of the day containing `ms`. */
export function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** The last representable instant of the day containing `ms`. */
export function endOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

/**
 * Turn the dialog's `YYYY-MM-DD` (+ optional `HH:mm`) into a due instant.
 *
 * Returns null for an empty or unparseable date, so a half-typed field never
 * becomes a due date of NaN.
 */
export function dueAtFromInput(date: string, time?: string): number | null {
  if (!date) return null
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return null
  if (time) {
    const [hh, mm] = time.split(':').map(Number)
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
    const withTime = new Date(y, m - 1, d, hh, mm, 0, 0)
    return Number.isNaN(withTime.getTime()) ? null : withTime.getTime()
  }
  const dayEnd = new Date(y, m - 1, d, 23, 59, 59, 999)
  return Number.isNaN(dayEnd.getTime()) ? null : dayEnd.getTime()
}

/** The `YYYY-MM-DD` a due instant belongs to, for the date input. */
export function dateInputValue(dueAt: number): string {
  const d = new Date(dueAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The `HH:mm` for the time input, or '' when the due date carries no time. */
export function timeInputValue(dueAt: number): string {
  if (isDateOnly(dueAt)) return ''
  const d = new Date(dueAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** True when the instant is the end of its day — the date-only encoding. */
export function isDateOnly(dueAt: number): boolean {
  return dueAt === endOfDay(dueAt)
}

/**
 * Late, and not already done.
 *
 * A completed todo is never overdue however long it sat there: overdue is a call
 * to action, and there is nothing left to do.
 */
export function isOverdue(todo: Pick<Todo, 'dueAt' | 'completed'>, now: number): boolean {
  return !todo.completed && todo.dueAt !== null && todo.dueAt < now
}

/** Due today (and not yet late). Drives the "today" emphasis, not the error one. */
export function isDueToday(todo: Pick<Todo, 'dueAt' | 'completed'>, now: number): boolean {
  if (todo.completed || todo.dueAt === null) return false
  return startOfDay(todo.dueAt) === startOfDay(now) && todo.dueAt >= now
}

/** Whole days from `now`'s day to `dueAt`'s day. Negative when late. */
export function daysUntil(dueAt: number, now: number): number {
  return Math.round((startOfDay(dueAt) - startOfDay(now)) / DAY_MS)
}

const DATE_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const DATE_YEAR_FMT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

function timeOf(dueAt: number): string {
  const d = new Date(dueAt)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * What the row shows next to a due date.
 *
 * Relative for the days either side of today, because "Tomorrow" is what a person
 * actually wants to read; absolute beyond that, because "in 9 days" is not.
 */
export function dueLabel(dueAt: number, now: number): string {
  const days = daysUntil(dueAt, now)
  const withTime = !isDateOnly(dueAt)

  if (days === 0) return withTime ? `Today ${timeOf(dueAt)}` : 'Today'
  if (days === 1) return withTime ? `Tomorrow ${timeOf(dueAt)}` : 'Tomorrow'
  if (days === -1) return withTime ? `Yesterday ${timeOf(dueAt)}` : 'Yesterday'
  if (days < -1) return `${Math.abs(days)} days late`

  const sameYear = new Date(dueAt).getFullYear() === new Date(now).getFullYear()
  const date = sameYear ? DATE_FMT.format(dueAt) : DATE_YEAR_FMT.format(dueAt)
  return withTime ? `${date} ${timeOf(dueAt)}` : date
}
