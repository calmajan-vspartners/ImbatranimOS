import { useMemo } from 'react'
import dayjs from 'dayjs'
import { openApp } from '@imbatranim/core'
import { useEventsQuery } from './queries/calendarQueries'
import { expandOccurrences } from './recurrence'

/** Enough for a glance; the app itself is one click away. */
const MAX_ROWS = 4

/**
 * Today's agenda on the desktop (brief 96). Reads the same events cache the
 * app and the background reminder service share, so it costs no extra
 * requests while either is alive.
 */
export function AgendaWidget() {
  const { data: events } = useEventsQuery()

  const today = useMemo(() => {
    const start = dayjs().startOf('day').valueOf()
    const end = dayjs().endOf('day').valueOf()
    return (events ?? [])
      .flatMap((event) => expandOccurrences(event, start, end))
      .sort((a, b) => a.start - b.start)
      .slice(0, MAX_ROWS)
  }, [events])

  return (
    <div className="flex h-full w-full flex-col px-2.5 py-1.5">
      <button
        type="button"
        onClick={() => openApp('calendar')}
        className="font-ui text-on-surface-variant hover:text-on-surface w-fit text-left text-[9px] font-semibold tracking-widest uppercase outline-none"
      >
        Today
      </button>
      {today.length === 0 ? (
        <div className="font-ui text-on-surface-variant flex flex-1 items-center justify-center text-[11px]">
          Nothing today
        </div>
      ) : (
        <ul className="mt-1 space-y-0.5 overflow-hidden">
          {today.map((o) => (
            <li key={`${o.event.id}:${o.start}`} className="flex items-baseline gap-1.5">
              <span className="text-on-surface-variant font-mono text-[10px] tabular-nums">
                {o.event.allDay ? 'all day' : dayjs(o.start).format('HH:mm')}
              </span>
              <span className="font-ui text-on-surface min-w-0 truncate text-[11px]">
                {o.event.title}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
