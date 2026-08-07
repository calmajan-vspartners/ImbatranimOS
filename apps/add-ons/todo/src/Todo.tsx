import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, CheckCheck, FolderInput, ListPlus, Plus, Trash2, X } from 'lucide-react'
import { ScrollArea, cn, useConfirm, usePrompt, useSystem } from '@imbatranim/ui'
import { TodoRow } from './TodoRow'
import { hasHiddenSelection, pruneSelection } from './bulkSelection'
import { dueAtFromInput, isOverdue } from './due'
import { SORT_LABELS, SORT_MODES, canReorder, sortTodos } from './sort'
import {
  useClearCompletedMutation,
  useCreateListMutation,
  useCreateTodoMutation,
  useDeleteListMutation,
  useDeleteTodoMutation,
  useListsQuery,
  useReorderTodosMutation,
  useTodosQuery,
  useUpdateTodoMutation,
} from './queries/todosQueries'
import type { Filter, SortMode, Todo as TodoItem } from './types'

const FILTERS: Filter[] = ['all', 'active', 'completed']

const EMPTY_MESSAGES: Record<Filter, string> = {
  all: 'No tasks',
  active: 'Nothing active',
  completed: 'Nothing completed',
}

/**
 * How often the relative due labels are refreshed.
 *
 * A minute is enough: the labels are "Today", "Tomorrow", "3 days late" and the
 * occasional `HH:mm`, none of which change faster. Without a tick at all, a window
 * left open overnight would keep calling yesterday's tasks "Today".
 */
const CLOCK_TICK_MS = 60_000

function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => clearInterval(id)
  }, [])
  return now
}

