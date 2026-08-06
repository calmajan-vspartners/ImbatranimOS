import { useState } from 'react'
import { Plus, Trash2, Info, BellOff } from 'lucide-react'
import { Button, Checkbox, Input, cn } from '@imbatranim/ui'
import {
  DAY_LETTERS,
  EVERY_DAY,
  NO_REPEAT,
  WEEKDAYS,
  describeDays,
  repeatsOn,
  toggleDay,
} from '../alarmSchedule'
import { currentHHmm } from '../format'
import {
  useAlarmsQuery,
  useCreateAlarmMutation,
  useDeleteAlarmMutation,
  usePatchAlarmMutation,
} from '../queries/clockQueries'
import type { Alarm } from '../types'

/** The three masks worth a shortcut; anything else is built from the letters. */
const PRESETS: { label: string; mask: string }[] = [
  { label: 'Once', mask: NO_REPEAT },
  { label: 'Every day', mask: EVERY_DAY },
  { label: 'Weekdays', mask: WEEKDAYS },
]

/**
 * The weekday chip row.
 *
 * Monday-first and labelled with letters, so it reads as a week rather than as a
 * bitmask. Selecting nothing is a legitimate state — that is "Once", and it is
 * spelled out below the row rather than left as an empty selection.
 */
function DayPicker({
  mask,
  onChange,
  showPresets = false,
}: {
  mask: string
  onChange: (mask: string) => void
  /** Only the New-alarm form has room for these; a row shows the letters alone. */
  showPresets?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        {DAY_LETTERS.map((letter, index) => {
          const on = repeatsOn(mask, index)
          return (
            <button
              key={index}
              type="button"
              aria-pressed={on}
              // The letters repeat (T/T, S/S), so the accessible name must say
              // which day it is rather than leaving a screen reader with "T".
              aria-label={`Repeat on ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][index]}`}
              onClick={() => onChange(toggleDay(mask, index))}
              className={cn(
                'font-ui h-6 w-6 border text-[10px] font-semibold transition-colors',
                on
                  ? 'border-primary bg-primary text-on-primary'
                  : 'border-outline-variant text-on-surface-variant hover:text-on-surface'
              )}
            >
              {letter}
            </button>
          )
        })}
        {showPresets && (
          <div className="ml-1 flex items-center gap-1">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => onChange(preset.mask)}
                className={cn(
                  'font-ui border px-1.5 py-0.5 text-[10px] transition-colors',
                  mask === preset.mask
                    ? 'border-outline text-on-surface'
                    : 'border-outline-variant text-on-surface-variant hover:text-on-surface'
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="font-ui text-on-surface-variant text-[10px]">
        {describeDays(mask)}
        {showPresets &&
          mask === NO_REPEAT &&
          ' — rings at the next time it comes round, then turns itself off'}
      </p>
    </div>
  )
}

function AddAlarmRow() {
  const create = useCreateAlarmMutation()
  const [label, setLabel] = useState('')
  const [time, setTime] = useState('07:00')
  const [days, setDays] = useState(NO_REPEAT)

  const handleAdd = () => {
    if (!time) return
    create.mutate({ label: label.trim(), time, days })
    setLabel('')
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Wraps at narrow widths so the time field never has to give up room: a
          12-hour locale renders it as "07:00 AM", and the old w-28 clipped that.
          The width lives on these wrappers, not on the Inputs — core's `Input`
          forwards className to the <input> and leaves its own wrapper div
          intrinsically sized, so sizing the component itself does nothing. */}
      <div className="flex flex-wrap items-end gap-2">
        {/* w-40 is 130px here, not 160 — the spacing scale is rem and the root
            font is 13px. Measured: the native time control needs ~120px to show
            "07:00 AM" in a 12-hour locale. */}
        <div className="w-40 shrink-0">
          <Input label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        {/* basis-0 so the wrap decision ignores the field's natural width and the
            Add button keeps its place on the first row. */}
        <div className="min-w-24 flex-1 basis-0">
          <Input
            label="Label"
            placeholder="Wake up (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={handleAdd}
          disabled={!time || create.isPending}
        >
          <Plus size={12} strokeWidth={2} />
          Add
        </Button>
      </div>
      <DayPicker mask={days} onChange={setDays} showPresets />
    </div>
  )
}

function AlarmRow({ alarm }: { alarm: Alarm }) {
  const patch = usePatchAlarmMutation()
  const remove = useDeleteAlarmMutation()

  // The time it will ring, not "in N minutes": an absolute time needs no ticking
  // clock to stay true, so this row does not have to re-render every minute.
  const snoozedUntilHHmm =
    alarm.snoozedUntil !== null ? currentHHmm(new Date(alarm.snoozedUntil)) : null

  return (
    <div className="border-outline-variant group flex items-start justify-between gap-2 border-b px-3 py-2">
      <div className="flex min-w-0 items-start gap-3">
        <Checkbox
          checked={alarm.enabled}
          aria-label={`${alarm.enabled ? 'Disable' : 'Enable'} the ${alarm.time} alarm`}
          onCheckedChange={(next) =>
            patch.mutate({
              id: alarm.id,
              // Re-enabling clears a stale snooze; leaving one behind would make
              // the alarm ring at a time the user never set.
              patch: { enabled: next === true, snoozedUntil: null },
            })
          }
        />
        <div className="min-w-0">
          <p
            className={cn(
              'font-mono text-[15px] tabular-nums',
              alarm.enabled ? 'text-on-surface' : 'text-on-surface-variant line-through'
            )}
          >
            {alarm.time}
          </p>
          {alarm.label && (
            <p className="font-ui text-on-surface-variant truncate text-[11px]">{alarm.label}</p>
          )}
          <div className="mt-1">
            <DayPicker
              mask={alarm.days}
              onChange={(days) => patch.mutate({ id: alarm.id, patch: { days } })}
            />
          </div>
          {snoozedUntilHHmm !== null && (
            <p className="font-ui text-primary mt-1 text-[10px]">
              Snoozed — rings again at {snoozedUntilHHmm}
            </p>
          )}
          {!alarm.enabled && alarm.lastFiredAt !== null && alarm.days === NO_REPEAT && (
            <p className="font-ui text-on-surface-variant mt-1 flex items-center gap-1 text-[10px]">
              <BellOff size={10} strokeWidth={2} />
              Already rang — tick it to arm it again
            </p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => remove.mutate(alarm.id)}
        title="Remove alarm"
        aria-label={`Remove the ${alarm.time} alarm`}
        className="text-on-surface-variant hover:text-error shrink-0 p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Trash2 size={12} strokeWidth={2} />
      </button>
    </div>
  )
}

export function Alarms() {
  const { data: alarms, isPending, isError } = useAlarmsQuery()

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 p-3">
        <p className="font-ui text-on-surface-variant text-[11px] font-semibold tracking-wider uppercase">
          New alarm
        </p>
        <AddAlarmRow />
      </div>

      <div className="border-outline-variant bg-surface-container-low flex items-start gap-2 border-y px-3 py-2">
        <Info size={12} strokeWidth={2} className="text-on-surface-variant mt-0.5 shrink-0" />
        <p className="font-ui text-on-surface-variant text-[11px]">
          Alarms fire while the desktop is open — this window can be closed. Closing the browser tab
          silences them. The alarms themselves are saved in your computer, so they are the same from
          any browser you open it in.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isError ? (
          <p className="font-ui text-error flex h-full items-center justify-center px-4 text-center text-[12px]">
            Could not load your alarms.
          </p>
        ) : isPending ? (
          <p className="font-ui text-on-surface-variant flex h-full items-center justify-center text-[12px]">
            Loading…
          </p>
        ) : alarms.length === 0 ? (
          <p className="font-ui text-on-surface-variant flex h-full items-center justify-center text-[12px]">
            No alarms set
          </p>
        ) : (
          alarms.map((a) => <AlarmRow key={a.id} alarm={a} />)
        )}
      </div>
    </div>
  )
}
