import dayjs from 'dayjs'
import { describe, expect, it } from 'vitest'
import {
  MAX_OCCURRENCES,
  describeRule,
  expandAll,
  expandOccurrences,
  occurrencesOnDay,
  spansMultipleDays,
} from './recurrence'
import type { CalendarEvent, RecurrenceRule } from './types'

const at = (iso: string): number => dayjs(iso).valueOf()

function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 1,
    title: 'Standup',
    start: at('2026-07-06T09:00'), // a Monday
    end: at('2026-07-06T09:30'),
    allDay: false,
    recurrence: null,
    exceptions: [],
    ...over,
  }
}

const rule = (over: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  freq: 'weekly',
  interval: 1,
  ...over,
})

/** The dates an expansion produced, for compact assertions. */
const dates = (event: CalendarEvent, from: string, to: string): string[] =>
  expandOccurrences(event, at(from), at(to)).map((o) => o.occurrenceDate)

describe('a one-off event', () => {
  it('yields itself when it overlaps the range', () => {
    const e = event()
    expect(dates(e, '2026-07-01T00:00', '2026-08-01T00:00')).toEqual(['2026-07-06'])
  })

  it('yields nothing outside the range', () => {
    const e = event()
    expect(dates(e, '2026-08-01T00:00', '2026-09-01T00:00')).toEqual([])
    expect(dates(e, '2026-06-01T00:00', '2026-07-01T00:00')).toEqual([])
  })

  it('overlaps rather than being contained — a multi-day event that began earlier counts', () => {
    // The bug the views had: filtering on the start day alone made a three-day
    // event visible only on its first day.
    const e = event({ start: at('2026-06-29T00:00'), end: at('2026-07-02T23:59'), allDay: true })
    expect(dates(e, '2026-07-01T00:00', '2026-08-01T00:00')).toEqual(['2026-06-29'])
  })

  it('carries its own duration', () => {
    const [o] = expandOccurrences(event(), at('2026-07-01'), at('2026-08-01'))
    expect(o.end - o.start).toBe(30 * 60_000)
    expect(o.isRepeat).toBe(false)
    expect(o.index).toBe(0)
  })
})

describe('daily', () => {
  it('repeats every day', () => {
    const e = event({ recurrence: rule({ freq: 'daily' }) })
    expect(dates(e, '2026-07-06T00:00', '2026-07-11T00:00')).toEqual([
      '2026-07-06',
      '2026-07-07',
      '2026-07-08',
      '2026-07-09',
      '2026-07-10',
    ])
  })

  it('honours an interval', () => {
    const e = event({ recurrence: rule({ freq: 'daily', interval: 3 }) })
    expect(dates(e, '2026-07-06T00:00', '2026-07-16T00:00')).toEqual([
      '2026-07-06',
      '2026-07-09',
      '2026-07-12',
      '2026-07-15',
    ])
  })

  it('keeps the time of day', () => {
    const e = event({ recurrence: rule({ freq: 'daily' }) })
    const [, second] = expandOccurrences(e, at('2026-07-06'), at('2026-07-09'))
    expect(dayjs(second.start).format('YYYY-MM-DD HH:mm')).toBe('2026-07-07 09:00')
    expect(second.end - second.start).toBe(30 * 60_000)
  })
})

describe('weekly by weekday', () => {
  it('crosses a month boundary correctly', () => {
    // Mon/Wed/Fri from Mon 2026-07-06 into August.
    const e = event({ recurrence: rule({ byWeekday: [1, 3, 5] }) })
    expect(dates(e, '2026-07-27T00:00', '2026-08-08T00:00')).toEqual([
      '2026-07-27',
      '2026-07-29',
      '2026-07-31',
      '2026-08-03',
      '2026-08-05',
      '2026-08-07',
    ])
  })

  it('never emits an instance before the series starts', () => {
    // The start is a Wednesday; Monday of that same week must not appear.
    const e = event({
      start: at('2026-07-08T09:00'),
      end: at('2026-07-08T09:30'),
      recurrence: rule({ byWeekday: [1, 3] }),
    })
    expect(dates(e, '2026-07-01T00:00', '2026-07-16T00:00')).toEqual([
      '2026-07-08',
      '2026-07-13',
      '2026-07-15',
    ])
  })

  it('defaults to the start day when no weekdays are given', () => {
    const e = event({ recurrence: rule() })
    expect(dates(e, '2026-07-06T00:00', '2026-07-28T00:00')).toEqual([
      '2026-07-06',
      '2026-07-13',
      '2026-07-20',
      '2026-07-27',
    ])
  })

  it('skips whole weeks on an interval', () => {
    const e = event({ recurrence: rule({ interval: 2, byWeekday: [1, 5] }) })
    expect(dates(e, '2026-07-06T00:00', '2026-08-01T00:00')).toEqual([
      '2026-07-06',
      '2026-07-10',
      '2026-07-20',
      '2026-07-24',
    ])
  })
})

