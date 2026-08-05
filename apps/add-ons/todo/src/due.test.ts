import { describe, expect, it } from 'vitest'
import {
  dateInputValue,
  daysUntil,
  dueAtFromInput,
  dueLabel,
  endOfDay,
  isDateOnly,
  isDueToday,
  isOverdue,
  startOfDay,
  timeInputValue,
} from './due'

/** Local-time helper, matching how the app builds instants. */
const at = (y: number, m: number, d: number, h = 0, min = 0): number =>
  new Date(y, m - 1, d, h, min, 0, 0).getTime()

const MONDAY_NOON = at(2026, 7, 20, 12, 0)

describe('the date-only encoding', () => {
  it('stores a bare date as the END of that day, not midnight', () => {
    // This is the whole reason the overdue check needs no special case.
    const due = dueAtFromInput('2026-07-20')!
    expect(new Date(due).getHours()).toBe(23)
    expect(new Date(due).getMinutes()).toBe(59)
    expect(isDateOnly(due)).toBe(true)
  })

  it('stores a date with a time exactly as given', () => {
    const due = dueAtFromInput('2026-07-20', '17:30')!
    expect(new Date(due).getHours()).toBe(17)
    expect(new Date(due).getMinutes()).toBe(30)
    expect(isDateOnly(due)).toBe(false)
  })

  it('round-trips through the input fields', () => {
    const bare = dueAtFromInput('2026-07-20')!
    expect(dateInputValue(bare)).toBe('2026-07-20')
    expect(timeInputValue(bare)).toBe('')

    const timed = dueAtFromInput('2026-07-20', '09:05')!
    expect(dateInputValue(timed)).toBe('2026-07-20')
    expect(timeInputValue(timed)).toBe('09:05')
  })

  it('refuses input that is not a date rather than producing NaN', () => {
    expect(dueAtFromInput('')).toBeNull()
    expect(dueAtFromInput('not-a-date')).toBeNull()
    expect(dueAtFromInput('2026-07')).toBeNull()
    expect(dueAtFromInput('2026-07-20', 'noon')).toBeNull()
  })
})

describe('startOfDay / endOfDay', () => {
  it('bracket the local day', () => {
    expect(new Date(startOfDay(MONDAY_NOON)).getHours()).toBe(0)
    expect(new Date(endOfDay(MONDAY_NOON)).getHours()).toBe(23)
    expect(endOfDay(MONDAY_NOON) - startOfDay(MONDAY_NOON)).toBe(86_399_999)
  })
})

describe('isOverdue across a day boundary', () => {
  const bareToday = { dueAt: dueAtFromInput('2026-07-20'), completed: false }

  it('is not overdue at any point during its own day', () => {
    // The bug a midnight encoding produces: a todo due "today" reads as late from
    // 00:01 onwards.
    expect(isOverdue(bareToday, at(2026, 7, 20, 0, 1))).toBe(false)
    expect(isOverdue(bareToday, at(2026, 7, 20, 12, 0))).toBe(false)
    expect(isOverdue(bareToday, at(2026, 7, 20, 23, 59))).toBe(false)
  })

  it('is overdue the moment the day ends', () => {
    expect(isOverdue(bareToday, at(2026, 7, 21, 0, 0))).toBe(true)
    expect(isOverdue(bareToday, at(2026, 7, 25, 9, 0))).toBe(true)
  })

  it('respects a time of day when one was given', () => {
    const timed = { dueAt: dueAtFromInput('2026-07-20', '17:00'), completed: false }
    expect(isOverdue(timed, at(2026, 7, 20, 16, 59))).toBe(false)
    expect(isOverdue(timed, at(2026, 7, 20, 17, 1))).toBe(true)
  })

  it('never flags a completed todo, however late', () => {
    expect(isOverdue({ ...bareToday, completed: true }, at(2027, 1, 1))).toBe(false)
  })

  it('never flags a todo with no due date', () => {
    expect(isOverdue({ dueAt: null, completed: false }, MONDAY_NOON)).toBe(false)
  })
})

describe('isDueToday', () => {
  it('is true for the rest of today only', () => {
    const bare = { dueAt: dueAtFromInput('2026-07-20'), completed: false }
    expect(isDueToday(bare, at(2026, 7, 20, 8, 0))).toBe(true)
    expect(isDueToday(bare, at(2026, 7, 19, 8, 0))).toBe(false)
    expect(isDueToday(bare, at(2026, 7, 21, 8, 0))).toBe(false)
  })

  it('stops being "due today" once the moment has passed', () => {
    // A 09:00 todo at 10:00 is overdue, not upcoming — the two states are
    // exclusive so a row cannot be styled both ways.
    const timed = { dueAt: dueAtFromInput('2026-07-20', '09:00'), completed: false }
    expect(isDueToday(timed, at(2026, 7, 20, 8, 0))).toBe(true)
    expect(isDueToday(timed, at(2026, 7, 20, 10, 0))).toBe(false)
    expect(isOverdue(timed, at(2026, 7, 20, 10, 0))).toBe(true)
  })

  it('ignores completed and undated todos', () => {
    const bare = dueAtFromInput('2026-07-20')
    expect(isDueToday({ dueAt: bare, completed: true }, MONDAY_NOON)).toBe(false)
    expect(isDueToday({ dueAt: null, completed: false }, MONDAY_NOON)).toBe(false)
  })
})

describe('daysUntil', () => {
  it('counts calendar days, not 24-hour blocks', () => {
    // 23:00 today to 01:00 tomorrow is two hours and one day.
    expect(daysUntil(at(2026, 7, 21, 1, 0), at(2026, 7, 20, 23, 0))).toBe(1)
    expect(daysUntil(at(2026, 7, 20, 1, 0), at(2026, 7, 20, 23, 0))).toBe(0)
    expect(daysUntil(at(2026, 7, 18), MONDAY_NOON)).toBe(-2)
  })
})

describe('dueLabel', () => {
  it('is relative for the days around today', () => {
    expect(dueLabel(dueAtFromInput('2026-07-20')!, MONDAY_NOON)).toBe('Today')
    expect(dueLabel(dueAtFromInput('2026-07-21')!, MONDAY_NOON)).toBe('Tomorrow')
    expect(dueLabel(dueAtFromInput('2026-07-19')!, MONDAY_NOON)).toBe('Yesterday')
  })

  it('counts the days when something is properly late', () => {
    expect(dueLabel(dueAtFromInput('2026-07-17')!, MONDAY_NOON)).toBe('3 days late')
    expect(dueLabel(dueAtFromInput('2026-07-10', '09:00')!, MONDAY_NOON)).toBe('10 days late')
  })

  it('is absolute further out, and adds the year when it differs', () => {
    expect(dueLabel(dueAtFromInput('2026-07-28')!, MONDAY_NOON)).toMatch(/Jul 28/)
    expect(dueLabel(dueAtFromInput('2027-01-04')!, MONDAY_NOON)).toMatch(/2027/)
  })

  it('shows a time when there is one, and hides it when there is not', () => {
    expect(dueLabel(dueAtFromInput('2026-07-20', '17:00')!, MONDAY_NOON)).toBe('Today 17:00')
    expect(dueLabel(dueAtFromInput('2026-07-21', '08:30')!, MONDAY_NOON)).toBe('Tomorrow 08:30')
    expect(dueLabel(dueAtFromInput('2026-07-28', '14:00')!, MONDAY_NOON)).toMatch(/14:00$/)
    expect(dueLabel(dueAtFromInput('2026-07-28')!, MONDAY_NOON)).not.toMatch(/\d\d:\d\d/)
  })
})
