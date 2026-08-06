import dayjs from 'dayjs'
import type {
  CalendarEvent,
  CalendarEventInput,
  EventColor,
  Frequency,
  RecurrenceRule,
} from './types'

/**
 * iCalendar (RFC 5545) import and export.
 *
 * Why it exists: without it the data is trapped, which is the same argument that
 * put CSV in Sheets. An `.ics` file is how a calendar interoperates with anything
 * at all, and it is the only interop story this app has — CalDAV and Google sync
 * are rejected (network egress plus stored credentials, for a single-user local
 * OS).
 *
 * Two deliberate limits, both stated rather than hidden:
 *
 * - **Times are written and read as local wall-clock**, with no `TZID` and no `Z`
 *   suffix (RFC 5545 "floating" time). That is exactly what this app's model
 *   means: epoch ms interpreted in the viewer's zone, no per-event timezone. An
 *   importer that writes `Z` is honoured on the way in (converted), because other
 *   tools emit it constantly.
 * - **Import understands the subset this app can represent** and reports what it
 *   skipped rather than failing the whole file. A VEVENT with `BYSETPOS`, an
 *   RRULE frequency below DAILY, or a `RECURRENCE-ID` override lands as its own
 *   entry or is counted as skipped — never silently dropped.
 */

const PRODID = '-//ImbatranimOS//Calendar//EN'

/** RFC 5545 caps a content line at 75 octets and continues with a leading space. */
const FOLD_OCTETS = 75

const COLORS: EventColor[] = ['blue', 'green', 'amber', 'red', 'purple', 'slate']

/** Apple/Google write CSS colour names in `COLOR:`; map the ones we have. */
const CSS_TO_COLOR: Record<string, EventColor> = {
  blue: 'blue',
  green: 'green',
  darkgreen: 'green',
  orange: 'amber',
  yellow: 'amber',
  gold: 'amber',
  red: 'red',
  crimson: 'red',
  purple: 'purple',
  violet: 'purple',
  gray: 'slate',
  grey: 'slate',
  slategray: 'slate',
}

// --- writing ---------------------------------------------------------------

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** UTF-8 octet length of a single code point. */
function octetLen(codePoint: string): number {
  const c = codePoint.codePointAt(0) ?? 0
  if (c <= 0x7f) return 1
  if (c <= 0x7ff) return 2
  if (c <= 0xffff) return 3
  return 4
}

/**
 * Fold a content line at RFC 5545's 75-**octet** cap.
 *
 * Breaks only at code-point boundaries — `Array.from` iterates code points, so a
 * surrogate pair (an emoji) is never split, and a multi-byte character is never
 * severed mid-sequence. The leading space on a continuation line counts toward
 * that line's 75 octets. Slicing by UTF-16 units (the old `.slice(0, 73)`) both
 * overshoots the octet limit for non-ASCII text and can split a surrogate pair
 * into two lone halves.
 */
function fold(line: string): string {
  const out: string[] = []
  let current = ''
  let octets = 0
  for (const cp of Array.from(line)) {
    const len = octetLen(cp)
    if (octets + len > FOLD_OCTETS) {
      out.push(current)
      // A continuation line spends its first octet on the leading space.
      current = ' ' + cp
      octets = 1 + len
    } else {
      current += cp
      octets += len
    }
  }
  out.push(current)
  return out.join('\r\n')
}

/** Floating local date-time, `20260706T090000`. */
export function toIcsDateTime(ms: number): string {
  return dayjs(ms).format('YYYYMMDDTHHmmss')
}

/** Date-only value for an all-day event, `20260706`. */
export function toIcsDate(ms: number): string {
  return dayjs(ms).format('YYYYMMDD')
}

const FREQ_TO_ICS: Record<Frequency, string> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
  yearly: 'YEARLY',
}

/** Sunday-first index → RFC 5545 day name. */
const ICS_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const

