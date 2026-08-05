import { api } from '@imbatranim/core'
import type { Filter, Todo, TodoInput, TodoList, TodoPatch } from '../types'

/** `listId: null` means "All lists" — the parameter is omitted, not sent as 0. */
export type Scope = { filter: Filter; listId: number | null }

function scopeParams(scope: Scope): Record<string, string> {
  const params: Record<string, string> = {}
  if (scope.filter !== 'all') params.filter = scope.filter
  if (scope.listId !== null) params.listId = String(scope.listId)
  return params
}

export async function fetchTodos(scope: Scope): Promise<Todo[]> {
  const res = await api.get<Todo[]>('/todos', { params: scopeParams(scope) })
  return res.data
}

export async function createTodo(input: TodoInput): Promise<Todo> {
  const res = await api.post<Todo>('/todos', input)
  return res.data
}

export async function updateTodo(id: number, patch: TodoPatch): Promise<Todo> {
  const res = await api.patch<Todo>(`/todos/${id}`, patch)
  return res.data
}

export async function reorderTodos(ids: number[]): Promise<void> {
  await api.patch('/todos/reorder', { ids })
}

export async function deleteTodo(id: number): Promise<void> {
  await api.delete(`/todos/${id}`)
}

export async function clearCompleted(listId: number | null): Promise<{ deleted: number }> {
  const res = await api.delete<{ deleted: number }>('/todos/clear-completed', {
    params: listId === null ? {} : { listId: String(listId) },
  })
  return res.data
}

export async function fetchLists(): Promise<TodoList[]> {
  const res = await api.get<TodoList[]>('/todos/lists')
  return res.data
}

export async function createList(name: string): Promise<TodoList> {
  const res = await api.post<TodoList>('/todos/lists', { name })
  return res.data
}

export async function renameList(id: number, name: string): Promise<TodoList> {
  const res = await api.patch<TodoList>(`/todos/lists/${id}`, { name })
  return res.data
}

/** Deleting a list unfiles its todos; the count comes back so the UI can say so. */
export async function deleteList(id: number): Promise<{ unfiled: number }> {
  const res = await api.delete<{ unfiled: number }>(`/todos/lists/${id}`)
  return res.data
}
