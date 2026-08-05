import { useEffect } from 'react'
import { notify } from '@imbatranim/core'
import { getClockState, useClockStore } from './clockStore'
import { dueReason, firedPatch } from './alarmSchedule'
import { formatClockDuration } from './format'
import { completionBody, isDue } from './timerModel'
import { patchAlarm } from './api/clockApi'
import { applyAlarmPatchLocally, invalidateAlarms, peekAlarms } from './queries/clockQueries'

/**
 * One interval (~1/sec), mounted once at the app root (see Clock.tsx) so it keeps
 * running no matter which tab is active — checks:
 *   - enabled alarms against the current wall-clock HH:mm, plus expired snoozes
 *   - every running timer that has reached zero
 * and raises `notify(...)` for each. This is the ONLY place that fires
 * notifications; there is no background/service-worker daemon, so alarms and
 * timers only fire while this window is open (surfaced in the UI).
 *
 * The alarm *decision* lives in `alarmSchedule.dueReason` and the timer decision
 * in `timerModel.isDue`, both pure and unit-tested. What is left here is the
 * effects: notify, mark the alarm as rung on the server, and put it in the
 * ringing list so the window can offer Snooze.
 */
export function useClockNotifications(): void {
  useEffect(() => {
    const id = setInterval(() => {
      const now = new Date()

      // Alarms are read straight from the react-query cache: this callback lives
      // outside React's render cycle and must not re-subscribe every second.
      for (const alarm of peekAlarms()) {
        const reason = dueReason(alarm, now)
        if (reason === null) continue

        // Record the ring in the cache synchronously, *then* persist. The local
        // write is what stops the next tick from notifying again a second later,
        // while the PATCH is still in flight.
        const patch = firedPatch(alarm, now)
        applyAlarmPatchLocally(alarm.id, patch)
        void patchAlarm(alarm.id, patch)
          .catch(() => undefined)
          .finally(() => invalidateAlarms())

        useClockStore.getState().ringAlarm({
          alarmId: alarm.id,
          label: alarm.label,
          time: alarm.time,
          at: now.getTime(),
        })
        notify({
          title: reason === 'snooze' ? 'Alarm (snoozed)' : 'Alarm',
          body: alarm.label ? `${alarm.label} — ${alarm.time}` : `It's ${alarm.time}`,
          appId: 'clock',
          level: 'info',
        })
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
}
