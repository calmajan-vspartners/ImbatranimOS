import type { SortMode, Todo } from './types'

/**
 * The three orders a list can be in.
 *
 * `manual` is the order stored on the server as `position`, and it is left
 * **exactly** alone — the priority flag does not float anything to the top here.
 * That is deliberate: manual means manual, and a list that silently reorders
 * itself after you drag it is not a list you can arrange. Priority is a marker in
 * this mode, and a tie-breaker in the other two.
 *
 * `due` and `created` are derived, so they are computed on the client rather than
 * asked of the server — the server owns only the manual order (see
 * `todos.service.ts`).
 */

/** Todos with no due date sort after those that have one, in every mode. */
function compareDue(a: Todo, b: Todo): number {
  if (a.dueAt === null && b.dueAt === null) return 0
  if (a.dueAt === null) return 1
  if (b.dueAt === null) return -1
  return a.dueAt - b.dueAt
}

/** Priority first, used as the leading key in the derived orders. */
function comparePriority(a: Todo, b: Todo): number {
  return Number(b.priority) - Number(a.priority)
}

/** Stable final tie-break, so a sort never shuffles equal rows between renders. */
function compareStable(a: Todo, b: Todo): number {
  return a.position - b.position || a.id - b.id
}

/**
 * Sort a copy. Never mutates its input — the array usually comes straight from the
 * react-query cache, and sorting that in place would reorder the cache itself.
 */
export function sortTodos(todos: Todo[], mode: SortMode): Todo[] {
  const copy = [...todos]
  switch (mode) {
    case 'manual':
      return copy.sort(compareStable)
    case 'due':
      return copy.sort((a, b) => comparePriority(a, b) || compareDue(a, b) || compareStable(a, b))
    case 'created':
      return copy.sort(
        (a, b) =>
          comparePriority(a, b) ||
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
          compareStable(a, b)
      )
  }
}

/** Dragging is only meaningful when the visible order is the one being stored. */
export function canReorder(mode: SortMode): boolean {
  return mode === 'manual'
}

export const SORT_LABELS: Record<SortMode, string> = {
  manual: 'My order',
  due: 'Due date',
  created: 'Oldest first',
}

export const SORT_MODES: SortMode[] = ['manual', 'due', 'created']