describe('monthly by date', () => {
  it('skips a month that is too short rather than sliding the date', () => {
    // The 31st, monthly, from January: February, April, June, September and
    // November have no 31st and produce nothing at all.
    const e = event({
      start: at('2026-01-31T10:00'),
      end: at('2026-01-31T11:00'),
      recurrence: rule({ freq: 'monthly' }),
    })
    expect(dates(e, '2026-01-01T00:00', '2026-07-01T00:00')).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
    ])
  })

  it('a month too short to hold the date does not consume a count', () => {
    // Four occurrences of "the 31st" from January is Jan, Mar, May, Jul. February
    // generates nothing at all, so there is nothing for the count to count —
    // which is the opposite of an *exception*, where the instance exists and is
    // then removed (see the exceptions block below). The two look similar and are
    // not: one is "no instance was ever generated", the other is "this generated
    // instance was struck out".
    const e = event({
      start: at('2026-01-31T10:00'),
      end: at('2026-01-31T11:00'),
      recurrence: rule({ freq: 'monthly', count: 4 }),
    })
    expect(dates(e, '2026-01-01T00:00', '2027-01-01T00:00')).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
      '2026-07-31',
    ])
  })

  it('repeats a safe date every month', () => {
    const e = event({
      start: at('2026-01-15T10:00'),
      end: at('2026-01-15T11:00'),
      recurrence: rule({ freq: 'monthly' }),
    })
    expect(dates(e, '2026-01-01T00:00', '2026-05-01T00:00')).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
      '2026-04-15',
    ])
  })
})

describe('yearly', () => {
  it('repeats on the same date', () => {
    const e = event({
      start: at('2026-03-14T10:00'),
      end: at('2026-03-14T11:00'),
      recurrence: rule({ freq: 'yearly' }),
    })
    expect(dates(e, '2026-01-01T00:00', '2029-01-01T00:00')).toEqual([
      '2026-03-14',
      '2027-03-14',
      '2028-03-14',
    ])
  })

  it('a Feb 29 series happens on leap years only', () => {
    const e = event({
      start: at('2028-02-29T10:00'),
      end: at('2028-02-29T11:00'),
      recurrence: rule({ freq: 'yearly' }),
    })
    expect(dates(e, '2028-01-01T00:00', '2034-01-01T00:00')).toEqual(['2028-02-29', '2032-02-29'])
  })
})

describe('termination', () => {
  it('stops after `count` occurrences of the series, not of the window', () => {
    const e = event({ recurrence: rule({ freq: 'daily', count: 3 }) })
    expect(dates(e, '2026-07-06T00:00', '2026-08-01T00:00')).toEqual([
      '2026-07-06',
      '2026-07-07',
      '2026-07-08',
    ])
    // Asking only for the tail of the window still knows the series has ended.
    expect(dates(e, '2026-07-08T00:00', '2026-08-01T00:00')).toEqual(['2026-07-08'])
  })

  it('stops at `until`, inclusive of that whole day', () => {
    const e = event({ recurrence: rule({ freq: 'daily', until: '2026-07-09' }) })
    expect(dates(e, '2026-07-06T00:00', '2026-08-01T00:00')).toEqual([
      '2026-07-06',
      '2026-07-07',
      '2026-07-08',
      '2026-07-09',
    ])
  })

  it('caps a runaway expansion rather than building a decade of objects', () => {
    const e = event({ recurrence: rule({ freq: 'daily' }) })
    const out = expandOccurrences(e, at('2026-07-06T00:00'), at('2060-01-01T00:00'))
    expect(out).toHaveLength(MAX_OCCURRENCES)
  })

  it('still expands an old no-end rule into the current window (T1-5)', () => {
    // A daily rule that started ~800 days before the visible range would, with an
    // index-based cap, exhaust MAX_OCCURRENCES on occurrences BEFORE the window and
    // yield nothing at all. It must produce the full current month instead.
    const start = at('2024-05-01T09:00')
    // 2024-05-01 is >800 days before the 2026-08 window below.
    const e = event({ start, end: start + 30 * 60_000, recurrence: rule({ freq: 'daily' }) })
    const monthStart = '2026-08-01T00:00'
    const monthEnd = '2026-09-01T00:00'
    const out = dates(e, monthStart, monthEnd)
    expect(out).toHaveLength(31)
    expect(out[0]).toBe('2026-08-01')
    expect(out[out.length - 1]).toBe('2026-08-31')
  })
})

