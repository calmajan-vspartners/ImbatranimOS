import { useEffect } from 'react'
import dayjs from 'dayjs'
import { notify } from '@imbatranim/core'
import { expandOccurrences } from './recurrence'
import { peekEvents } from './queries/calendarQueries'

/** How often the reminder check runs while the tab is open. */
const CHECK_INTERVAL_MS = 60_000

/**
 * Window (after the trigger instant) during which a reminder may still fire.
 * Wide enough that a ~1/min interval never misses a trigger to timer drift,
 * narrow enough that reopening the app long after a trigger has passed
 * (e.g. the tab was closed for days) doesn't dump a wave of stale toasts.
 */
const FIRE_WINDOW_MS = 90_000

/**
 * How far ahead to expand a recurring event when looking for a due reminder. A
 * reminder is at most four weeks before its event (the DTO's cap), so nothing
 * beyond this window can be due now.
 */
const LOOKAHEAD_MS = 31 * 24 * 60 * 60 * 1000

/**
 * Already-notified occurrences, as `eventId:YYYY-MM-DD`.
 *
 * **Session state, deliberately — and a change from before brief 72.** The old
 * model persisted a single `reminderFired` boolean per event, which cannot work once
 * an event repeats: the first ring would set the flag and silence every later
 * occurrence of the series forever. A per-occurrence key fixes that, and it does not
 * need persisting because `FIRE_WINDOW_MS` already stops a reopened window from
 * replaying old triggers — persistence would only add silence across a reload for a
 * reminder that is still due, which is the wrong trade.
 *
 * Module-level rather than per-hook, so it survives the window being closed and
 * reopened within the same page load.
 */
const notified = new Set<string>()

/** Bounded so a long-lived session cannot grow it without limit. */
const MAX_NOTIFIED = 500

function remember(key: string): void {
  if (notified.size >= MAX_NOTIFIED) {
    // A Set iterates in insertion order, so this drops the oldest.
    const oldest = notified.values().next().value
    if (oldest !== undefined) notified.delete(oldest)
  }
  notified.add(key)
}

/**
 * Fires a `notify(...)` toast once per occurrence when `now` crosses
 * `start - reminderMinutes`. Runs a single ~1/min interval for as long as this hook
 * stays mounted — reminders only fire while the Calendar window is open in this tab;
 * there is no background/service-worker delivery, which the status bar says. Mount
 * this exactly once, from the root Calendar component.
 *
 * Events come from the react-query cache rather than through a hook, because this
 * callback lives outside React's render cycle and must not re-subscribe every minute.
 */
export function useCalendarReminders(): void {
  useEffect(() => {
    function check() {
      const now = Date.now()
      for (const event of peekEvents()) {
        if (!event.reminderMinutes) continue
        const offsetMs = event.reminderMinutes * 60_000

        for (const occurrence of expandOccurrences(event, now, now + LOOKAHEAD_MS)) {
          const trigger = occurrence.start - offsetMs
          if (now < trigger || now >= trigger + FIRE_WINDOW_MS) continue

          const key = `${event.id}:${occurrence.occurrenceDate}`
          if (notified.has(key)) continue
          remember(key)
          notify({
            title: event.title,
            body: event.allDay
              ? `Today · ${dayjs(occurrence.start).format('MMM D')}`
              : `Starting at ${dayjs(occurrence.start).format('HH:mm')}`,
            appId: 'calendar',
            level: 'info',
          })
        }
      }
    }

    check()
    const id = setInterval(check, CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])
}
