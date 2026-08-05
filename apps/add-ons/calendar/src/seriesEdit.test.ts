import dayjs from 'dayjs'
import { describe, expect, it } from 'vitest'
import { expandOccurrences } from './recurrence'
import { needsScopeChoice, occurrenceOf, planDelete, planEdit } from './seriesEdit'
import type { CalendarEvent } from './types'
import type { EditedFields as Fields } from './seriesEdit'

const at = (iso: string): number => dayjs(iso).valueOf()

/** Mon 2026-07-06 09:00–09:30, weekly on Mondays. */
function series(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 7,
    title: 'Standup',
    start: at('2026-07-06T09:00'),
    end: at('2026-07-06T09:30'),
    allDay: false,
    recurrence: { freq: 'weekly', interval: 1 },
    exceptions: [],
    ...over,
  }
}

function oneOff(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return series({ recurrence: null, ...over })
}

/** The dialog's output for an occurrence, as absolute instants. */
function edited(start: string, end: string, over: Partial<Fields> = {}): Fields {
  return {
    title: 'Standup',
    start: at(start),
    end: at(end),
    allDay: false,
    ...over,
  }
}

/** The third Monday of the series. */
const third = { start: at('2026-07-20T09:00'), index: 2, date: '2026-07-20' }

describe('needsScopeChoice', () => {
  it('only asks when there is a series to ask about', () => {
    expect(needsScopeChoice(series())).toBe(true)
    expect(needsScopeChoice(oneOff())).toBe(false)
  })
})

describe('a one-off event', () => {
  it('is just a patch, whatever scope is passed', () => {
    const e = oneOff()
    const plan = planEdit(
      e,
      occurrenceOf(e, e.start),
      edited('2026-07-06T10:00', '2026-07-06T11:00'),
      'all'
    )
    expect(plan.create).toBeUndefined()
    expect(plan.deleteOriginal).toBeUndefined()
    expect(plan.patch).toMatchObject({ start: at('2026-07-06T10:00'), recurrence: null })
  })

  it('is deleted outright', () => {
    const e = oneOff()
    expect(planDelete(e, occurrenceOf(e, e.start), 'all')).toEqual({ deleteOriginal: true })
  })
})

describe('scope: all', () => {
  it('moves the whole series by the delta, keeping earlier occurrences', () => {
    // Open the THIRD Monday, change 09:00 to 10:00, apply to all. The series must
    // still start on 2026-07-06 — at 10:00. Setting start to the edited
    // occurrence would silently delete the first two occurrences.
    const e = series()
    const plan = planEdit(
      e,
      occurrenceOf(e, third.start, third.index),
      edited('2026-07-20T10:00', '2026-07-20T10:45'),
      'all'
    )
    expect(plan.create).toBeUndefined()
    const patch = plan.patch!
    expect(dayjs(patch.start).format('YYYY-MM-DD HH:mm')).toBe('2026-07-06 10:00')
    expect(patch.end! - patch.start!).toBe(45 * 60_000)
    expect(plan.patch?.recurrence).toEqual({ freq: 'weekly', interval: 1 })
  })

  it('shifts the series when the date moves too', () => {
    // Third Monday dragged to the Tuesday after it: the whole series shifts a day.
    const e = series()
    const plan = planEdit(
      e,
      occurrenceOf(e, third.start, third.index),
      edited('2026-07-21T09:00', '2026-07-21T09:30'),
      'all'
    )
    expect(dayjs(plan.patch?.start).format('YYYY-MM-DD')).toBe('2026-07-07')
  })

  it('leaves the first occurrence exactly where it was when only the title changed', () => {
    const e = series()
    const plan = planEdit(
      e,
      occurrenceOf(e, third.start, third.index),
      edited('2026-07-20T09:00', '2026-07-20T09:30', { title: 'Renamed' }),
      'all'
    )
    expect(plan.patch?.start).toBe(e.start)
    expect(plan.patch?.title).toBe('Renamed')
  })

  it('can replace the rule itself', () => {
    const e = series()
    const plan = planEdit(
      e,
      occurrenceOf(e, e.start),
      edited('2026-07-06T09:00', '2026-07-06T09:30', {
        recurrence: { freq: 'daily', interval: 2 },
      }),
      'all'
    )
    expect(plan.patch?.recurrence).toEqual({ freq: 'daily', interval: 2 })
  })

  it('deletes the whole series', () => {
    const e = series()
    expect(planDelete(e, occurrenceOf(e, third.start, third.index), 'all')).toEqual({
      deleteOriginal: true,
    })
  })
})

describe('scope: single — detach', () => {
  it('excepts the instance and creates a standalone event', () => {
    const e = series()
    const plan = planEdit(
      e,
      occurrenceOf(e, third.start, third.index),
      edited('2026-07-20T14:00', '2026-07-20T15:00', { title: 'Moved once' }),
      'single'
    )
    expect(plan.patch?.exceptions).toEqual(['2026-07-20'])
    expect(plan.create).toMatchObject({
      title: 'Moved once',
      start: at('2026-07-20T14:00'),
      recurrence: null,
      exceptions: [],
    })
  })

  it('keeps exceptions that were already there', () => {
    const e = series({ exceptions: ['2026-07-13'] })
    const plan = planEdit(
      e,
      occurrenceOf(e, third.start, third.index),
      edited('2026-07-20T14:00', '2026-07-20T15:00'),
      'single'
    )
    expect(plan.patch?.exceptions).toEqual(['2026-07-13', '2026-07-20'])
  })

  it('the rest of the series is untouched — verified by expanding it', () => {
    const e = series()
    const plan = planEdit(
      e,
      occurrenceOf(e, third.start, third.index),
      edited('2026-07-20T14:00', '2026-07-20T15:00'),
      'single'
    )
    const after: CalendarEvent = { ...e, exceptions: plan.patch!.exceptions! }
    const dates = expandOccurrences(after, at('2026-07-01'), at('2026-08-15')).map(
      (o) => o.occurrenceDate
    )
    expect(dates).toEqual(['2026-07-06', '2026-07-13', '2026-07-27', '2026-08-03', '2026-08-10'])
  })

  it('delete-single is just the exception, with nothing created', () => {
    const e = series()
    const plan = planDelete(e, occurrenceOf(e, third.start, third.index), 'single')
    expect(plan).toEqual({ patch: { exceptions: ['2026-07-20'] } })
  })
})

