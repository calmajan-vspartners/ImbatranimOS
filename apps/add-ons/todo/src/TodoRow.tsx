import { useEffect, useRef, useState } from 'react'
import { CalendarClock, GripVertical, Star, X } from 'lucide-react'
import { useDrag } from '@use-gesture/react'
import { cn } from '@imbatranim/core'
import {
  dateInputValue,
  dueAtFromInput,
  dueLabel,
  isDueToday,
  isOverdue,
  timeInputValue,
} from './due'
import type { Todo, TodoPatch } from './types'

/** Row height, and the step the drag gesture snaps to. */
const ROW_H = 36

type TodoRowProps = {
  todo: Todo
  index: number
  total: number
  /** Null when the current sort is derived — see `canReorder`. */
  onDragEnd: ((fromIndex: number, toIndex: number) => void) | null
  onPatch: (id: number, patch: TodoPatch) => void
  onDelete: (id: number) => void
  /** Non-null puts the row in select mode. */
  selection: { selected: boolean; onToggle: (id: number) => void } | null
  now: number
}

export function TodoRow({
  todo,
  index,
  total,
  onDragEnd,
  onPatch,
  onDelete,
  selection,
  now,
}: TodoRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(todo.text)
  const [dueOpen, setDueOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOffset, setDragOffset] = useState(0)
  const [dragging, setDragging] = useState(false)

  const { completed } = todo
  const overdue = isOverdue(todo, now)
  const dueToday = isDueToday(todo, now)

  const bind = useDrag(
    ({ movement: [, my], active, last }) => {
      if (!onDragEnd) return
      setDragging(active)
      setDragOffset(active ? my : 0)
      if (last) {
        const toIndex = Math.max(0, Math.min(total - 1, index + Math.round(my / ROW_H)))
        if (toIndex !== index) onDragEnd(index, toIndex)
        setDragOffset(0)
      }
    },
    { filterTaps: true }
  )

  function commitEdit() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== todo.text) onPatch(todo.id, { text: trimmed })
    else setDraft(todo.text)
    setEditing(false)
  }

  function cancelEdit() {
    setDraft(todo.text)
    setEditing(false)
  }

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  return (
    <div
      className={cn(
        'group border-outline-variant relative flex flex-col border-b',
        dragging && 'bg-surface-container-low z-10 opacity-90',
        selection?.selected && 'bg-surface-container'
      )}
      style={{ transform: dragging ? `translateY(${dragOffset}px)` : undefined }}
    >
      <div className="flex h-9 items-center gap-1.5 px-2">
        {selection ? (
          <input
            type="checkbox"
            checked={selection.selected}
            onChange={() => selection.onToggle(todo.id)}
            aria-label={`Select ${todo.text}`}
            className="accent-primary shrink-0"
          />
        ) : (
          // Hidden from assistive tech: dragging is a mouse affordance, and the
          // sort control plus the arrows below cover the same ground.
          <span
            {...(onDragEnd ? bind() : {})}
            aria-hidden="true"
            className={cn(
              'flex items-center opacity-0',
              onDragEnd
                ? 'cursor-grab group-hover:opacity-100 active:cursor-grabbing'
                : 'cursor-default'
            )}
            style={{ touchAction: 'none' }}
          >
            <GripVertical size={14} className="text-on-surface-variant" />
          </span>
        )}

        <button
          type="button"
          onClick={() => onPatch(todo.id, { completed: !completed })}
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center border',
            completed
              ? 'border-primary-container bg-primary-container'
              : 'border-outline-variant bg-transparent'
          )}
          aria-label={completed ? 'Mark incomplete' : 'Mark complete'}
        >
          {completed && (
            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
              <path
                d="M1 4L3.5 6.5L9 1"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="square"
              />
            </svg>
          )}
        </button>

        {editing ? (
          <input
            ref={inputRef}
            className="font-content text-on-surface min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit()
              if (e.key === 'Escape') cancelEdit()
            }}
          />
        ) : (
          <span
            className={cn(
              'font-content text-on-surface min-w-0 flex-1 cursor-text truncate text-[13px]',
              completed && 'line-through opacity-50'
            )}
            onClick={() => setEditing(true)}
          >
            {todo.text}
          </span>
        )}

        {/* Due date chip. `error` tokens only for overdue — never a new colour
            (ui-conventions §10) — and a plain emphasis for today. */}
        {todo.dueAt !== null && (
          <button
            type="button"
            onClick={() => setDueOpen((open) => !open)}
            title="Change the due date"
            className={cn(
              'font-ui shrink-0 border px-1 text-[10px] tabular-nums',
              completed
                ? 'border-outline-variant text-on-surface-variant opacity-50'
                : overdue
                  ? 'border-error text-error'
                  : dueToday
                    ? 'border-outline text-on-surface font-semibold'
                    : 'border-outline-variant text-on-surface-variant'
            )}
          >
            {dueLabel(todo.dueAt, now)}
          </button>
        )}

        <button
          type="button"
          onClick={() => onPatch(todo.id, { priority: !todo.priority })}
          aria-pressed={todo.priority}
          aria-label={todo.priority ? 'Remove importance' : 'Mark important'}
          title={todo.priority ? 'Important' : 'Mark important'}
          className={cn(
            'shrink-0 p-0.5',
            todo.priority
              ? 'text-primary'
              : 'text-on-surface-variant hover:text-on-surface opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
          )}
        >
          <Star size={12} fill={todo.priority ? 'currentColor' : 'none'} />
        </button>

        {todo.dueAt === null && (
          <button
            type="button"
            onClick={() => setDueOpen((open) => !open)}
            aria-label="Add a due date"
            title="Add a due date"
            className="text-on-surface-variant hover:text-on-surface shrink-0 p-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          >
            <CalendarClock size={12} />
          </button>
        )}

        <button
          type="button"
          onClick={() => onDelete(todo.id)}
          className="text-on-surface-variant hover:text-error shrink-0 p-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={`Delete ${todo.text}`}
        >
          <X size={13} />
        </button>
      </div>

      {dueOpen && (
        <DueEditor
          dueAt={todo.dueAt}
          onChange={(dueAt) => {
            onPatch(todo.id, { dueAt })
            setDueOpen(false)
          }}
          onClose={() => setDueOpen(false)}
        />
      )}
    </div>
  )
}

