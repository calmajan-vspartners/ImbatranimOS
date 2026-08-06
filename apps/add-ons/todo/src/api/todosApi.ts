import type { SystemHttp } from '@imbatranim/ui'
import type { Filter, Todo, TodoInput, TodoList, TodoPatch } from '../types'

/**
 * The app's own backend module, reached through the injected handle (brief 48).
 * Plain functions take the capability as their first argument; only hooks may
 * call `useSystem()`, and these are not hooks.
 */

/** `listId: null` means "All lists" — the parameter is omitted, not sent as 0. */
export type Scope = { filter: Filter; listId: number | null }

function scopeParams(scope: Scope): Record<string, string> {
  const params: Record<string, string> = {}
  if (scope.filter !== 'all') params.filter = scope.filter
  if (scope.listId !== null) params.listId = String(scope.listId)
  return params
}

export async function fetchTodos(http: SystemHttp, scope: Scope): Promise<Todo[]> {
  const res = await http.get<Todo[]>('/todos', { params: scopeParams(scope) })
  return res.data
}

export async function createTodo(http: SystemHttp, input: TodoInput): Promise<Todo> {
  const res = await http.post<Todo>('/todos', input)
  return res.data
}

export async function updateTodo(http: SystemHttp, id: number, patch: TodoPatch): Promise<Todo> {
  const res = await http.patch<Todo>(`/todos/${id}`, patch)
  return res.data
}

export async function reorderTodos(http: SystemHttp, ids: number[]): Promise<void> {
  await http.patch('/todos/reorder', { ids })
}

export async function deleteTodo(http: SystemHttp, id: number): Promise<void> {
  await http.delete(`/todos/${id}`)
}

export async function clearCompleted(
  http: SystemHttp,
  listId: number | null
): Promise<{ deleted: number }> {
  const res = await http.delete<{ deleted: number }>('/todos/clear-completed', {
    params: listId === null ? {} : { listId: String(listId) },
  })
  return res.data
}

export async function fetchLists(http: SystemHttp): Promise<TodoList[]> {
  const res = await http.get<TodoList[]>('/todos/lists')
  return res.data
}

export async function createList(http: SystemHttp, name: string): Promise<TodoList> {
  const res = await http.post<TodoList>('/todos/lists', { name })
  return res.data
}

export async function renameList(http: SystemHttp, id: number, name: string): Promise<TodoList> {
  const res = await http.patch<TodoList>(`/todos/lists/${id}`, { name })
  return res.data
}

/** Deleting a list unfiles its todos; the count comes back so the UI can say so. */
export async function deleteList(http: SystemHttp, id: number): Promise<{ unfiled: number }> {
  const res = await http.delete<{ unfiled: number }>(`/todos/lists/${id}`)
  return res.data
}
