import { AlarmClock } from 'lucide-react'
import { Button } from '@imbatranim/core'
import { SNOOZE_LABEL, snoozePatch } from '../alarmSchedule'
import { useClockStore } from '../clockStore'
import { usePatchAlarmMutation } from '../queries/clockQueries'

/**
 * The only place Snooze can live.
 *
 * `notify()` raises a toast, and a toast has no buttons — so a snooze offered
 * only from the notification centre would be a snooze the user cannot press.
 * This banner sits above the tab strip instead, visible whichever tab is open,
 * for exactly as long as an alarm is unacknowledged.
 */
export function RingingBanner() {
  const ringing = useClockStore((s) => s.ringing)
  const clearRinging = useClockStore((s) => s.clearRinging)
  const patch = usePatchAlarmMutation()

  if (ringing.length === 0) return null

  return (
    <div className="border-primary bg-primary text-on-primary flex flex-col gap-1 border-b">
      {ringing.map((entry) => (
        <div key={entry.alarmId} className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <AlarmClock size={14} strokeWidth={2} className="shrink-0" />
            <p className="font-ui truncate text-[12px] font-semibold">
              {entry.label ? `${entry.label} — ${entry.time}` : `Alarm · ${entry.time}`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                patch.mutate({ id: entry.alarmId, patch: snoozePatch(Date.now()) })
                clearRinging(entry.alarmId)
              }}
            >
              {SNOOZE_LABEL}
            </Button>
            <Button variant="default" size="sm" onClick={() => clearRinging(entry.alarmId)}>
              Dismiss
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
