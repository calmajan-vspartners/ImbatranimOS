import { useEffect, useMemo, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { ChevronLeft, ChevronRight, Download, Info, Search, Upload, X } from 'lucide-react'
import { Button, Input, cn, queryClient, useFileDialog, useSystem } from '@imbatranim/ui'
import { buildMonthGrid, buildWeekDays } from './dateUtils'
import { EventDialog } from './EventDialog'
import { MonthView } from './views/MonthView'
import { WeekView } from './views/WeekView'
import { AgendaView } from './views/AgendaView'
import { expandAll, type Occurrence } from './recurrence'
import { describeImport, eventsToIcs, icsToEvents } from './ics'
import { occurrenceOf, planDelete, planEdit } from './seriesEdit'
import { migrateLegacyCalendar } from './migrateLegacyCalendar'
import {
  EVENTS_KEY,
  useCreateEventMutation,
  useDeleteEventMutation,
  useEventsQuery,
  useImportEventsMutation,
  usePatchEventMutation,
} from './queries/calendarQueries'
import type { EditedFields } from './seriesEdit'
import type { CalendarEvent, EditScope, EventDialogState } from './types'

type ViewMode = 'month' | 'week' | 'agenda'

/** How far ahead the agenda looks. Long enough to be useful, bounded so a daily
 *  series does not expand thousands of occurrences for a list nobody scrolls. */
const AGENDA_DAYS = 120

function rangeTitle(anchor: Dayjs, view: ViewMode): string {
  if (view === 'month') return anchor.format('MMMM YYYY')
  if (view === 'agenda') return `From ${anchor.format('MMM D, YYYY')}`
  const days = buildWeekDays(anchor)
  const start = days[0]
  const end = days[6]
  if (start.isSame(end, 'month')) {
    return `${start.format('MMM D')} – ${end.format('D, YYYY')}`
  }
  if (start.isSame(end, 'year')) {
    return `${start.format('MMM D')} – ${end.format('MMM D, YYYY')}`
  }
  return `${start.format('MMM D, YYYY')} – ${end.format('MMM D, YYYY')}`
}

/**
 * The range each view needs expanded.
 *
 * This is the whole point of expanding rather than materialising: the visible
 * window is small and known, so a decade-long weekly series costs a few dozen
 * objects per render instead of 520 rows in the database.
 */
function visibleRange(anchor: Dayjs, view: ViewMode): [number, number] {
  if (view === 'month') {
    const weeks = buildMonthGrid(anchor)
    return [weeks[0][0].startOf('day').valueOf(), weeks[5][6].endOf('day').valueOf()]
  }
  if (view === 'agenda') {
    return [anchor.startOf('day').valueOf(), anchor.add(AGENDA_DAYS, 'day').endOf('day').valueOf()]
  }
  const days = buildWeekDays(anchor)
  return [days[0].startOf('day').valueOf(), days[6].endOf('day').valueOf()]
}

// Window contract: ComponentType<{ windowId: string }>. Single-instance app,
// so there is no per-window state to key on.
export function Calendar({ windowId: _windowId }: { windowId: string }) {
  const system = useSystem()
  const { data: events, isPending, isError } = useEventsQuery()
  const createEvent = useCreateEventMutation()
  const patchEvent = usePatchEventMutation()
  const removeEvent = useDeleteEventMutation()
  const importMutation = useImportEventsMutation()
  const { openFile, saveFile } = useFileDialog()

  const [anchor, setAnchor] = useState<Dayjs>(() => dayjs())
  const [view, setView] = useState<ViewMode>('month')
  const [dialogState, setDialogState] = useState<EventDialogState | null>(null)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)

  // One-time hand-over of any pre-brief-72 localStorage calendar. Guarded twice: a
  // module-level flag, and the server refusing to import into a non-empty table.
  useEffect(() => {
    void migrateLegacyCalendar(system).then((imported) => {
      if (imported) void queryClient.invalidateQueries({ queryKey: EVENTS_KEY })
    })
  }, [system])

  const [rangeStart, rangeEnd] = visibleRange(anchor, view)

  const occurrences = useMemo(() => {
    const all = expandAll(events ?? [], rangeStart, rangeEnd)
    const needle = query.trim().toLowerCase()
    if (!needle) return all
    return all.filter(
      (o) =>
        o.event.title.toLowerCase().includes(needle) ||
        (o.event.notes ?? '').toLowerCase().includes(needle)
    )
  }, [events, rangeStart, rangeEnd, query])

  function goPrev() {
    setAnchor((a) => a.subtract(1, view === 'week' ? 'week' : 'month'))
  }
  function goNext() {
    setAnchor((a) => a.add(1, view === 'week' ? 'week' : 'month'))
  }

  function handleCreate(start: number, end: number, allDay: boolean) {
    setDialogState({ mode: 'create', start, end, allDay })
  }

  function handleOpen(occurrence: Occurrence) {
    setDialogState({
      mode: 'edit',
      event: occurrence.event,
      occurrenceStart: occurrence.start,
      occurrenceEnd: occurrence.end,
      occurrenceDate: occurrence.occurrenceDate,
      occurrenceIndex: occurrence.index,
    })
  }

  /**
   * Run a series plan. The plan itself is pure (`seriesEdit`); this is the part
   * that talks to the API, in an order that cannot lose data: create the new row
   * before truncating or excepting the old one, so a failure between the two
   * leaves the original series intact rather than a hole where an event was.
   */
  function applyPlan(event: CalendarEvent, plan: ReturnType<typeof planEdit>) {
    if (plan.deleteOriginal) {
      removeEvent.mutate(event.id)
      return
    }
    if (plan.create) {
      createEvent.mutate(plan.create, {
        onSuccess: () => {
          if (plan.patch) patchEvent.mutate({ id: event.id, patch: plan.patch })
        },
      })
      return
    }
    if (plan.patch) patchEvent.mutate({ id: event.id, patch: plan.patch })
  }

  /** The occurrence the dialog is editing, as `seriesEdit` wants it. */
  function editedOccurrence(event: CalendarEvent) {
    const open = dialogState?.mode === 'edit' ? dialogState : null
    return occurrenceOf(event, open?.occurrenceStart ?? event.start, open?.occurrenceIndex ?? 0)
  }

  function handleUpdate(event: CalendarEvent, fields: EditedFields, scope: EditScope) {
    applyPlan(event, planEdit(event, editedOccurrence(event), fields, scope))
  }

  function handleDelete(event: CalendarEvent, scope: EditScope) {
    applyPlan(event, planDelete(event, editedOccurrence(event), scope))
  }

  /** Export every event — not just the visible range, which would be a surprise. */
  async function handleExport() {
    const all = events ?? []
    if (all.length === 0) {
      system.notify({
        title: 'Nothing to export',
        body: 'This calendar has no events yet.',
        level: 'info',
      })
      return
    }
    const choice = await saveFile({
      title: 'Export calendar',
      extensions: ['ics'],
      suggestedName: `calendar-${dayjs().format('YYYY-MM-DD')}.ics`,
    })
    if (!choice) return
    try {
      const text = eventsToIcs(all, Date.now())
      await system.fs.upload(
        choice.root,
        choice.path,
        new TextEncoder().encode(text),
        choice.path.split('/').pop() ?? 'calendar.ics'
      )
      system.notify({
        title: 'Calendar exported',
        body: `${all.length} event${all.length === 1 ? '' : 's'} written to ${choice.path}`,
        level: 'success',
      })
    } catch {
      system.notify({
        title: 'Export failed',
        body: 'The calendar file could not be written.',
        level: 'error',
      })
    }
  }

  async function handleImport() {
    const choice = await openFile({ title: 'Import calendar', extensions: ['ics'] })
    if (!choice) return
    try {
      const bytes = await system.fs.read(choice.root, choice.path)
      const result = icsToEvents(new TextDecoder().decode(bytes))
      if (result.events.length === 0) {
        system.notify({
          title: 'Nothing imported',
          body: 'No readable events were found in that file.',
          level: 'warning',
        })
        return
      }
      importMutation.mutate(result.events, {
        onSuccess: () => {
          // Says what was lost as well as what arrived — an import that silently
          // flattens a repeat rule is worse than one that admits it.
          system.notify({
            title: 'Calendar imported',
            body: describeImport(result),
            level: result.recurrenceDropped > 0 || result.skipped > 0 ? 'warning' : 'success',
          })
        },
        onError: () =>
          system.notify({
            title: 'Import failed',
            body: 'The events in that file were refused.',
            level: 'error',
          }),
      })
    } catch {
      system.notify({
        title: 'Import failed',
        body: 'That file could not be read.',
        level: 'error',
      })
    }
  }

  const views: ViewMode[] = ['month', 'week', 'agenda']

  return (
    <div className="bg-surface-container-lowest font-ui flex h-full flex-col">
      <div className="border-outline-variant bg-surface-container-low flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-2 border-b px-2 py-1">
        <div className="flex items-center gap-1">
          <Button variant="default" size="sm" onClick={() => setAnchor(dayjs())}>
            Today
          </Button>
          <Button variant="ghost" size="sm" onClick={goPrev} aria-label="Previous">
            <ChevronLeft size={14} />
          </Button>
          <Button variant="ghost" size="sm" onClick={goNext} aria-label="Next">
            <ChevronRight size={14} />
          </Button>
          <span className="text-on-surface ml-1 text-[13px] font-semibold">
            {rangeTitle(anchor, view)}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {searchOpen ? (
            <div className="flex w-40 items-center gap-1">
              <Input
                autoFocus
                placeholder="Search events"
                aria-label="Search events"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setQuery('')
                    setSearchOpen(false)
                  }
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label="Close search"
                onClick={() => {
                  setQuery('')
                  setSearchOpen(false)
                }}
              >
                <X size={12} />
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Search events"
              title="Search events"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={13} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            aria-label="Import an .ics file"
            title="Import an .ics file"
            onClick={() => void handleImport()}
          >
            <Upload size={13} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Export to .ics"
            title="Export every event to .ics"
            onClick={() => void handleExport()}
          >
            <Download size={13} />
          </Button>

          <div className="border-outline-variant flex border">
            {views.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                className={cn(
                  'border-outline-variant px-2.5 py-1 text-[11px] font-medium capitalize not-first:border-l',
                  view === mode
                    ? 'bg-primary text-on-primary'
                    : 'text-on-surface hover:bg-surface-container-high'
                )}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      {query.trim() !== '' && (
        <div className="border-outline-variant bg-surface-container-low text-on-surface-variant flex shrink-0 items-center gap-1.5 border-b px-2 py-1 text-[10px]">
          <Search size={10} />
          {occurrences.length} match{occurrences.length === 1 ? '' : 'es'} for “{query.trim()}”
          {view !== 'agenda' && ' in this range — the Agenda view searches further ahead'}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {isError ? (
          <p className="text-error flex h-full items-center justify-center px-6 text-center text-[12px]">
            Could not load your calendar.
          </p>
        ) : isPending ? (
          <p className="text-on-surface-variant flex h-full items-center justify-center text-[12px]">
            Loading…
          </p>
        ) : view === 'month' ? (
          <MonthView
            anchor={anchor}
            occurrences={occurrences}
            onCreate={handleCreate}
            onOpen={handleOpen}
          />
        ) : view === 'week' ? (
          <WeekView
            anchor={anchor}
            occurrences={occurrences}
            onCreate={handleCreate}
            onOpen={handleOpen}
          />
        ) : (
          <AgendaView
            anchor={anchor}
            occurrences={occurrences}
            onOpen={handleOpen}
            query={query.trim()}
          />
        )}
      </div>

      <div className="border-outline-variant bg-surface-container-low text-on-surface-variant flex h-6 shrink-0 items-center gap-1.5 border-t px-2 text-[10px]">
        <Info size={11} />
        Reminders fire while the desktop is open — this window can be closed. Events are saved in
        your computer.
      </div>

      <EventDialog
        state={dialogState}
        onClose={() => setDialogState(null)}
        onCreate={(fields) =>
          createEvent.mutate({ ...fields, recurrence: fields.recurrence ?? null, exceptions: [] })
        }
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
    </div>
  )
}