export function Todo({ windowId: _windowId }: { windowId: string }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [listId, setListId] = useState<number | null>(null)
  const [sort, setSort] = useState<SortMode>('manual')
  const [addText, setAddText] = useState('')
  const [addDue, setAddDue] = useState('')
  const [addDueOpen, setAddDueOpen] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [selectMode, setSelectMode] = useState(false)
  const addInputRef = useRef<HTMLInputElement>(null)
  const now = useMinuteClock()
  const system = useSystem()

  const { confirm, confirmDialog } = useConfirm()
  const { prompt, promptDialog } = usePrompt()

  const scope = { filter, listId }
  const { data: serverItems, isPending } = useTodosQuery(scope)
  const { data: lists } = useListsQuery()

  const createTodo = useCreateTodoMutation()
  const updateTodo = useUpdateTodoMutation()
  const deleteTodo = useDeleteTodoMutation()
  const reorder = useReorderTodosMutation()
  const clearCompleted = useClearCompletedMutation()
  const createList = useCreateListMutation()
  const deleteList = useDeleteListMutation()

  /**
   * Local order, so a drag moves the row under the cursor instead of waiting for a
   * round trip. Resynced when the server data changes — state adjustment during
   * render rather than an effect, which is the house idiom here.
   */
  const [items, setItems] = useState<TodoItem[]>([])
  const [prevServerItems, setPrevServerItems] = useState(serverItems)
  if (serverItems !== prevServerItems) {
    setPrevServerItems(serverItems)
    setItems(serverItems ?? [])
  }

  const visible = useMemo(() => sortTodos(items, sort), [items, sort])

  // Confine the bulk selection to visible rows. A filter/list switch (or a reload)
  // changes what is on screen, so without this a bulk Delete/Complete could act on
  // a task the user can no longer see (M2). Adjusted during render — the house
  // idiom here — and converges: after pruning, nothing hidden remains selected.
  const visibleIds = useMemo(() => new Set(visible.map((t) => t.id)), [visible])
  if (hasHiddenSelection(selected, visibleIds)) {
    setSelected(pruneSelection(selected, visibleIds))
  }

  const reorderable = canReorder(sort)
  // Only meaningful when the loaded scope can contain completed todos — the Active
  // tab has never seen them, so counting its rows would always give 0.
  const knowsCompletedCount = filter !== 'active'
  const completedCount = items.filter((t) => t.completed).length
  const overdueCount = items.filter((t) => isOverdue(t, now)).length

  function handleDragEnd(fromIndex: number, toIndex: number) {
    const next = [...visible]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    setItems(next)
    // The ids of the VISIBLE rows only. The server treats them as a relative
    // reordering and leaves rows this view filters out exactly where they are — it
    // used to stamp 1..N across the whole table, which collided with the hidden
    // rows' positions.
    reorder.mutate(next.map((t) => t.id))
  }

  function handleAdd() {
    const text = addText.trim()
    if (!text) return
    createTodo.mutate({
      text,
      dueAt: addDue ? dueAtFromInput(addDue) : null,
      // A task added while looking at one list belongs to it — anything else means
      // typing into a list and watching the task land somewhere else.
      listId,
    })
    setAddText('')
    // Keeps the date (several tasks often share a day) and keeps focus, so adding
    // the next one is just typing.
    addInputRef.current?.focus()
  }

  /**
   * Clear completed.
   *
   * The count is only *known* when the loaded list can contain completed todos —
   * on the Active tab the client has never seen them. Rather than disabling the
   * button there (which made it look broken: the action is perfectly well defined,
   * the client just cannot count), it asks without a number and reports what the
   * server actually deleted.
   */
  async function handleClearCompleted() {
    if (knowsCompletedCount && completedCount === 0) return
    const ok = await confirm({
      title: 'Clear completed',
      message: knowsCompletedCount
        ? `Delete ${completedCount} completed task${completedCount === 1 ? '' : 's'}${listId === null ? '' : ' in this list'}? This cannot be undone.`
        : `Delete every completed task${listId === null ? '' : ' in this list'}? This cannot be undone.`,
      destructive: true,
    })
    if (!ok) return
    clearCompleted.mutate(listId, {
      onSuccess: ({ deleted }) => {
        if (deleted === 0) {
          system.notify({
            title: 'Nothing to clear',
            body: 'There were no completed tasks here.',
            level: 'info',
          })
        } else if (!knowsCompletedCount) {
          system.notify({
            title: 'Completed tasks cleared',
            body: `${deleted} task${deleted === 1 ? '' : 's'} deleted.`,
            level: 'success',
          })
        }
      },
    })
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return
    const ok = await confirm({
      title: 'Delete tasks',
      message: `Delete ${selected.size} selected task${selected.size === 1 ? '' : 's'}? This cannot be undone.`,
      destructive: true,
    })
    if (!ok) return
    for (const id of selected) deleteTodo.mutate(id)
    setSelected(new Set())
    setSelectMode(false)
  }

  /**
   * Refile every selected task at once (brief 117).
   *
   * The same update mutation the row's own picker uses, one call per task —
   * there is no batch endpoint and inventing one for this would be a schema
   * change for a loop. Selection is cleared afterwards, as Complete and Delete
   * already do, because the rows may no longer be visible under the current
   * list filter.
   */
  async function handleBulkMove() {
    if (selected.size === 0) return
    const options = [
      { id: 'none', label: 'No list' },
      ...(lists ?? []).map((l) => ({ id: String(l.id), label: l.name })),
    ]
    const picked = await prompt({
      title: `Move ${selected.size} task${selected.size === 1 ? '' : 's'}`,
      message: `Type a list name to file them under: ${options.map((o) => o.label).join(', ')}`,
      placeholder: options[1]?.label ?? 'No list',
      confirmLabel: 'Move',
    })
    const name = picked?.trim()
    if (!name) return
    const match = options.find((o) => o.label.toLowerCase() === name.toLowerCase())
    if (!match) {
      system.notify({ title: 'No such list', body: name, level: 'error' })
      return
    }
    const target = match.id === 'none' ? null : Number(match.id)
    for (const id of selected) updateTodo.mutate({ id, patch: { listId: target } })
    setSelected(new Set())
    setSelectMode(false)
  }

  function handleBulkComplete() {
    for (const id of selected) updateTodo.mutate({ id, patch: { completed: true } })
    setSelected(new Set())
    setSelectMode(false)
  }

  async function handleNewList() {
    const name = await prompt({
      title: 'New list',
      message: 'Tasks can be filed under one list.',
      placeholder: 'Work',
      confirmLabel: 'Create',
    })
    if (!name?.trim()) return
    createList.mutate(name.trim(), { onSuccess: (created) => setListId(created.id) })
  }

  async function handleDeleteList() {
    const current = lists?.find((l) => l.id === listId)
    if (!current) return
    const ok = await confirm({
      title: 'Delete list',
      message: `Delete “${current.name}”? Its tasks are kept and become unfiled.`,
      destructive: true,
    })
    if (!ok) return
    deleteList.mutate(current.id, {
      onSuccess: (result) => {
        setListId(null)
        if (result.unfiled > 0) {
          system.notify({
            title: 'List deleted',
            body: `${result.unfiled} task${result.unfiled === 1 ? '' : 's'} kept, now unfiled.`,
            level: 'info',
          })
        }
      },
    })
  }

  function toggleSelected(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const tab = 'font-ui flex h-full items-center px-2.5 text-[12px] capitalize whitespace-nowrap'

  return (
    <div className="bg-surface-container-lowest flex h-full flex-col">
      {/* Lists */}
      <div className="border-outline-variant flex min-h-8 shrink-0 flex-wrap items-center gap-1 border-b px-1.5 py-1">
        <button
          type="button"
          onClick={() => setListId(null)}
          className={cn(
            'font-ui border px-1.5 py-0.5 text-[11px]',
            listId === null
              ? 'border-primary bg-primary text-on-primary'
              : 'border-outline-variant text-on-surface-variant hover:text-on-surface'
          )}
        >
          All
        </button>
        {(lists ?? []).map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setListId(l.id)}
            className={cn(
              'font-ui max-w-28 truncate border px-1.5 py-0.5 text-[11px]',
              listId === l.id
                ? 'border-primary bg-primary text-on-primary'
                : 'border-outline-variant text-on-surface-variant hover:text-on-surface'
            )}
          >
            {l.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void handleNewList()}
          aria-label="New list"
          title="New list"
          className="text-on-surface-variant hover:text-on-surface p-0.5"
        >
          <ListPlus size={13} />
        </button>
        {listId !== null && (
          <button
            type="button"
            onClick={() => void handleDeleteList()}
            aria-label="Delete this list"
            title="Delete this list (tasks are kept)"
            className="text-on-surface-variant hover:text-error ml-auto p-0.5"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Filter + sort */}
      <div className="border-outline-variant flex h-8 shrink-0 items-center border-b">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              tab,
              'text-on-surface-variant',
              filter === f && 'border-primary text-on-surface border-b-2 font-semibold'
            )}
          >
            {f}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 pr-1.5">
          {overdueCount > 0 && (
            <span
              className="border-error text-error font-ui border px-1 text-[10px]"
              title={`${overdueCount} overdue`}
            >
              {overdueCount} late
            </span>
          )}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            aria-label="Sort order"
            className="border-outline-variant bg-surface-container-lowest font-ui text-on-surface border px-1 py-0.5 text-[11px] outline-none"
          >
            {SORT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {SORT_LABELS[mode]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Bulk actions */}
      <div className="border-outline-variant bg-surface-container-low flex min-h-7 shrink-0 flex-wrap items-center gap-1.5 border-b px-1.5 py-1">
        <button
          type="button"
          onClick={() => {
            setSelectMode((on) => !on)
            setSelected(new Set())
          }}
          aria-pressed={selectMode}
          className={cn(
            'font-ui border px-1.5 py-0.5 text-[11px]',
            selectMode
              ? 'border-primary bg-primary text-on-primary'
              : 'border-outline-variant text-on-surface-variant hover:text-on-surface'
          )}
        >
          {selectMode ? 'Done selecting' : 'Select'}
        </button>
        {selectMode ? (
          <>
            <span className="font-ui text-on-surface-variant text-[11px]">
              {selected.size} selected
            </span>
            <button
              type="button"
              onClick={handleBulkComplete}
              disabled={selected.size === 0}
              className="border-outline-variant text-on-surface font-ui flex items-center gap-1 border px-1.5 py-0.5 text-[11px] disabled:opacity-50"
            >
              <CheckCheck size={11} />
              Complete
            </button>
            <button
              type="button"
              onClick={() => void handleBulkMove()}
              disabled={selected.size === 0}
              className="border-outline-variant text-on-surface font-ui flex items-center gap-1 border px-1.5 py-0.5 text-[11px] disabled:opacity-50"
            >
              <FolderInput size={11} />
              Move
            </button>
            <button
              type="button"
              onClick={() => void handleBulkDelete()}
              disabled={selected.size === 0}
              className="border-outline-variant text-error font-ui flex items-center gap-1 border px-1.5 py-0.5 text-[11px] disabled:opacity-50"
            >
              <Trash2 size={11} />
              Delete
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void handleClearCompleted()}
            disabled={knowsCompletedCount && completedCount === 0}
            className="border-outline-variant text-on-surface-variant hover:text-on-surface font-ui border px-1.5 py-0.5 text-[11px] disabled:opacity-50"
          >
            Clear completed{knowsCompletedCount && completedCount > 0 ? ` (${completedCount})` : ''}
          </button>
        )}
        {!reorderable && (
          <span
            className="font-ui text-on-surface-variant ml-auto text-[10px]"
            title="Switch to My order to drag tasks around"
          >
            drag needs “{SORT_LABELS.manual}”
          </span>
        )}
      </div>

      {/* The list. min-h-0 so this is the element that shrinks, never the add row. */}
      <ScrollArea className="min-h-0 flex-1">
        {isPending ? (
          <div className="font-ui text-on-surface-variant flex h-20 items-center justify-center text-[12px]">
            Loading…
          </div>
        ) : visible.length === 0 ? (
          <div className="font-ui text-on-surface-variant flex h-20 items-center justify-center text-[12px]">
            {EMPTY_MESSAGES[filter]}
          </div>
        ) : (
          visible.map((todo, i) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              index={i}
              total={visible.length}
              now={now}
              onDragEnd={reorderable ? handleDragEnd : null}
              onPatch={(id, patch) => updateTodo.mutate({ id, patch })}
              onDelete={(id) => deleteTodo.mutate(id)}
              lists={lists ?? []}
              selection={
                selectMode ? { selected: selected.has(todo.id), onToggle: toggleSelected } : null
              }
            />
          ))
        )}
      </ScrollArea>

      {/* Add. shrink-0 so a long list can never push it under the taskbar. */}
      <div className="border-outline-variant bg-surface-container-low shrink-0 border-t">
        <div className="flex h-9 items-center gap-1 px-2">
          <input
            ref={addInputRef}
            // Focused on open: the brief asks for keyboard-first adding, and this is
            // the field you always want.
            autoFocus
            className="font-content text-on-surface placeholder:text-on-surface-variant min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            placeholder={
              listId === null
                ? 'Add a task…'
                : `Add to ${lists?.find((l) => l.id === listId)?.name ?? 'list'}…`
            }
            value={addText}
            onChange={(e) => setAddText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd()
              // Escape clears the field rather than blurring, so a half-typed task
              // can be abandoned without reaching for the mouse.
              if (e.key === 'Escape') {
                setAddText('')
                setAddDue('')
                setAddDueOpen(false)
              }
            }}
          />
          <button
            type="button"
            onClick={() => setAddDueOpen((open) => !open)}
            aria-pressed={addDueOpen}
            aria-label="Set a due date for new tasks"
            title="Set a due date for new tasks"
            className={cn('shrink-0 p-0.5', addDue ? 'text-primary' : 'text-on-surface-variant')}
          >
            <CalendarClock size={13} />
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!addText.trim()}
            aria-label="Add task"
            className="text-on-surface-variant hover:text-on-surface shrink-0 p-0.5 disabled:opacity-40"
          >
            <Plus size={14} />
          </button>
        </div>
        {addDueOpen && (
          <div className="border-outline-variant flex items-center gap-1.5 border-t px-2 py-1.5">
            <span className="font-ui text-on-surface-variant text-[10px] tracking-wider uppercase">
              Due
            </span>
            <input
              type="date"
              value={addDue}
              aria-label="Due date for new tasks"
              onChange={(e) => setAddDue(e.target.value)}
              className="border-outline-variant bg-surface-container-lowest font-content text-on-surface border px-1.5 py-0.5 text-[12px] outline-none"
            />
            {addDue && (
              <button
                type="button"
                onClick={() => setAddDue('')}
                aria-label="Clear the due date"
                className="text-on-surface-variant hover:text-error p-0.5"
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* The same note Clock and Calendar carry since brief 93. */}
      <div className="border-outline-variant bg-surface-container-low text-on-surface-variant flex h-5 shrink-0 items-center gap-1 border-t px-2 text-[10px]">
        Due reminders appear while the desktop is open — this window can be closed.
      </div>

      {confirmDialog}
      {promptDialog}
    </div>
  )
}
