import dayjs from 'dayjs'
import { describe, expect, it } from 'vitest'
import {
  describeImport,
  eventsToIcs,
  icsToEvents,
  parseContentLine,
  parseIcsDate,
  rruleToRule,
  unfold,
} from './ics'
import type { CalendarEvent } from './types'

const at = (iso: string): number => dayjs(iso).valueOf()
const NOW = at('2026-07-01T12:00')

function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 1,
    title: 'Standup',
    start: at('2026-07-06T09:00'),
    end: at('2026-07-06T09:30'),
    allDay: false,
    recurrence: null,
    exceptions: [],
    ...over,
  }
}

/** The value of one property in the generated file. */
function prop(ics: string, name: string): string | undefined {
  return unfold(ics)
    .map(parseContentLine)
    .find((l) => l?.name === name)?.value
}

describe('writing', () => {
  it('produces a VCALENDAR with CRLF line endings', () => {
    const ics = eventsToIcs([event()], NOW)
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
    expect(ics).toContain('\r\n')
  })

  it('writes floating local times, with no Z and no TZID', () => {
    const ics = eventsToIcs([event()], NOW)
    expect(prop(ics, 'DTSTART')).toBe('20260706T090000')
    expect(prop(ics, 'DTEND')).toBe('20260706T093000')
    expect(ics).not.toContain('TZID')
    expect(prop(ics, 'DTSTART')).not.toContain('Z')
  })

  it('writes an all-day DTEND exclusive, as the spec requires', () => {
    // A one-day event on the 6th ends on the 7th. This is the classic off-by-one.
    const ics = eventsToIcs(
      [event({ allDay: true, start: at('2026-07-06T00:00'), end: at('2026-07-06T23:59:59') })],
      NOW
    )
    expect(ics).toContain('DTSTART;VALUE=DATE:20260706')
    expect(ics).toContain('DTEND;VALUE=DATE:20260707')
  })

  it('escapes text that would otherwise break the format', () => {
    const ics = eventsToIcs(
      [event({ title: 'Lunch; with Bob, maybe', notes: 'line1\nline2' })],
      NOW
    )
    expect(ics).toContain('SUMMARY:Lunch\\; with Bob\\, maybe')
    expect(ics).toContain('DESCRIPTION:line1\\nline2')
  })

  it('folds a long line and unfolds back to the original', () => {
    const title = 'x'.repeat(200)
    const ics = eventsToIcs([event({ title })], NOW)
    expect(ics.split('\r\n').every((l) => l.length <= 75)).toBe(true)
    expect(prop(ics, 'SUMMARY')).toBe(title)
  })

  it('folds on octets and never splits a surrogate pair (L7)', () => {
    // Emoji are 4 UTF-8 octets and one code point built from a surrogate pair.
    // Folding by UTF-16 units would exceed 75 octets and could sever a pair.
    const title = '😀'.repeat(60)
    const ics = eventsToIcs([event({ title })], NOW)
    const enc = new TextEncoder()
    for (const line of ics.split('\r\n')) {
      expect(enc.encode(line).length).toBeLessThanOrEqual(75)
      // A severed surrogate becomes U+FFFD on encode; the round-trip below also
      // proves no pair was split.
    }
    expect(prop(ics, 'SUMMARY')).toBe(title)
  })

  it('writes a reminder as a VALARM', () => {
    const ics = eventsToIcs([event({ reminderMinutes: 15 })], NOW)
    expect(ics).toContain('BEGIN:VALARM')
    expect(ics).toContain('TRIGGER:-PT15M')
  })

  it('writes the recurrence rule and its exceptions', () => {
    const ics = eventsToIcs(
      [
        event({
          recurrence: { freq: 'weekly', interval: 2, byWeekday: [1, 3, 5] },
          exceptions: ['2026-07-15'],
        }),
      ],
      NOW
    )
    expect(prop(ics, 'RRULE')).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR')
    expect(prop(ics, 'EXDATE')).toBe('20260715T090000')
  })

  it('writes UNTIL at the end of the day, so the last occurrence survives', () => {
    // Midnight would drop the final occurrence of any event not at 00:00.
    const ics = eventsToIcs(
      [event({ recurrence: { freq: 'daily', interval: 1, until: '2026-07-09' } })],
      NOW
    )
    expect(prop(ics, 'RRULE')).toBe('FREQ=DAILY;UNTIL=20260709T235959')
  })
})

