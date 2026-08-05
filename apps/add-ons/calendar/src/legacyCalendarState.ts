import type { CalendarEventInput } from './types'

/**
 * Parsing of the pre-brief-72 `localStorage` calendar.
 *
 * Split from the IO half so the awkward payloads are testable: the brief calls the
 * migration "the highest-risk part" and asks for its own test with a realistic
 * payload, because a silent switch to backend storage looks exactly like data loss
 * to anyone who has been using the app.
 */

/** The key zustand's persist middleware wrote to. */
export const LEGACY_KEY = 'imbatranimos:calendar'

/** Matches the backend's caps, so nothing is rejected at the door. */
const MAX_TITLE = 300
const MAX_NOTES = 10_000

/** The reminder offsets the old dialog could produce, plus a sane ceiling. */
const MAX_REMINDER_MINUTES = 40_320

export type LegacyState = {
  events: CalendarEventInput[]
  /** Entries that were present but unusable — reported, never silently dropped. */
  skipped: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function finiteInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null
}

/**
 * Parse the legacy blob defensively.
 *
 * Returns `null` when there is nothing to migrate at all, so the caller can tell
 * "no legacy data" from "legacy data that was all junk".
 *
 * The old model had no recurrence, no colour and no exceptions, so every migrated
 * event is a one-off — there is nothing to lose in translation. What it *did* have
 * is `reminderFired`, a persisted per-event flag; that is deliberately dropped (see
 * `reminders.ts`: the guard is now session state keyed per occurrence, because a
 * recurring event needs one guard per instance and a persisted flag would silence
 * the series after its first ring).
 */
export function readLegacyCalendarState(raw: string | null): LegacyState | null {
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null

  // zustand's persist wraps state as { state, version }; the bare shape is
  // accepted too, in case a key was ever written by hand.
  const state = isRecord(parsed.state) ? parsed.state : parsed
  if (!Array.isArray(state.events)) return null

  const events: CalendarEventInput[] = []
  let skipped = 0

  for (const entry of state.events) {
    if (!isRecord(entry)) {
      skipped++
      continue
    }
    const title = typeof entry.title === 'string' ? entry.title.trim() : ''
    const start = finiteInt(entry.start)
    const end = finiteInt(entry.end)
    if (title === '' || start === null) {
      skipped++
      continue
    }

    const allDay = entry.allDay === true
    // An end before the start (or missing) would render as a zero/negative-height
    // block. An hour is the same default the ICS importer uses for a DTEND-less
    // VEVENT, and it is better than dropping the event.
    const safeEnd = end !== null && end >= start ? end : start + 60 * 60_000

    const notes = typeof entry.notes === 'string' ? entry.notes.slice(0, MAX_NOTES).trim() : ''
    const reminder = finiteInt(entry.reminderMinutes)

    events.push({
      title: title.slice(0, MAX_TITLE),
      start,
      end: safeEnd,
      allDay,
      ...(notes ? { notes } : {}),
      ...(reminder !== null && reminder > 0 && reminder <= MAX_REMINDER_MINUTES
        ? { reminderMinutes: reminder }
        : {}),
      recurrence: null,
      exceptions: [],
    })
  }

  if (events.length === 0 && skipped === 0) return null
  return { events, skipped }
}

/** What the user is told once their calendar has moved. */
export function describeMigration(count: number): string {
  return `${count} event${count === 1 ? '' : 's'} moved out of this browser and into your computer, so your calendar is the same from anywhere you open it.`
}
