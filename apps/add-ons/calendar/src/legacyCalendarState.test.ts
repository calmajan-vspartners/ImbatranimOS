import dayjs from 'dayjs'
import { describe, expect, it } from 'vitest'
import { describeMigration, readLegacyCalendarState } from './legacyCalendarState'

/** What zustand's persist middleware actually wrote. */
function persisted(state: unknown): string {
  return JSON.stringify({ state, version: 0 })
}

const START = dayjs('2026-07-06T09:00').valueOf()
const END = dayjs('2026-07-06T10:00').valueOf()

describe('readLegacyCalendarState', () => {
  it('reads a realistic payload from the old app', () => {
    // Exactly the shape calendarStore.ts produced: uuid ids, a reminderFired
    // flag, optional notes.
    const raw = persisted({
      events: [
        {
          id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
          title: 'Dentist',
          start: START,
          end: END,
          allDay: false,
          notes: 'bring the form',
          reminderMinutes: 30,
          reminderFired: true,
        },
        {
          id: 'b1f4e1ba-0000-4000-8000-000000000001',
          title: 'Holiday',
          start: dayjs('2026-08-01T00:00').valueOf(),
          end: dayjs('2026-08-09T23:59:59').valueOf(),
          allDay: true,
          reminderFired: false,
        },
      ],
    })
    const legacy = readLegacyCalendarState(raw)
    expect(legacy?.skipped).toBe(0)
    expect(legacy?.events).toEqual([
      {
        title: 'Dentist',
        start: START,
        end: END,
        allDay: false,
        notes: 'bring the form',
        reminderMinutes: 30,
        recurrence: null,
        exceptions: [],
      },
      {
        title: 'Holiday',
        start: dayjs('2026-08-01T00:00').valueOf(),
        end: dayjs('2026-08-09T23:59:59').valueOf(),
        allDay: true,
        recurrence: null,
        exceptions: [],
      },
    ])
  })

  it('drops the persisted reminderFired flag', () => {
    // It is deliberately not carried over: the guard is now per occurrence and
    // session-scoped, and a persisted flag would silence a series after one ring.
    const raw = persisted({
      events: [{ id: 'a', title: 'x', start: START, end: END, reminderFired: true }],
    })
    expect(readLegacyCalendarState(raw)?.events[0]).not.toHaveProperty('reminderFired')
  })

  it('accepts the bare shape too', () => {
    const raw = JSON.stringify({ events: [{ id: 'a', title: 'Bare', start: START, end: END }] })
    expect(readLegacyCalendarState(raw)?.events).toHaveLength(1)
  })

  it('has nothing to say about a missing, empty or unparseable key', () => {
    expect(readLegacyCalendarState(null)).toBeNull()
    expect(readLegacyCalendarState('')).toBeNull()
    expect(readLegacyCalendarState('{"state":{')).toBeNull()
    expect(readLegacyCalendarState('"a string"')).toBeNull()
    expect(readLegacyCalendarState(persisted({}))).toBeNull()
    expect(readLegacyCalendarState(persisted({ events: [] }))).toBeNull()
    expect(readLegacyCalendarState(persisted({ events: 'nope' }))).toBeNull()
  })

  it('counts entries it cannot use instead of dropping them silently', () => {
    const raw = persisted({
      events: [
        { id: 'a', title: '', start: START },
        { id: 'b', start: START },
        { id: 'c', title: 'No start' },
        { id: 'd', title: 'Bad start', start: 'yesterday' },
        null,
        'nope',
        { id: 'e', title: 'Fine', start: START, end: END },
      ],
    })
    const legacy = readLegacyCalendarState(raw)
    expect(legacy?.events).toHaveLength(1)
    expect(legacy?.skipped).toBe(6)
  })

  it('repairs an end that is missing or before the start rather than losing the event', () => {
    const raw = persisted({
      events: [
        { id: 'a', title: 'No end', start: START },
        { id: 'b', title: 'Backwards', start: START, end: START - 5000 },
      ],
    })
    const legacy = readLegacyCalendarState(raw)!
    expect(legacy.events[0].end - legacy.events[0].start).toBe(60 * 60_000)
    expect(legacy.events[1].end - legacy.events[1].start).toBe(60 * 60_000)
    expect(legacy.skipped).toBe(0)
  })

  it('drops a nonsense reminder rather than failing the event', () => {
    const raw = persisted({
      events: [
        { id: 'a', title: 'Zero', start: START, end: END, reminderMinutes: 0 },
        { id: 'b', title: 'Huge', start: START, end: END, reminderMinutes: 999_999 },
        { id: 'c', title: 'Text', start: START, end: END, reminderMinutes: '15' },
      ],
    })
    const legacy = readLegacyCalendarState(raw)
    expect(legacy?.events).toHaveLength(3)
    for (const event of legacy!.events) expect(event.reminderMinutes).toBeUndefined()
  })

  it('caps a title at the length the backend accepts', () => {
    const raw = persisted({
      events: [{ id: 'a', title: 'x'.repeat(900), start: START, end: END }],
    })
    expect(readLegacyCalendarState(raw)?.events[0].title).toHaveLength(300)
  })

  it('migrates every event as a one-off, since the old model had no recurrence', () => {
    const raw = persisted({
      events: [{ id: 'a', title: 'x', start: START, end: END, recurrence: 'weekly' }],
    })
    expect(readLegacyCalendarState(raw)?.events[0].recurrence).toBeNull()
  })
})

describe('describeMigration', () => {
  it('counts in singular and plural', () => {
    expect(describeMigration(1)).toContain('1 event ')
    expect(describeMigration(12)).toContain('12 events')
  })
})
