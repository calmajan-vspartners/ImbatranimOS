import { useState } from 'react'
import dayjs from 'dayjs'
import { Repeat } from 'lucide-react'
import { Button, Checkbox, Dialog, Input, Select, cn, useConfirm } from '@imbatranim/core'
import { COLOR_OPTIONS, COLOR_SWATCH } from './eventStyle'
import { RecurrenceFields } from './RecurrenceFields'
import { draftFromRule, ruleFromDraft, type RecurrenceDraft } from './recurrenceDraft'
import { needsScopeChoice } from './seriesEdit'
import type { CalendarEvent, EditScope, EventColor, EventDialogState } from './types'
import type { EditedFields } from './seriesEdit'

const REMINDER_OPTIONS = [
  { value: 'none', label: 'No reminder' },
  { value: '5', label: '5 minutes before' },
  { value: '10', label: '10 minutes before' },
  { value: '15', label: '15 minutes before' },
  { value: '30', label: '30 minutes before' },
  { value: '60', label: '1 hour before' },
  { value: '1440', label: '1 day before' },
]

const SCOPE_OPTIONS: { value: EditScope; label: string; hint: string }[] = [
  { value: 'single', label: 'This event', hint: 'Detaches it from the series' },
  { value: 'following', label: 'This and following', hint: 'Splits the series here' },
  { value: 'all', label: 'All events', hint: 'Changes the whole series' },
]

type EventDialogProps = {
  state: EventDialogState | null
  onClose: () => void
  onCreate: (fields: EditedFields) => void
  onUpdate: (event: CalendarEvent, fields: EditedFields, scope: EditScope) => void
  onDelete: (event: CalendarEvent, scope: EditScope) => void
}

type FormState = {
  title: string
  notes: string
  allDay: boolean
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  reminder: string
  color: EventColor | 'none'
  recurrence: RecurrenceDraft
}

function toDate(ms: number): string {
  return dayjs(ms).format('YYYY-MM-DD')
}

function toTime(ms: number): string {
  return dayjs(ms).format('HH:mm')
}

/**
 * The form for an edit.
 *
 * The dates come from the **occurrence** the user clicked, not from the series —
 * opening the third Monday of a weekly standup must show that Monday's date. The
 * recurrence rule comes from the series, because that is where it lives.
 */
function formFromEvent(
  event: CalendarEvent,
  occurrenceStart: number,
  occurrenceEnd: number
): FormState {
  return {
    title: event.title,
    notes: event.notes ?? '',
    allDay: event.allDay,
    startDate: toDate(occurrenceStart),
    startTime: toTime(occurrenceStart),
    endDate: toDate(occurrenceEnd),
    endTime: toTime(occurrenceEnd),
    reminder: event.reminderMinutes ? String(event.reminderMinutes) : 'none',
    color: event.color ?? 'none',
    recurrence: draftFromRule(event.recurrence),
  }
}

function formFromSlot(start: number, end: number, allDay: boolean): FormState {
  return {
    title: '',
    notes: '',
    allDay,
    startDate: toDate(start),
    startTime: toTime(start),
    endDate: toDate(end),
    endTime: toTime(end),
    reminder: 'none',
    color: 'none',
    recurrence: draftFromRule(null),
  }
}

/** Stable identity for a dialog state — used to resync the form when the
 * caller swaps in a different event/slot (state adjustment during render,
 * not an effect — mirrors the resync idiom used by Bookmarks/StickyNotes). */
function stateKey(state: EventDialogState | null): string {
  if (!state) return 'closed'
  return state.mode === 'edit'
    ? `edit-${state.event.id}-${state.occurrenceDate}`
    : `create-${state.start}-${state.end}`
}

/** The hour a timed event defaults to when it was not created from a time slot. */
const DEFAULT_HOUR = '09:00'
const DEFAULT_END_HOUR = '10:00'

/**
 * Toggle all-day, fixing up the times.
 *
 * Clicking a day in the month grid creates an **all-day** slot spanning
 * 00:00–23:59, so unticking "All day" left a midnight-to-midnight event — a
 * 24-hour block, which is nobody's meeting. Unticking now snaps to a normal hour
 * instead. Only when the whole thing sits on one day: a three-day all-day event
 * being given times should keep its span, not collapse to an hour.
 */
function withAllDay(form: FormState, allDay: boolean): FormState {
  if (allDay || form.startDate !== form.endDate) return { ...form, allDay }
  const wholeDay =
    form.startTime === '00:00' && (form.endTime === '23:59' || form.endTime === '00:00')
  if (!wholeDay) return { ...form, allDay }
  return { ...form, allDay, startTime: DEFAULT_HOUR, endTime: DEFAULT_END_HOUR }
}

function initialForm(state: EventDialogState | null): FormState {
  if (!state) return formFromSlot(Date.now(), Date.now(), true)
  return state.mode === 'edit'
    ? formFromEvent(state.event, state.occurrenceStart, state.occurrenceEnd)
    : formFromSlot(state.start, state.end, state.allDay)
}

