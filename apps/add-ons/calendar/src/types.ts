/**
 * Calendar's data model.
 *
 * Times are epoch ms with **local-time semantics only** — no timezone conversion
 * happens anywhere in this package, and a per-event timezone is explicitly out of
 * scope (brief 72).
 */

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly'

/**
 * The RRULE-shaped subset this app supports. Stored on the event; occurrences are
 * expanded for the visible range and never written to storage (see recurrence.ts).
 */
export type RecurrenceRule = {
  freq: Frequency
  /** Every N days/weeks/months/years. >= 1. */
  interval: number
  /** Weekly only. **Sunday-first** 0..6, matching `dayjs().day()`. */
  byWeekday?: number[]
  /** Inclusive last day the series may occur on, `YYYY-MM-DD`. */
  until?: string
  /** Total occurrences including the first. Mutually exclusive with `until`. */
  count?: number
}

/** The palette an event may be tinted with. Absent uses the default accent. */
export type EventColor = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'slate'

export type CalendarEvent = {
  /** Server-assigned. Was a client-side uuid string before brief 72. */
  id: number
  title: string
  /** epoch ms */
  start: number
  /** epoch ms */
  end: number
  allDay: boolean
  notes?: string
  color?: EventColor
  /** Minutes before `start` to fire a reminder notification. Omit for none. */
  reminderMinutes?: number
  /** Null for a one-off event. */
  recurrence: RecurrenceRule | null
  /**
   * `YYYY-MM-DD` start days removed from the series — either deleted outright, or
   * detached into their own standalone event ("change just this one").
   */
  exceptions: string[]
}

/** Everything a create/update accepts. The server owns `id`. */
export type CalendarEventInput = {
  title: string
  start: number
  end: number
  allDay: boolean
  notes?: string
  color?: EventColor
  reminderMinutes?: number
  recurrence?: RecurrenceRule | null
  exceptions?: string[]
}

/**
 * Which part of a series an edit or delete applies to.
 *
 * `single` detaches the instance (a new standalone event plus an exception on the
 * series), `following` splits the series in two, `all` edits the rule itself.
 * A one-off event only ever uses `all`.
 */
export type EditScope = 'single' | 'following' | 'all'

/** What the create/edit dialog is currently doing, if anything. */
export type EventDialogState =
  | { mode: 'create'; start: number; end: number; allDay: boolean }
  | {
      mode: 'edit'
      event: CalendarEvent
      /** The instance that was clicked — its own start/end, not the series'. */
      occurrenceStart: number
      occurrenceEnd: number
      occurrenceDate: string
      /** Its position in the series, which a counted split needs to divide. */
      occurrenceIndex: number
    }
