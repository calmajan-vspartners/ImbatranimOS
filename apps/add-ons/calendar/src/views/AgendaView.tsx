import dayjs, { type Dayjs } from 'dayjs'
import { CalendarClock, Repeat } from 'lucide-react'
import { cn } from '@imbatranim/ui'
import { eventColorClass } from '../eventStyle'
import type { Occurrence } from '../recurrence'

type AgendaViewProps = {
  anchor: Dayjs
  occurrences: Occurrence[]
  onOpen: (occurrence: Occurrence) => void
  /** Non-empty when a search is filtering the list, for the empty-state wording. */
  query: string
}

/**
 * A flat, chronological list of what is coming up — grouped by day.
 *
 * The brief asks for "a day or agenda view", and an agenda is the more useful of
 * the two here: a day view is a week view with one column, whereas a list answers
 * "what is next?" without any grid at all. It is also the only view where **search**
 * makes sense — a matching event three months away is unreachable in a month grid,
 * but it is one row here.
 *
 * The range comes from the parent, so the same expansion feeds every view.
 */
export function AgendaView({ anchor, occurrences, onOpen, query }: AgendaViewProps) {
  const today = dayjs()

  /** Grouped by calendar day, in order. */
  const groups = new Map<string, Occurrence[]>()
  for (const occurrence of occurrences) {
    // Grouped by the day the occurrence *starts*, so a multi-day event appears
    // once in a list rather than on every day it covers — the row says how long
    // it runs instead.
    const key = dayjs(occurrence.start).format('YYYY-MM-DD')
    const existing = groups.get(key)
    if (existing) existing.push(occurrence)
    else groups.set(key, [occurrence])
  }

  if (groups.size === 0) {
    return (
      <div className="text-on-surface-variant flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
        <CalendarClock size={20} />
        <p className="text-[12px]">
          {query
            ? `Nothing matches “${query}” in this range.`
            : `Nothing scheduled from ${anchor.format('MMM D, YYYY')} onwards.`}
        </p>
        {!query && <p className="text-[10px]">Switch to Month or Week to add something.</p>}
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      {[...groups.entries()].map(([key, dayOccurrences]) => {
        const day = dayjs(key)
        const isToday = day.isSame(today, 'day')
        return (
          <div key={key}>
            <div className="border-outline-variant bg-surface-container-low sticky top-0 z-10 flex items-center gap-2 border-y px-3 py-1">
              <span
                className={cn(
                  'flex h-5 min-w-5 items-center justify-center px-1 text-[11px] font-semibold',
                  isToday ? 'bg-primary text-on-primary' : 'text-on-surface'
                )}
              >
                {day.date()}
              </span>
              <span className="text-on-surface-variant text-[11px] font-semibold tracking-wide uppercase">
                {day.format('ddd, MMMM YYYY')}
              </span>
              {isToday && <span className="text-primary text-[10px] font-semibold">Today</span>}
            </div>

            {dayOccurrences.map((occurrence) => {
              const { event } = occurrence
              const multiDay = !dayjs(occurrence.start).isSame(dayjs(occurrence.end), 'day')
              return (
                <button
                  key={`${event.id}-${occurrence.occurrenceDate}`}
                  type="button"
                  onClick={() => onOpen(occurrence)}
                  className="border-outline-variant hover:bg-surface-container flex w-full items-start gap-2 border-b px-3 py-1.5 text-left"
                >
                  <span
                    className={cn(
                      'mt-0.5 w-16 shrink-0 border-l-2 px-1 text-[10px] tabular-nums',
                      eventColorClass(event.color)
                    )}
                  >
                    {event.allDay ? 'All day' : dayjs(occurrence.start).format('HH:mm')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-on-surface block truncate text-[12px] font-semibold">
                      {event.title}
                    </span>
                    <span className="text-on-surface-variant flex flex-wrap items-center gap-x-2 text-[10px]">
                      {!event.allDay && (
                        <span>
                          until{' '}
                          {multiDay
                            ? dayjs(occurrence.end).format('MMM D, HH:mm')
                            : dayjs(occurrence.end).format('HH:mm')}
                        </span>
                      )}
                      {event.allDay && multiDay && (
                        <span>through {dayjs(occurrence.end).format('MMM D')}</span>
                      )}
                      {event.recurrence && (
                        <span className="flex items-center gap-0.5">
                          <Repeat size={9} />
                          repeats
                        </span>
                      )}
                      {event.notes && <span className="truncate">{event.notes}</span>}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
