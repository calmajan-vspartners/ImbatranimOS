/**
 * The shapes the backend `todos` module speaks.
 *
 * camelCase throughout, and `completed` is a real boolean. Before brief 73 this
 * type read `completed: boolean | number // SQLite returns 0/1`, which is a type
 * admitting the API had a problem; the service now maps rows at its boundary the
 * way `clock` and `calendar` do.
 */

export type Todo = {
  id: number
  text: string
  completed: boolean
  /** 1-based manual rank across the whole table. */
  position: number
  /**
   * The instant the todo is due, epoch ms, or null. A date-only due date is the
   * **end** of that day — see `due.ts` for why that encoding and not midnight.
   */
  dueAt: number | null
  priority: boolean
  /** null means unfiled — it shows under "All". */
  listId: number | null
  createdAt: string
  updatedAt: string
}

export type TodoList = {
  id: number
  name: string
  position: number
}

/** Everything a create accepts. */
export type TodoInput = {
  text: string
  dueAt?: number | null
  priority?: boolean
  listId?: number | null
}

/** Everything a patch accepts. `null` clears `dueAt` / unfiles. */
export type TodoPatch = {
  text?: string
  completed?: boolean
  priority?: boolean
  dueAt?: number | null
  listId?: number | null
}

export type Filter = 'all' | 'active' | 'completed'

export type SortMode = 'manual' | 'due' | 'created'
