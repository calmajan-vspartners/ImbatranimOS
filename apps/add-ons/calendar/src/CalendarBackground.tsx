import { useCalendarReminders } from './reminders'
import { useEventsQuery } from './queries/calendarQueries'

/** Refresh cadence for the events cache with no window open. */
const EVENTS_REFETCH_MS = 60_000

/**
 * The Calendar's desktop-lifetime service (brief 93): keeps the events cache
 * live and runs the reminder watcher, so reminders fire while the desktop is
 * open — with or without a Calendar window. Mounted by the shell via
 * `manifest.background`.
 */
export function CalendarBackground() {
  useEventsQuery({ refetchIntervalMs: EVENTS_REFETCH_MS })
  useCalendarReminders()
  return null
}