export function EventDialog({ state, onClose, onCreate, onUpdate, onDelete }: EventDialogProps) {
  const { confirm, confirmDialog } = useConfirm()

  const [form, setForm] = useState<FormState>(() => initialForm(state))
  const [key, setKey] = useState(() => stateKey(state))
  const [error, setError] = useState<string | null>(null)
  // Which part of a series an edit applies to. "This event" is the safe default:
  // it changes the least, and the other two are one click away.
  const [scope, setScope] = useState<EditScope>('single')

  const nextKey = stateKey(state)
  if (nextKey !== key) {
    setKey(nextKey)
    setError(null)
    setScope('single')
    if (state) setForm(initialForm(state))
  }

  const editing = state?.mode === 'edit' ? state.event : null
  const askScope = editing !== null && needsScopeChoice(editing)

  function buildFields(): EditedFields | null {
    if (!form.title.trim()) {
      setError('Title is required.')
      return null
    }

    const start = form.allDay
      ? dayjs(form.startDate).startOf('day')
      : dayjs(`${form.startDate}T${form.startTime}`)
    const end = form.allDay
      ? dayjs(form.endDate).endOf('day')
      : dayjs(`${form.endDate}T${form.endTime}`)

    if (!start.isValid() || !end.isValid()) {
      setError('Those dates are not valid.')
      return null
    }
    if (end.isBefore(start)) {
      setError('End must be after start.')
      return null
    }

    const rule = ruleFromDraft(form.recurrence)
    if (rule?.until && dayjs(rule.until).endOf('day').isBefore(start)) {
      // Otherwise the event silently has no occurrences at all — it exists in
      // storage and appears nowhere, which reads as a bug rather than a choice.
      setError('The repeat ends before the first occurrence.')
      return null
    }

    return {
      title: form.title.trim(),
      notes: form.notes.trim() || undefined,
      allDay: form.allDay,
      start: start.valueOf(),
      end: end.valueOf(),
      color: form.color === 'none' ? undefined : form.color,
      reminderMinutes: form.reminder === 'none' ? undefined : Number(form.reminder),
      recurrence: rule,
    }
  }

  function handleSave() {
    const fields = buildFields()
    if (!fields) return
    if (editing) onUpdate(editing, fields, askScope ? scope : 'all')
    else onCreate(fields)
    onClose()
  }

  async function handleDelete() {
    if (!editing) return
    const scopeLabel = askScope
      ? {
          single: 'this occurrence of',
          following: 'this and every later',
          all: 'every occurrence of',
        }[scope]
      : ''
    const ok = await confirm({
      title: 'Delete event',
      message: askScope ? `Delete ${scopeLabel} “${editing.title}”?` : `Delete “${editing.title}”?`,
      destructive: true,
    })
    if (ok) {
      onDelete(editing, askScope ? scope : 'all')
      onClose()
    }
  }

  return (
    <>
      <Dialog
        open={state !== null}
        onOpenChange={(next) => !next && onClose()}
        title={state?.mode === 'edit' ? 'Edit event' : 'New event'}
        className="max-h-[80vh] w-[360px] overflow-y-auto"
      >
        <div className="flex flex-col gap-3">
          <Input
            label="Title"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Event title"
            autoFocus
          />

          <Checkbox
            label="All day"
            checked={form.allDay}
            onCheckedChange={(checked) => setForm((f) => withAllDay(f, checked === true))}
          />

          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <Input
                label="Start date"
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              />
            </div>
            {!form.allDay && (
              <div className="w-32 shrink-0">
                <Input
                  label="Start time"
                  type="time"
                  value={form.startTime}
                  onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
                />
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <Input
                label="End date"
                type="date"
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
              />
            </div>
            {!form.allDay && (
              <div className="w-32 shrink-0">
                <Input
                  label="End time"
                  type="time"
                  value={form.endTime}
                  onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
                />
              </div>
            )}
          </div>

          <RecurrenceFields
            draft={form.recurrence}
            onChange={(recurrence) => setForm((f) => ({ ...f, recurrence }))}
          />

          <Select
            label="Reminder"
            options={REMINDER_OPTIONS}
            value={form.reminder}
            onValueChange={(value) => setForm((f) => ({ ...f, reminder: value as string }))}
          />

          <div className="flex flex-col gap-1">
            <span className="font-ui text-on-surface-variant text-[11px] font-semibold tracking-wider uppercase">
              Colour
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Default colour"
                aria-pressed={form.color === 'none'}
                onClick={() => setForm((f) => ({ ...f, color: 'none' }))}
                className={cn(
                  'bg-primary h-5 w-5 border',
                  form.color === 'none' ? 'border-on-surface' : 'border-outline-variant'
                )}
              />
              {COLOR_OPTIONS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={color}
                  aria-pressed={form.color === color}
                  onClick={() => setForm((f) => ({ ...f, color }))}
                  className={cn(
                    'h-5 w-5 border',
                    COLOR_SWATCH[color],
                    form.color === color ? 'border-on-surface' : 'border-outline-variant'
                  )}
                />
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <span className="font-ui text-on-surface-variant text-[11px] font-semibold tracking-wider uppercase">
              Notes
            </span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Optional notes"
              rows={3}
              className="border-outline-variant bg-surface-container-lowest font-content text-on-surface focus:border-primary focus:ring-primary/40 w-full resize-none border px-2.5 py-1.5 text-[13px] outline-none focus:ring-2"
            />
          </label>

          {askScope && (
            <div className="border-outline-variant bg-surface-container-low flex flex-col gap-1.5 border p-2">
              <span className="font-ui text-on-surface-variant flex items-center gap-1 text-[11px] font-semibold tracking-wider uppercase">
                <Repeat size={11} />
                Apply to
              </span>
              {SCOPE_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-start gap-2 text-[11px]">
                  <input
                    type="radio"
                    name="edit-scope"
                    checked={scope === option.value}
                    onChange={() => setScope(option.value)}
                    className="accent-primary mt-0.5"
                  />
                  <span>
                    <span className="text-on-surface font-semibold">{option.label}</span>
                    <span className="text-on-surface-variant ml-1">— {option.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          {error && <p className="text-error text-[11px]">{error}</p>}

          <div className="mt-1 flex items-center justify-between">
            <div>
              {editing && (
                <Button variant="destructive" size="sm" onClick={handleDelete}>
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="default" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={handleSave}>
                Save
              </Button>
            </div>
          </div>
        </div>
      </Dialog>
      {confirmDialog}
    </>
  )
}