export function ruleToRRule(rule: RecurrenceRule): string {
  const parts = [`FREQ=${FREQ_TO_ICS[rule.freq]}`]
  if (rule.interval > 1) parts.push(`INTERVAL=${Math.trunc(rule.interval)}`)
  if (rule.freq === 'weekly' && rule.byWeekday?.length) {
    const days = [...new Set(rule.byWeekday)]
      .sort((a, b) => a - b)
      .map((d) => ICS_DAYS[d])
      .join(',')
    parts.push(`BYDAY=${days}`)
  }
  if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`)
  // UNTIL is inclusive of the whole day in this app's model, so it is written as
  // the last instant of that day rather than midnight — midnight would drop the
  // final occurrence for any event that is not at 00:00.
  if (rule.until) parts.push(`UNTIL=${dayjs(rule.until).endOf('day').format('YYYYMMDDTHHmmss')}`)
  return parts.join(';')
}

/**
 * Serialise events to a `.ics` calendar.
 *
 * All-day events use `VALUE=DATE` with an **exclusive** DTEND, which is what RFC
 * 5545 requires and what every other tool expects: a one-day event on the 6th ends
 * on the 7th. Getting this wrong is the classic off-by-one that makes imported
 * all-day events a day short in one direction and a day long in the other.
 */
export function eventsToIcs(events: CalendarEvent[], now: number): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
  ]

  for (const event of events) {
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:imbatranimos-${event.id}@imbatranimos.local`)
    lines.push(`DTSTAMP:${toIcsDateTime(now)}`)
    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${toIcsDate(event.start)}`)
      lines.push(
        `DTEND;VALUE=DATE:${toIcsDate(dayjs(event.end).add(1, 'day').startOf('day').valueOf())}`
      )
    } else {
      lines.push(`DTSTART:${toIcsDateTime(event.start)}`)
      lines.push(`DTEND:${toIcsDateTime(event.end)}`)
    }
    lines.push(`SUMMARY:${escapeText(event.title)}`)
    if (event.notes) lines.push(`DESCRIPTION:${escapeText(event.notes)}`)
    if (event.color) lines.push(`COLOR:${event.color}`)
    if (event.recurrence) lines.push(`RRULE:${ruleToRRule(event.recurrence)}`)
    for (const date of event.exceptions) {
      const stamp = event.allDay
        ? `EXDATE;VALUE=DATE:${dayjs(date).format('YYYYMMDD')}`
        : `EXDATE:${dayjs(`${date}T${dayjs(event.start).format('HH:mm:ss')}`).format('YYYYMMDDTHHmmss')}`
      lines.push(stamp)
    }
    if (event.reminderMinutes) {
      lines.push('BEGIN:VALARM')
      lines.push('ACTION:DISPLAY')
      lines.push(`TRIGGER:-PT${event.reminderMinutes}M`)
      lines.push(`DESCRIPTION:${escapeText(event.title)}`)
      lines.push('END:VALARM')
    }
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  // CRLF is required by the spec, and some importers genuinely refuse LF-only.
  return lines.map(fold).join('\r\n') + '\r\n'
}

// --- reading ---------------------------------------------------------------

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

/** Undo RFC 5545 line folding: a line beginning with space or tab continues the previous one. */
export function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1)
    } else {
      out.push(line)
    }
  }
  return out.filter((l) => l.trim() !== '')
}

type ContentLine = { name: string; params: Record<string, string>; value: string }

export function parseContentLine(line: string): ContentLine | null {
  const colon = line.indexOf(':')
  if (colon === -1) return null
  const left = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const [name, ...paramParts] = left.split(';')
  const params: Record<string, string> = {}
  for (const part of paramParts) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name: name.toUpperCase(), params, value }
}

/**
 * Parse an ICS date/date-time into epoch ms plus whether it was date-only.
 *
 * A trailing `Z` means UTC and is converted; anything else — with or without a
 * `TZID` — is read as local wall-clock, because that is the only thing this app's
 * model can represent. A `TZID` is therefore **honoured as a floating time**, and
 * the caller counts it so the user can be told.
 */
export function parseIcsDate(
  value: string
): { ms: number; dateOnly: boolean; utc: boolean } | null {
  const trimmed = value.trim()
  if (/^\d{8}$/.test(trimmed)) {
    // Sliced into ISO rather than handed to dayjs raw: `dayjs('20260706')` needs
    // the customParseFormat plugin, and this package adds no dayjs plugins.
    const parsed = dayjs(`${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`)
    if (!parsed.isValid()) return null
    return { ms: parsed.startOf('day').valueOf(), dateOnly: true, utc: false }
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(trimmed)
  if (!match) return null
  const [, y, mo, d, h, mi, s, z] = match
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}`
  const parsed = z ? dayjs(`${iso}Z`) : dayjs(iso)
  if (!parsed.isValid()) return null
  return { ms: parsed.valueOf(), dateOnly: false, utc: Boolean(z) }
}

