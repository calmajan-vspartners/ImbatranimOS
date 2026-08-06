import { useTodoReminders } from './reminders'
import { useTodosQuery } from './queries/todosQueries'

/** Refresh cadence for the todos cache with no window open. */
const TODOS_REFETCH_MS = 60_000

/**
 * The Todo app's desktop-lifetime service (brief 93): keeps the all-todos
 * cache live and runs the due-date watcher, so "due today" and "task due"
 * announce themselves while the desktop is open — with or without a Todo
 * window. Mounted by the shell via `manifest.background`.
 */
export function TodoBackground() {
  useTodosQuery({ filter: 'all', listId: null }, { refetchIntervalMs: TODOS_REFETCH_MS })
  useTodoReminders()
  return null
}