describe('reading', () => {
  it('round-trips a timed event through export and import', () => {
    const original = event({ title: 'Standup', notes: 'daily sync', reminderMinutes: 10 })
    const { events, skipped } = icsToEvents(eventsToIcs([original], NOW))
    expect(skipped).toBe(0)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      title: 'Standup',
      start: original.start,
      end: original.end,
      allDay: false,
      notes: 'daily sync',
      reminderMinutes: 10,
    })
  })

  it('round-trips an all-day event without gaining or losing a day', () => {
    const original = event({
      allDay: true,
      start: at('2026-07-06T00:00'),
      end: dayjs(at('2026-07-08T00:00')).endOf('day').valueOf(),
    })
    const { events } = icsToEvents(eventsToIcs([original], NOW))
    expect(dayjs(events[0].start).format('YYYY-MM-DD')).toBe('2026-07-06')
    expect(dayjs(events[0].end).format('YYYY-MM-DD')).toBe('2026-07-08')
    expect(events[0].allDay).toBe(true)
  })

  it('round-trips a recurring event with an exception', () => {
    const original = event({
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 4], count: 8 },
      exceptions: ['2026-07-13'],
    })
    const { events } = icsToEvents(eventsToIcs([original], NOW))
    expect(events[0].recurrence).toEqual({
      freq: 'weekly',
      interval: 1,
      byWeekday: [1, 4],
      count: 8,
    })
    expect(events[0].exceptions).toEqual(['2026-07-13'])
  })

  it('converts a UTC time and reads a TZID one as local, counting it', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:UTC event',
      'DTSTART:20260706T090000Z',
      'DTEND:20260706T093000Z',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'SUMMARY:Zoned event',
      'DTSTART;TZID=America/New_York:20260706T090000',
      'DTEND;TZID=America/New_York:20260706T093000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const result = icsToEvents(ics)
    expect(result.events).toHaveLength(2)
    expect(result.events[0].start).toBe(dayjs('2026-07-06T09:00:00Z').valueOf())
    // The zoned one keeps its wall-clock reading, and the caller is told.
    expect(dayjs(result.events[1].start).format('HH:mm')).toBe('09:00')
    expect(result.timezoneFlattened).toBe(1)
  })

  it('defaults a missing DTEND to an hour, or the whole day', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:No end',
      'DTSTART:20260706T090000',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'SUMMARY:All day no end',
      'DTSTART;VALUE=DATE:20260706',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const { events } = icsToEvents(ics)
    expect(events[0].end - events[0].start).toBe(60 * 60_000)
    expect(dayjs(events[1].end).format('YYYY-MM-DD HH:mm')).toBe('2026-07-06 23:59')
  })

  it('reads DURATION when there is no DTEND', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:Ninety minutes',
      'DTSTART:20260706T090000',
      'DURATION:PT1H30M',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const { events } = icsToEvents(ics)
    expect(events[0].end - events[0].start).toBe(90 * 60_000)
  })

  it('does not mistake a VALARM description for the event notes', () => {
    const ics = eventsToIcs([event({ reminderMinutes: 30, notes: 'real notes' })], NOW)
    const { events } = icsToEvents(ics)
    expect(events[0].notes).toBe('real notes')
    expect(events[0].reminderMinutes).toBe(30)
  })

  it('keeps an event whose RRULE is too complex, and counts it', () => {
    // "Last Friday of the month" cannot be represented; approximating it as
    // "monthly on the 26th" would be wrong every month with no way to notice.
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:Last Friday',
      'DTSTART:20260731T170000',
      'DTEND:20260731T180000',
      'RRULE:FREQ=MONTHLY;BYDAY=-1FR',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const result = icsToEvents(ics)
    expect(result.events).toHaveLength(1)
    expect(result.events[0].recurrence).toBeNull()
    expect(result.recurrenceDropped).toBe(1)
  })

  it('skips a VEVENT with no title or no start, and says how many', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20260706T090000',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'SUMMARY:No start',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'SUMMARY:Fine',
      'DTSTART:20260706T090000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const result = icsToEvents(ics)
    expect(result.events).toHaveLength(1)
    expect(result.skipped).toBe(2)
  })

  it('reads a folded line back correctly', () => {
    const ics =
      'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Long tit\r\n le here\r\nDTSTART:20260706T090000\r\nEND:VEVENT\r\nEND:VCALENDAR'
    const { events } = icsToEvents(ics)
    expect(events[0].title).toBe('Long title here')
  })

  it('maps a CSS colour name onto the palette', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:Coloured',
      'DTSTART:20260706T090000',
      'COLOR:orange',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    expect(icsToEvents(ics).events[0].color).toBe('amber')
  })

  it('returns nothing for an empty or non-calendar file rather than throwing', () => {
    expect(icsToEvents('').events).toEqual([])
    expect(icsToEvents('this is not a calendar').events).toEqual([])
    expect(icsToEvents('BEGIN:VCALENDAR\r\nEND:VCALENDAR').events).toEqual([])
  })
})

