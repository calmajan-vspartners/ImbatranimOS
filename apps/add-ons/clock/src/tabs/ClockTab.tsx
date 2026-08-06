import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button, Select, cn } from '@imbatranim/ui'
import { useNow } from '../useNow'
import { formatDateInZone, formatTimeInZone, formatUtcOffset } from '../format'
import { CURATED_TIMEZONES, timeZoneLabel } from '../timezones'
import {
  useCreateWorldClockMutation,
  useDeleteWorldClockMutation,
  useWorldClocksQuery,
} from '../queries/clockQueries'

const LOCAL_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

function AddWorldClockRow() {
  const create = useCreateWorldClockMutation()
  const [timeZone, setTimeZone] = useState<string | null>(null)

  const handleAdd = () => {
    if (!timeZone) return
    create.mutate({ label: timeZoneLabel(timeZone), timeZone })
    setTimeZone(null)
  }

  return (
    <div className="flex items-end gap-2">
      <Select
        className="flex-1"
        placeholder="Add a city…"
        options={CURATED_TIMEZONES}
        value={timeZone}
        onValueChange={(v) => setTimeZone(v as string)}
      />
      <Button
        variant="primary"
        size="sm"
        onClick={handleAdd}
        disabled={!timeZone || create.isPending}
      >
        <Plus size={12} strokeWidth={2} />
        Add
      </Button>
    </div>
  )
}

function WorldClockRow({
  id,
  label,
  timeZone,
  now,
}: {
  id: number
  label: string
  timeZone: string
  now: number
}) {
  const remove = useDeleteWorldClockMutation()
  const date = new Date(now)

  return (
    <div className="border-outline-variant group flex items-center justify-between border-b px-3 py-2">
      <div className="min-w-0">
        <p className="font-ui text-on-surface truncate text-[12px] font-semibold">{label}</p>
        <p className="font-ui text-on-surface-variant text-[10px]">
          {formatDateInZone(date, timeZone)} · {formatUtcOffset(date, timeZone)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-on-surface font-mono text-[15px] tabular-nums">
          {formatTimeInZone(date, timeZone)}
        </span>
        <button
          type="button"
          onClick={() => remove.mutate(id)}
          title="Remove"
          aria-label={`Remove ${label}`}
          className="text-on-surface-variant hover:text-error shrink-0 p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          <X size={12} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

export function ClockTab() {
  const { data: worldClocks, isPending, isError } = useWorldClocksQuery()
  const now = useNow(1000)
  const localDate = new Date(now)
  const empty = !worldClocks || worldClocks.length === 0

  return (
    <div className="flex h-full flex-col">
      {/* Big local clock — the same instant the tray clock shows. */}
      <div className="border-outline-variant flex flex-col items-center justify-center gap-1 border-b px-4 py-6">
        <span className="text-on-surface font-mono text-[40px] leading-none font-semibold tabular-nums">
          {formatTimeInZone(localDate, LOCAL_TIME_ZONE)}
        </span>
        <span className="font-ui text-on-surface-variant text-[12px]">
          {formatDateInZone(localDate, LOCAL_TIME_ZONE)}
        </span>
        <span className="font-ui text-on-surface-variant text-[10px] tracking-wide uppercase">
          {LOCAL_TIME_ZONE}
        </span>
      </div>

      {/* World clocks */}
      <div className="flex flex-col gap-2 p-3">
        <p className="font-ui text-on-surface-variant text-[11px] font-semibold tracking-wider uppercase">
          World clocks
        </p>
        <AddWorldClockRow />
      </div>

      <div className={cn('flex-1', empty && 'flex items-center justify-center')}>
        {isError ? (
          <p className="font-ui text-error text-[12px]">Could not load your world clocks.</p>
        ) : isPending ? (
          <p className="font-ui text-on-surface-variant text-[12px]">Loading…</p>
        ) : empty ? (
          <p className="font-ui text-on-surface-variant text-[12px]">No world clocks added yet</p>
        ) : (
          worldClocks.map((w) => (
            <WorldClockRow key={w.id} id={w.id} label={w.label} timeZone={w.timeZone} now={now} />
          ))
        )}
      </div>
    </div>
  )
}
