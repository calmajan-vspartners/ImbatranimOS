import dayjs, { type Dayjs } from 'dayjs'
import { cn, ScrollArea } from '@imbatranim/ui'
import {
  HOURS,
  HOUR_HEIGHT,
  buildWeekDays,
  formatHourLabel,
  minutesSinceMidnight,
} from '../dateUtils'
import { occurrencesOnDay } from '../recurrence'
import { eventColorClass } from '../eventStyle'
import type { Occurrence } from '../recurrence'

const GUTTER_WIDTH = 48
const MIN_EVENT_HEIGHT = 18

type WeekViewProps = {
  anchor: Dayjs
  occurrences: Occurrence[]
  onCreate: (start: number, end: number, allDay: boolean) => void
  onOpen: (occurrence: Occurrence) => void
}

/**
 * The week grid.
 *
 * Brief 72 split it in two, which is what a week view has to be:
 *
 * - An **all-day row** above the time grid, where all-day events sit and span the
 *   columns they cover. Before this they were pinned to midnight of their start day
 *   inside the timed grid, so a three-day trip was an 18px block on one day and
 *   nothing on the other two.
 * - The **time grid** holds only timed events, clipped per day. An event from 22:00
 *   to 02:00 draws 22:00–24:00 in one column and 00:00–02:00 in the next, instead
 *   of a block running off the bottom of a single day.
 */
export function WeekView({ anchor, occurrences, onCreate, onOpen }: WeekViewProps) {
  const days = buildWeekDays(anchor)
  const today = dayjs()
  const columnHeight = HOURS.length * HOUR_HEIGHT
  const weekStart = days[0].startOf('day')
  const weekEnd = days[6].endOf('day')

  /**
   * The banner row is for **all-day** events only, single- or multi-day.
   *
   * A timed event that happens to cross midnight (22:00 → 02:00) stays in the grid
   * and is clipped per day, because a banner would throw away the only interesting
   * thing about it — when it starts and ends. Measured: routing it to the banner
   * turned a four-hour night shift into a two-day bar with no times on it.
   */
  const banners = occurrences
    .filter((o) => o.event.allDay)
    .filter((o) => o.start <= weekEnd.valueOf() && o.end >= weekStart.valueOf())
    .sort((a, b) => a.start - b.start || b.end - a.end)

  const timed = occurrences.filter((o) => !o.event.allDay)

  const gridColumns = `${GUTTER_WIDTH}px repeat(7, 1fr)`

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div
        className="border-outline-variant grid border-b"
        style={{ gridTemplateColumns: gridColumns }}
      >
        <div />
        {days.map((day) => {
          const isToday = day.isSame(today, 'day')
          return (
            <div
              key={day.valueOf()}
              className="border-outline-variant flex flex-col items-center gap-0.5 border-l py-1"
            >
              <span className="text-on-surface-variant text-[10px] font-semibold tracking-wide uppercase">
                {day.format('ddd')}
              </span>
              <span
                className={cn(
                  'flex h-5 w-5 items-center justify-center text-[12px]',
                  isToday && 'bg-primary text-on-primary font-semibold'
                )}
              >
                {day.date()}
              </span>
            </div>
          )
        })}
      </div>

      {banners.length > 0 && (
        <div
          className="border-outline-variant bg-surface-container-lowest grid shrink-0 border-b"
          style={{ gridTemplateColumns: gridColumns }}
        >
          <div className="text-on-surface-variant flex items-start justify-end pt-1 pr-1 text-[9px] uppercase">
            All day
          </div>
          {/* One cell spanning all seven columns, with each banner absolutely
              positioned across the days it covers — a grid row per banner would
              force every event onto its own line and eat the time grid. */}
          <div className="relative col-span-7" style={{ height: banners.length * 20 + 4 }}>
            {banners.map((occurrence, i) => {
              // Clamp to the visible week so an event that started last month
              // begins at the left edge instead of off-screen.
              const firstDay = Math.max(
                0,
                dayjs(occurrence.start).startOf('day').diff(weekStart, 'day')
              )
              const lastDay = Math.min(
                6,
                dayjs(occurrence.end).startOf('day').diff(weekStart, 'day')
              )
              const span = Math.max(1, lastDay - firstDay + 1)
              const continuesBefore = occurrence.start < weekStart.valueOf()
              const continuesAfter = occurrence.end > weekEnd.valueOf()

              return (
                <div
                  key={`${occurrence.event.id}-${occurrence.occurrenceDate}`}
                  role="button"
                  tabIndex={0}
                  title={occurrence.event.title}
                  onClick={() => onOpen(occurrence)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') onOpen(occurrence)
                  }}
                  className={cn(
                    'text-on-surface absolute truncate border-l-2 px-1 text-[10px] leading-[18px]',
                    eventColorClass(occurrence.event.color)
                  )}
                  style={{
                    top: i * 20 + 2,
                    left: `calc(${(firstDay / 7) * 100}% + 2px)`,
                    width: `calc(${(span / 7) * 100}% - 4px)`,
                  }}
                >
                  {continuesBefore && '← '}
                  {occurrence.event.title}
                  {continuesAfter && ' →'}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="grid" style={{ gridTemplateColumns: gridColumns }}>
          <div className="flex flex-col">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="border-outline-variant text-on-surface-variant border-b pr-1 text-right text-[10px]"
                style={{ height: HOUR_HEIGHT }}
              >
                {hour > 0 && formatHourLabel(hour)}
              </div>
            ))}
          </div>

          {days.map((day) => {
            const dayStart = day.startOf('day')
            const dayOccurrences = occurrencesOnDay(timed, day)

            return (
              <div
                key={day.valueOf()}
                className="border-outline-variant relative border-l"
                style={{ height: columnHeight }}
              >
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    role="button"
                    tabIndex={0}
                    aria-label={`Add an event at ${formatHourLabel(hour)} on ${day.format('MMMM D')}`}
                    onClick={() => {
                      const start = day.hour(hour).minute(0).second(0).millisecond(0)
                      onCreate(start.valueOf(), start.add(1, 'hour').valueOf(), false)
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return
                      const start = day.hour(hour).minute(0).second(0).millisecond(0)
                      onCreate(start.valueOf(), start.add(1, 'hour').valueOf(), false)
                    }}
                    className="border-outline-variant hover:bg-surface-container absolute inset-x-0 cursor-pointer border-b"
                    style={{ top: hour * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                  />
                ))}

                {dayOccurrences.map((occurrence) => {
                  // Clip to this day, so a block never runs past midnight.
                  const visibleStart = Math.max(occurrence.start, dayStart.valueOf())
                  const visibleEnd = Math.min(occurrence.end, day.endOf('day').valueOf())
                  const top = (minutesSinceMidnight(visibleStart) / 60) * HOUR_HEIGHT
                  const durationMin = Math.max((visibleEnd - visibleStart) / 60_000, 15)
                  const height = Math.max((durationMin / 60) * HOUR_HEIGHT, MIN_EVENT_HEIGHT)

                  return (
                    <div
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
                        'text-on-surface absolute inset-x-0.5 z-10 cursor-pointer overflow-hidden border-l-2 px-1 py-px text-[10px]',
                        eventColorClass(occurrence.event.color)
                      )}
                      style={{ top, height }}
                    >
                      <span className="font-semibold">{occurrence.event.title}</span>
                      <span className="text-on-surface-variant ml-1">
                        {dayjs(occurrence.start).format('HH:mm')}
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