/**
 * The inline due-date editor.
 *
 * Inline in the row rather than a dialog: setting a date is a one-field change and
 * the row is the context. `dueAtFromInput` is imported by the caller of `onChange`
 * so the encoding decision (a bare date means the END of that day) lives in one
 * place.
 */
function DueEditor({
  dueAt,
  onChange,
  onClose,
}: {
  dueAt: number | null
  onChange: (dueAt: number | null) => void
  onClose: () => void
}) {
  const [date, setDate] = useState(dueAt === null ? '' : dateInputValue(dueAt))
  const [time, setTime] = useState(dueAt === null ? '' : timeInputValue(dueAt))

  return (
    <div className="border-outline-variant bg-surface-container-low flex flex-wrap items-center gap-1.5 border-t px-2 py-1.5">
      <input
        type="date"
        value={date}
        autoFocus
        aria-label="Due date"
        onChange={(e) => setDate(e.target.value)}
        className="border-outline-variant bg-surface-container-lowest font-content text-on-surface border px-1.5 py-0.5 text-[12px] outline-none"
      />
      <input
        type="time"
        value={time}
        aria-label="Due time (optional)"
        onChange={(e) => setTime(e.target.value)}
        disabled={!date}
        className="border-outline-variant bg-surface-container-lowest font-content text-on-surface border px-1.5 py-0.5 text-[12px] outline-none disabled:opacity-50"
      />
      <button
        type="button"
        onClick={() => onChange(dueAtFromInput(date, time || undefined))}
        disabled={!date}
        className="border-primary bg-primary text-on-primary font-ui border px-1.5 py-0.5 text-[11px] disabled:opacity-50"
      >
        Set
      </button>
      {dueAt !== null && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="border-outline-variant text-on-surface font-ui border px-1.5 py-0.5 text-[11px]"
        >
          Clear
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        className="text-on-surface-variant font-ui px-1 text-[11px]"
      >
        Cancel
      </button>
    </div>
  )
}