const ICS_TO_FREQ: Record<string, Frequency> = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
}

const DAY_TO_INDEX: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
}

/**
 * Parse an RRULE into this app's subset, or null if it cannot be represented.
 *
 * Null rather than a lossy approximation: an event whose "last Friday of the
 * month" rule silently became "monthly on the 26th" would be wrong every month,
 * and the user would have no way to know. The importer keeps such an event as a
 * single occurrence and says so.
 */
export function rruleToRule(value: string): RecurrenceRule | null {
  const parts = new Map<string, string>()
  for (const chunk of value.split(';')) {
    const eq = chunk.indexOf('=')
    if (eq === -1) continue
    parts.set(chunk.slice(0, eq).toUpperCase(), chunk.slice(eq + 1))
  }

  const freq = ICS_TO_FREQ[(parts.get('FREQ') ?? '').toUpperCase()]
  if (!freq) return null
  // Anything positional or sub-daily is outside the supported subset.
  if (parts.has('BYSETPOS') || parts.has('BYMONTH') || parts.has('BYYEARDAY')) return null
  if (parts.has('BYMONTHDAY') && freq !== 'monthly' && freq !== 'yearly') return null

  const rule: RecurrenceRule = { freq, interval: 1 }

  const interval = Number(parts.get('INTERVAL') ?? '1')
  if (!Number.isFinite(interval) || interval < 1) return null
  rule.interval = Math.trunc(interval)

  const byDay = parts.get('BYDAY')
  if (byDay) {
    // "-1FR" (last Friday) carries an ordinal this app cannot express.
    if (/[+-]?\d/.test(byDay)) return null
    if (freq !== 'weekly') return null
    const days = byDay
      .split(',')
      .map((d) => DAY_TO_INDEX[d.trim().toUpperCase()])
      .filter((d) => d !== undefined)
    if (days.length === 0) return null
    rule.byWeekday = days
  }

  const count = parts.get('COUNT')
  if (count) {
    const n = Number(count)
    if (!Number.isFinite(n) || n < 1) return null
    rule.count = Math.trunc(n)
  }

  const until = parts.get('UNTIL')
  if (until) {
    const parsed = parseIcsDate(until)
    if (!parsed) return null
    rule.until = dayjs(parsed.ms).format('YYYY-MM-DD')
  }

  return rule
}

export type ImportResult = {
  events: CalendarEventInput[]
  /** VEVENTs that could not be represented at all (no title, no start). */
  skipped: number
  /** Kept as one-off events because their RRULE is outside the subset. */
  recurrenceDropped: number
  /** Kept, but their TZID was read as local wall-clock time. */
  timezoneFlattened: number
}

/**
 * Parse an `.ics` file into event inputs.
 *
 * Reports rather than throws: a 200-event export where three entries use
 * "last Friday of the month" should import 200 events and tell you about the
 * three, not fail. The only hard failure is a file that is not a VCALENDAR at all.
 */
