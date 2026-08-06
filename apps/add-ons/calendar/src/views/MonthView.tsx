import dayjs, { type Dayjs } from 'dayjs'
import { cn } from '@imbatranim/ui'
import { WEEKDAY_LABELS, buildMonthGrid } from '../dateUtils'
import { occurrencesOnDay } from '../recurrence'
import { compareForDay, eventColorClass, occurrenceLabel } from '../eventStyle'
import type { Occurrence } from '../recurrence'

const MAX_VISIBLE_EVENTS = 3

type MonthViewProps = {
  anchor: Dayjs
  /** Already expanded for the visible range by the parent. */
  occurrences: Occurrence[]
  onCreate: (start: number, end: number, allDay: boolean) => void
  onOpen: (occurrence: Occurrence) => void
}

/**
 * The month grid.
 *
 * Two things changed with brief 72. It renders **occurrences**, not events, so a
 * recurring event appears on every day it falls on; and a day cell shows every
 * occurrence that *overlaps* it rather than only those that start on it — a
 * three-day trip used to be visible on its first day and invisible on the other
 * two, which made multi-day events look like data loss.
 */
export function MonthView({ anchor, occurrences, onCreate, onOpen }: MonthViewProps) {
  const weeks = buildMonthGrid(anchor)
  const today = dayjs()

  return (
    <div className="flex h-full flex-col">
      <div className="border-outline-variant grid grid-cols-7 border-b">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="text-on-surface-variant py-1 text-center text-[11px] font-semibold tracking-wide uppercase"
          >
            {label}
          </div>
        ))}
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        {weeks.map((week, wi) => (
          <div
            key={wi}
            className="border-outline-variant grid flex-1 grid-cols-7 border-b last:border-b-0"
          >
            {week.map((day) => {
              const inMonth = day.month() === anchor.month()
              const isToday = day.isSame(today, 'day')
              const dayOccurrences = occurrencesOnDay(occurrences, day).sort(compareForDay)
              const overflow = dayOccurrences.length - MAX_VISIBLE_EVENTS

              return (
                <div
                  key={day.valueOf()}
                  role="button"
                  tabIndex={0}
                  aria-label={`Add an event on ${day.format('MMMM D, YYYY')}`}
                  onClick={() =>
                    onCreate(day.startOf('day').valueOf(), day.endOf('day').valueOf(), true)
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      onCreate(day.startOf('day').valueOf(), day.endOf('day').valueOf(), true)
                    }
                  }}
                  className={cn(
                    'border-outline-variant hover:bg-surface-container flex cursor-pointer flex-col items-start gap-0.5 overflow-hidden border-r p-1 text-left last:border-r-0',
                    !inMonth && 'text-on-surface-variant/60'
                  )}
                >
                  <span
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center text-[11px]',
                      isToday && 'bg-primary text-on-primary font-semibold'
                    )}
                  >
                    {day.date()}
                  </span>

                  <div className="flex w-full min-w-0 flex-col gap-0.5 overflow-hidden">
                    {dayOccurrences.slice(0, MAX_VISIBLE_EVENTS).map((occurrence) => (
                      <span
                        // Key on the occurrence, not the event: a recurring event
                        // has many instances and they are not interchangeable.
                        key={`${occurrence.event.id}-${occurrence.occurrenceDate}`}
                        role="button"
                        tabIndex={0}
                        title={occurrence.event.title}
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpen(occurrence)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation()
                            onOpen(occurrence)
                          }
                        }}
                        className={cn(
                          'text-on-surface w-full truncate border-l-2 px-1 py-px text-[10px]',
                          eventColorClass(occurrence.event.color)
                        )}
                      >
                        {occurrenceLabel(occurrence, day)}
                      </span>
                    ))}
                    {overflow > 0 && (
                      <span className="text-on-surface-variant px-1 text-[9px]">
                        +{overflow} more
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