describe('exceptions', () => {
  it('removes just that instance', () => {
    const e = event({ recurrence: rule({ freq: 'daily' }), exceptions: ['2026-07-08'] })
    expect(dates(e, '2026-07-06T00:00', '2026-07-11T00:00')).toEqual([
      '2026-07-06',
      '2026-07-07',
      '2026-07-09',
      '2026-07-10',
    ])
  })

  it('does not renumber the occurrences after it', () => {
    // Deleting the third of a series must not promote the fourth into being the
    // third — that is why an exception is keyed by date, and why a skipped
    // instance still consumes its index.
    const e = event({ recurrence: rule({ freq: 'daily' }), exceptions: ['2026-07-08'] })
    const out = expandOccurrences(e, at('2026-07-06'), at('2026-07-11'))
    expect(out.map((o) => o.index)).toEqual([0, 1, 3, 4])
  })

  it('a skipped instance still consumes a count', () => {
    const e = event({
      recurrence: rule({ freq: 'daily', count: 4 }),
      exceptions: ['2026-07-07'],
    })
    expect(dates(e, '2026-07-06T00:00', '2026-08-01T00:00')).toEqual([
      '2026-07-06',
      '2026-07-08',
      '2026-07-09',
    ])
  })
})

describe('expandAll and the day helpers', () => {
  it('merges events in chronological order', () => {
    const a = event({
      id: 1,
      title: 'A',
      start: at('2026-07-07T14:00'),
      end: at('2026-07-07T15:00'),
    })
    const b = event({ id: 2, title: 'B', recurrence: rule({ freq: 'daily' }) })
    const out = expandAll([a, b], at('2026-07-06T00:00'), at('2026-07-09T00:00'))
    expect(out.map((o) => `${o.event.title} ${o.occurrenceDate}`)).toEqual([
      'B 2026-07-06',
      'B 2026-07-07',
      'A 2026-07-07',
      'B 2026-07-08',
    ])
  })

  it('finds every occurrence touching a day, including one that began earlier', () => {
    const multi = event({
      id: 3,
      title: 'Trip',
      start: at('2026-07-06T00:00'),
      end: at('2026-07-09T23:59'),
      allDay: true,
    })
    const out = expandAll([multi], at('2026-07-01'), at('2026-08-01'))
    for (const iso of ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09']) {
      expect(occurrencesOnDay(out, dayjs(iso))).toHaveLength(1)
    }
    expect(occurrencesOnDay(out, dayjs('2026-07-10'))).toHaveLength(0)
    expect(occurrencesOnDay(out, dayjs('2026-07-05'))).toHaveLength(0)
    expect(spansMultipleDays(out[0])).toBe(true)
  })

  it('knows a same-day event is not multi-day', () => {
    const out = expandAll([event()], at('2026-07-01'), at('2026-08-01'))
    expect(spansMultipleDays(out[0])).toBe(false)
  })
})

describe('describeRule', () => {
  it('says what the rule does, in the words the dialog shows', () => {
    expect(describeRule(null)).toBe('Does not repeat')
    expect(describeRule(rule({ freq: 'daily' }))).toBe('Daily')
    expect(describeRule(rule({ freq: 'daily', interval: 3 }))).toBe('Every 3 days')
    expect(describeRule(rule({ byWeekday: [1, 3, 5] }))).toBe('Weekly on Mon, Wed, Fri')
    expect(describeRule(rule({ interval: 2, byWeekday: [2] }))).toBe('Every 2 weeks on Tue')
    expect(describeRule(rule({ freq: 'monthly' }))).toBe('Monthly')
    expect(describeRule(rule({ freq: 'yearly' }))).toBe('Yearly')
    expect(describeRule(rule({ freq: 'daily', count: 5 }))).toBe('Daily, 5 times')
    expect(describeRule(rule({ freq: 'daily', until: '2026-12-24' }))).toBe(
      'Daily, until Dec 24, 2026'
    )
  })
})