export function icsToEvents(text: string): ImportResult {
  const lines = unfold(text)
  const result: ImportResult = {
    events: [],
    skipped: 0,
    recurrenceDropped: 0,
    timezoneFlattened: 0,
  }

  let current: (Partial<CalendarEventInput> & { exceptions: string[] }) | null = null
  let inAlarm = false
  let sawEnd = false

  for (const line of lines) {
    const parsed = parseContentLine(line)
    if (!parsed) continue
    const { name, params, value } = parsed

    if (name === 'BEGIN' && value.toUpperCase() === 'VEVENT') {
      current = { exceptions: [], allDay: false }
      sawEnd = false
      continue
    }
    if (name === 'BEGIN' && value.toUpperCase() === 'VALARM') {
      inAlarm = true
      continue
    }
    if (name === 'END' && value.toUpperCase() === 'VALARM') {
      inAlarm = false
      continue
    }
    if (name === 'END' && value.toUpperCase() === 'VEVENT') {
      if (!current) continue
      const { title, start } = current
      if (!title || start === undefined) {
        result.skipped++
      } else {
        // A VEVENT with no DTEND lasts an hour (or the whole day if date-only),
        // which is what RFC 5545 says and what every importer does.
        const end =
          current.end ??
          (current.allDay ? dayjs(start).endOf('day').valueOf() : start + 60 * 60_000)
        result.events.push({
          title,
          start,
          end,
          allDay: current.allDay ?? false,
          notes: current.notes,
          color: current.color,
          reminderMinutes: current.reminderMinutes,
          recurrence: current.recurrence ?? null,
          exceptions: current.exceptions,
        })
      }
      current = null
      continue
    }

    if (!current) continue

    switch (name) {
      case 'SUMMARY':
        current.title = unescapeText(value).trim()
        break
      case 'DESCRIPTION':
        // A VALARM has its own DESCRIPTION; it is not the event's notes.
        if (!inAlarm) {
          const notes = unescapeText(value).trim()
          if (notes) current.notes = notes
        }
        break
      case 'DTSTART': {
        const parsedDate = parseIcsDate(value)
        if (!parsedDate) break
        current.start = parsedDate.ms
        current.allDay = parsedDate.dateOnly || params.VALUE === 'DATE'
        if (params.TZID && !parsedDate.utc) result.timezoneFlattened++
        break
      }
      case 'DTEND': {
        const parsedDate = parseIcsDate(value)
        if (!parsedDate) break
        // An all-day DTEND is EXCLUSIVE in the spec, so a one-day event on the
        // 6th arrives as DTEND 20260707. Store the last instant it actually
        // covers, or every imported all-day event gains a day.
        current.end =
          parsedDate.dateOnly || params.VALUE === 'DATE'
            ? dayjs(parsedDate.ms).subtract(1, 'day').endOf('day').valueOf()
            : parsedDate.ms
        sawEnd = true
        break
      }
      case 'DURATION': {
        // Only the forms a calendar actually emits for an event length.
        const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(value.trim())
        if (!match || current.start === undefined || sawEnd) break
        const [, d, h, m] = match
        const ms = (Number(d ?? 0) * 86_400 + Number(h ?? 0) * 3600 + Number(m ?? 0) * 60) * 1000
        if (ms > 0) current.end = current.start + ms
        break
      }
      case 'COLOR': {
        const mapped = CSS_TO_COLOR[value.trim().toLowerCase()]
        if (mapped) current.color = mapped
        else if (COLORS.includes(value.trim().toLowerCase() as EventColor))
          current.color = value.trim().toLowerCase() as EventColor
        break
      }
      case 'RRULE': {
        const rule = rruleToRule(value)
        if (rule) current.recurrence = rule
        else result.recurrenceDropped++
        break
      }
      case 'EXDATE': {
        for (const part of value.split(',')) {
          const parsedDate = parseIcsDate(part)
          if (parsedDate) current.exceptions.push(dayjs(parsedDate.ms).format('YYYY-MM-DD'))
        }
        break
      }
      case 'TRIGGER': {
        if (!inAlarm) break
        // Negative day/hour/minute offsets only. An absolute trigger
        // (VALUE=DATE-TIME) or one after the start has no representation here —
        // this app's reminder is "N minutes before".
        const match = /^-P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(value.trim())
        if (!match) break
        const [, d, h, m] = match
        const minutes = Number(d ?? 0) * 1440 + Number(h ?? 0) * 60 + Number(m ?? 0)
        if (minutes > 0) current.reminderMinutes = minutes
        break
      }
    }
  }

  return result
}

/** The message shown after an import — says what was lost, if anything. */
export function describeImport(result: ImportResult): string {
  const parts = [`${result.events.length} event${result.events.length === 1 ? '' : 's'} imported`]
  if (result.recurrenceDropped > 0)
    parts.push(
      `${result.recurrenceDropped} repeat rule${result.recurrenceDropped === 1 ? '' : 's'} too complex to keep (kept as single events)`
    )
  if (result.timezoneFlattened > 0)
    parts.push(
      `${result.timezoneFlattened} event${result.timezoneFlattened === 1 ? '' : 's'} read in your local time`
    )
  if (result.skipped > 0) parts.push(`${result.skipped} unreadable and skipped`)
  return parts.join(' · ')
}