describe('rruleToRule', () => {
  it('accepts the supported subset', () => {
    expect(rruleToRule('FREQ=DAILY')).toEqual({ freq: 'daily', interval: 1 })
    expect(rruleToRule('FREQ=WEEKLY;BYDAY=MO,WE')).toEqual({
      freq: 'weekly',
      interval: 1,
      byWeekday: [1, 3],
    })
    expect(rruleToRule('FREQ=MONTHLY;INTERVAL=3;COUNT=6')).toEqual({
      freq: 'monthly',
      interval: 3,
      count: 6,
    })
    expect(rruleToRule('FREQ=YEARLY;UNTIL=20301231T235959')).toEqual({
      freq: 'yearly',
      interval: 1,
      until: '2030-12-31',
    })
  })

  it('refuses what it cannot represent, instead of approximating', () => {
    expect(rruleToRule('FREQ=MONTHLY;BYDAY=-1FR')).toBeNull()
    expect(rruleToRule('FREQ=MONTHLY;BYSETPOS=1;BYDAY=MO')).toBeNull()
    expect(rruleToRule('FREQ=HOURLY')).toBeNull()
    expect(rruleToRule('FREQ=MINUTELY')).toBeNull()
    expect(rruleToRule('FREQ=YEARLY;BYMONTH=3')).toBeNull()
    expect(rruleToRule('FREQ=DAILY;INTERVAL=0')).toBeNull()
    expect(rruleToRule('nonsense')).toBeNull()
    // BYDAY on a non-weekly frequency is a positional rule in disguise.
    expect(rruleToRule('FREQ=MONTHLY;BYDAY=MO')).toBeNull()
  })
})

describe('parseIcsDate', () => {
  it('distinguishes date-only, floating and UTC', () => {
    expect(parseIcsDate('20260706')).toMatchObject({ dateOnly: true, utc: false })
    expect(parseIcsDate('20260706T090000')).toMatchObject({ dateOnly: false, utc: false })
    expect(parseIcsDate('20260706T090000Z')).toMatchObject({ dateOnly: false, utc: true })
    expect(parseIcsDate('garbage')).toBeNull()
    expect(parseIcsDate('2026-07-06')).toBeNull()
  })
})

describe('describeImport', () => {
  it('names everything that was lost', () => {
    expect(
      describeImport({ events: [], skipped: 0, recurrenceDropped: 0, timezoneFlattened: 0 })
    ).toBe('0 events imported')
    expect(
      describeImport({
        events: [1, 2, 3] as never,
        skipped: 1,
        recurrenceDropped: 2,
        timezoneFlattened: 1,
      })
    ).toBe(
      '3 events imported · 2 repeat rules too complex to keep (kept as single events) · 1 event read in your local time · 1 unreadable and skipped'
    )
  })
})
