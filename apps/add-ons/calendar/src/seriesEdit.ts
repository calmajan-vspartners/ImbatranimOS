import dayjs from 'dayjs'
import { occurrenceDateOf } from './recurrence'
import type { CalendarEvent, CalendarEventInput, EditScope } from './types'

/**
 * Editing and deleting one instance of a repeating event.
 *
 * This is the part of a calendar that is easy to get subtly wrong, so it is a pure
 * function returning a **plan** — which rows to patch, create or delete — rather
 * than a tangle of mutations inside a dialog handler. The dialog decides *what* the
 * user typed; this decides what that means for the series.
 *
 * Three scopes, and each is a different shape of change:
 *
 * - `all` edits the rule in place. The edit arrives as an absolute instant on the
 *   occurrence the user clicked, so it is applied to the series as a **delta**: open
 *   the third Monday, change 09:00 to 10:00, choose "all events", and the series
 *   start moves to 10:00 on its own original date — it does not jump to the third
 *   Monday. Setting the series start to the edited occurrence would silently delete
 *   every earlier occurrence.
 * - `single` **detaches** the instance: an exception on the series plus a new
 *   standalone event. No separate override table — an override row needs its own
 *   identity, lifecycle and merge rules, and a detached event is a thing the user
 *   can already understand and delete.
 * - `following` **splits** the series in two: the original ends the day before, and
 *   a new series carries the same rule forward with the edit applied.
 */

export type SeriesPlan = {
  /** Fields to PATCH onto the original event. */
  patch?: Partial<CalendarEventInput>
  /** A new event to POST — a detached instance, or the tail of a split series. */
  create?: CalendarEventInput
  /** True when the original row should be deleted outright. */
  deleteOriginal?: boolean
}

/** What the dialog collected, as absolute instants on the edited occurrence. */
export type EditedFields = Omit<CalendarEventInput, 'recurrence' | 'exceptions'> & {
  recurrence?: CalendarEventInput['recurrence']
}

/** The instance the user opened. */
export type EditedOccurrence = {
  /** The series' own start, i.e. `event.start`. */
  seriesStart: number
  /** This occurrence's start before the edit. */
  occurrenceStart: number
  occurrenceDate: string
  /** Position in the series, 0 for the first. */
  index: number
  /** True when this is the first occurrence of the series. */
  isFirst: boolean
}

/**
 * `until` is inclusive, so a series that must stop before `date` ends the day
 * before it.
 */
function dayBefore(date: string): string {
  return dayjs(date).subtract(1, 'day').format('YYYY-MM-DD')
}

/**
 * Plan an edit.
 *
 * `event` is the stored series; `edited` is what the dialog produced for the
 * occurrence identified by `occurrence`.
 */
export function planEdit(
  event: CalendarEvent,
  occurrence: EditedOccurrence,
  edited: EditedFields,
  scope: EditScope
): SeriesPlan {
  // A one-off event has exactly one meaning for every scope.
  if (!event.recurrence) {
    return { patch: { ...edited, recurrence: edited.recurrence ?? null } }
  }

  if (scope === 'all') {
    // Apply the change as a delta so earlier occurrences survive.
    const shift = edited.start - occurrence.occurrenceStart
    const duration = edited.end - edited.start
    const newStart = occurrence.seriesStart + shift
    return {
      patch: {
        ...edited,
        start: newStart,
        end: newStart + duration,
        // `undefined` means the dialog did not touch the rule (keep the series');
        // `null` means the user chose "Does not repeat" and must clear it (T1-6).
        recurrence: edited.recurrence !== undefined ? edited.recurrence : event.recurrence,
      },
    }
  }

  if (scope === 'single') {
    return {
      patch: { exceptions: [...event.exceptions, occurrence.occurrenceDate] },
      create: { ...edited, recurrence: null, exceptions: [] },
    }
  }

  // scope === 'following'
  if (occurrence.isFirst) {
    // Nothing precedes it, so "this and following" is "all" — and truncating the
    // original to end before its own start would leave an empty series behind.
    return planEdit(event, occurrence, edited, 'all')
  }

  const cut = occurrence.occurrenceDate
  // `undefined` means the rule was left untouched; `null` means the user cleared
  // it ("Does not repeat") and the tail must not repeat either (T1-6).
  const ruleWasEdited = edited.recurrence !== undefined
  const rule = ruleWasEdited ? edited.recurrence : event.recurrence
  // A `count` cannot survive a split as-is: the head now ends on a date, and the
  // tail carries however many occurrences were left. Anything else changes how
  // many times the event happens, which the user did not ask for.
  const remainingCount =
    event.recurrence.count !== undefined
      ? Math.max(1, event.recurrence.count - occurrence.index)
      : undefined

  return {
    patch: {
      recurrence: { ...event.recurrence, until: dayBefore(cut), count: undefined },
      // Exceptions belong to whichever half of the split still contains them.
      exceptions: event.exceptions.filter((date) => date < cut),
    },
    create: {
      ...edited,
      recurrence: rule
        ? {
            ...rule,
            // Carry the ORIGINAL series' end onto the tail only when the rule was
            // left untouched; when the user set a new `until`, honour it (M6).
            until: ruleWasEdited ? rule.until : event.recurrence.until,
            count: remainingCount,
          }
        : null,
      exceptions: event.exceptions.filter((date) => date >= cut),
    },
  }
}

/** Plan a delete. Same three scopes, no new fields involved. */
export function planDelete(
  event: CalendarEvent,
  occurrence: EditedOccurrence,
  scope: EditScope
): SeriesPlan {
  if (!event.recurrence || scope === 'all') return { deleteOriginal: true }

  if (scope === 'single') {
    return { patch: { exceptions: [...event.exceptions, occurrence.occurrenceDate] } }
  }

  // 'following' — dropping the first occurrence drops the whole series.
  if (occurrence.isFirst) return { deleteOriginal: true }

  const cut = occurrence.occurrenceDate
  return {
    patch: {
      recurrence: { ...event.recurrence, until: dayBefore(cut), count: undefined },
      exceptions: event.exceptions.filter((date) => date < cut),
    },
  }
}

/** Whether the scope question is worth asking at all. */
export function needsScopeChoice(event: CalendarEvent): boolean {
  return event.recurrence !== null
}

/** The occurrence descriptor for an instance of `event` starting at `start`. */
export function occurrenceOf(event: CalendarEvent, start: number, index = 0): EditedOccurrence {
  return {
    seriesStart: event.start,
    occurrenceStart: start,
    occurrenceDate: occurrenceDateOf(start),
    index,
    isFirst: occurrenceDateOf(start) === occurrenceDateOf(event.start),
  }
}