describe('scope: following — split', () => {
  it('ends the original the day before and starts a new series', () => {
    const e = series()
    const plan = planEdit(
      e,
      occurrenceOf(e, third.start, third.index),
      edited('2026-07-20T10:00', '2026-07-20T11:00', { title: 'New time' }),
      'following'
    )
    expect(plan.patch?.recurrence).toMatchObject({ until: '2026-07-19', count: undefined })
    expect(plan.create).toMatchObject({
      title: 'New time',
      start: at('2026-07-20T10:00'),
      recurrence: { freq: 'weekly', interval: 1 },
    })
  })

  it('the two halves together cover the original dates, once each', () => {
    const e = series()
    const plan = planEdit(
      e,
      occurrenceOf(e, third.start, third.index),
      edited('2026-07-20T10:00', '2026-07-20T11:00'),
      'following'
    )
    const head: CalendarEvent = { ...e, ...plan.patch } as CalendarEvent
    const tail: CalendarEvent = { id: 99, exceptions: [], ...plan.create } as CalendarEvent
    const window = [at('2026-07-01'), at('2026-08-15')] as const
    const headDates = expandOccurrences(head, ...window).map((o) => o.occurrenceDate)
    const tailDates = expandOccurrences(tail, ...window).map((o) => o.occurrenceDate)
    expect(headDates).toEqual(['2026-07-06', '2026-07-13'])
    expect(tailDates).toEqual(['2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10'])
    // No date appears in both halves, and none is lost.
    expect(new Set([...headDates, ...tailDates]).size).toBe(headDates.length + tailDates.length)
    expect([...headDates, ...tailDates]).toEqual(
      expandOccurrences(e, ...window).map((o) => o.occurrenceDate)
    )
  })

  it('splitting at the first occurrence is the same as "all"', () => {
    // Truncating the original to end before its own start would leave an empty
    // series behind, so this case must collapse.
    const e = series()
    const plan = planEdit(
      e,
      occurrenceOf(e, e.start, 0),
      edited('2026-07-06T10:00', '2026-07-06T11:00'),
      'following'
    )
    expect(plan.create).toBeUndefined()
    expect(dayjs(plan.patch?.start).format('YYYY-MM-DD HH:mm')).toBe('2026-07-06 10:00')
  })

  it('splits a counted series into the right two counts', () => {
    // 10 occurrences split at the third: two before, eight from here on.
    const e = series({ recurrence: { freq: 'weekly', interval: 1, count: 10 } })
    const plan = planEdit(
      e,
      occurrenceOf(e, third.start, third.index),
      edited('2026-07-20T10:00', '2026-07-20T11:00'),
      'following'
    )
    expect(plan.patch?.recurrence).toMatchObject({ until: '2026-07-19', count: undefined })
    expect(plan.create?.recurrence).toMatchObject({ count: 8 })

    const head: CalendarEvent = { ...e, ...plan.patch } as CalendarEvent
    const tail: CalendarEvent = { id: 99, exceptions: [], ...plan.create } as CalendarEvent
    const headDates = expandOccurrences(head, at('2026-07-01'), at('2027-01-01'))
    const tailDates = expandOccurrences(tail, at('2026-07-01'), at('2027-01-01'))
    // Still ten in total, which is what the user asked for when they said "10 times".
    expect(headDates.length + tailDates.length).toBe(10)
  })

  it('carries the original end limit onto the tail', () => {
    const e = series({ recurrence: { freq: 'weekly', interval: 1, until: '2026-09-30' } })
    const plan = planEdit(
      e,
      occurrenceOf(e, third.start, third.index),
      edited('2026-07-20T10:00', '2026-07-20T11:00'),
      'following'
    )
    expect(plan.create?.recurrence).toMatchObject({ until: '2026-09-30' })
  })

  it('sends each existing exception to the half that still contains it', () => {
    const e = series({ exceptions: ['2026-07-13', '2026-07-27'] })
    const plan = planEdit(
      e,
      occurrenceOf(e, third.start, third.index),
      edited('2026-07-20T10:00', '2026-07-20T11:00'),
      'following'
    )
    expect(plan.patch?.exceptions).toEqual(['2026-07-13'])
    expect(plan.create?.exceptions).toEqual(['2026-07-27'])
  })

  it('delete-following truncates without creating anything', () => {
    const e = series()
    const plan = planDelete(e, occurrenceOf(e, third.start, third.index), 'following')
    expect(plan.create).toBeUndefined()
    expect(plan.patch?.recurrence).toMatchObject({ until: '2026-07-19' })
  })

  it('delete-following from the first occurrence deletes the series', () => {
    const e = series()
    expect(planDelete(e, occurrenceOf(e, e.start, 0), 'following')).toEqual({
      deleteOriginal: true,
    })
  })
})

describe('occurrenceOf', () => {
  it('recognises the first occurrence by date', () => {
    const e = series()
    expect(occurrenceOf(e, e.start).isFirst).toBe(true)
    expect(occurrenceOf(e, third.start, 2).isFirst).toBe(false)
    expect(occurrenceOf(e, third.start, 2).occurrenceDate).toBe('2026-07-20')
  })
})
