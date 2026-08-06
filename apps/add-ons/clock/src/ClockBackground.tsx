import { useEffect, useRef } from 'react'
import { notify, claimScheduleOccurrence } from '@imbatranim/core'
import { getClockState, useClockStore } from './clockStore'
import { dueOccurrence, firedPatch } from './alarmSchedule'
import { formatClockDuration } from './format'
import { completionBody, isDue } from './timerModel'
import { patchAlarm } from './api/clockApi'
import {
  applyAlarmPatchLocally,
  invalidateAlarms,
  peekAlarms,
  useAlarmsQuery,
} from './queries/clockQueries'

/** Refresh cadence for the alarms cache with no window open. */
const ALARMS_REFETCH_MS = 60_000

/**
 * The Clock's desktop-lifetime service (brief 93): alarm and timer firing,
 * moved out of the window so "set an alarm and close the Clock" behaves like a
 * computer instead of an apology. Mounted by the shell via
 * `manifest.background` from login to tab close.
 *
 * What changed from the old in-window watcher (`useClockNotifications`):
 *
 * - The alarms query is subscribed here (with a background-safe poll), so the
 *   cache is live without any window.
 * - The due check is `dueOccurrence` over a `(lastTick, now]` window rather
 *   than minute-equality — hidden tabs throttle intervals to ~1/min, and a
 *   tick landing at 07:00:45 must still catch the 07:00 alarm.
 * - The toast is gated on `claimScheduleOccurrence`, so two desktop tabs
 *   produce one notification. The cache patch, the PATCH and the in-window
 *   ring banner are idempotent and happen in every tab regardless.
 *
 * Timers stay unclaimed: they are session state in this tab's store, so no
 * other tab can race them.
 */
export function ClockBackground() {
  useAlarmsQuery({ refetchIntervalMs: ALARMS_REFETCH_MS })

  // Seeded inside the effect (render must stay pure): the window opens at
  // mount, so nothing before the first tick can be "due since".
  const lastTickRef = useRef(0)

  useEffect(() => {
    lastTickRef.current = Date.now()
    const id = setInterval(() => {
      const now = new Date()
      const since = lastTickRef.current
      lastTickRef.current = now.getTime()

      for (const alarm of peekAlarms()) {
        const due = dueOccurrence(alarm, now, since)
        if (due === null) continue

        // Record the ring in the cache synchronously, *then* persist. The local
        // write is what stops the next tick from firing again a second later,
        // while the PATCH is still in flight. Keyed to the occurrence's minute,
        // not the observing tick's.
        const patch = firedPatch(alarm, new Date(due.occurrenceMs))
        applyAlarmPatchLocally(alarm.id, patch)
        void patchAlarm(alarm.id, patch)
          .catch(() => undefined)
          .finally(() => invalidateAlarms())

        // The in-window banner (with Snooze) appears if a Clock window is open
        // in this tab — unconditionally, it is per-tab UI state.
        useClockStore.getState().ringAlarm({
          alarmId: alarm.id,
          label: alarm.label,
          time: alarm.time,
          at: due.occurrenceMs,
        })

        void claimScheduleOccurrence('clock', String(alarm.id), due.occurrenceMs).then(
          (claimed) => {
            if (!claimed) return
            notify({
              title: due.reason === 'snooze' ? 'Alarm (snoozed)' : 'Alarm',
              body: alarm.label ? `${alarm.label} — ${alarm.time}` : `It's ${alarm.time}`,
              appId: 'clock',
              level: 'info',
            })
          }
        )
      }

      const nowMs = now.getTime()
      for (const timer of getClockState().timers) {
        if (!isDue(timer, nowMs)) continue
        useClockStore.getState().completeTimer(timer.id)
        notify({
          title: 'Timer finished',
          body: completionBody(timer, formatClockDuration(timer.durationMs)),
          appId: 'clock',
          level: 'info',
        })
      }
    }, 1000)

    return () => clearInterval(id)
  }, [])

  return null
}
