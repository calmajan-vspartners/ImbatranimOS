import { useMutation, useQuery } from '@tanstack/react-query'
import { queryClient, useSystem, type SystemHandle } from '@imbatranim/ui'
import {
  clearCompleted,
  createList,
  createTodo,
  deleteList,
  deleteTodo,
  fetchLists,
  fetchTodos,
  renameList,
  reorderTodos,
  updateTodo,
  type Scope,
} from '../api/todosApi'
import type { Todo, TodoInput, TodoList, TodoPatch } from '../types'

/**
 * `['todos']` is the shared prefix, so every mutation can invalidate the whole
 * family in one call. Each scope (filter + list) is its own entry underneath it.
 */
export const TODOS_ROOT = ['todos'] as const
const todosKey = (scope: Scope) => ['todos', scope.filter, scope.listId] as const

/**
 * Lists live under their OWN root, not under `['todos', 'lists']`.
 *
 * `peekTodos` and every invalidation match on the `['todos']` prefix, so a lists
 * entry nested under it would be swept into the same set — and `peekTodos` would
 * flatten `TodoList[]` into its `Todo[]`, handing the reminder watcher rows with no
 * `dueAt` at all.
 */
export const LISTS_KEY = ['todo-lists'] as const

/** Todos as the cache holds them, for the reminder watcher (no subscription). */
export function peekTodos(): Todo[] {
  return queryClient
    .getQueriesData<Todo[]>({ queryKey: TODOS_ROOT })
    .flatMap(([, data]) => data ?? [])
}

function invalidateTodos(): void {
  void queryClient.invalidateQueries({ queryKey: TODOS_ROOT })
}

/**
 * Report a failed write.
 *
 * Before brief 73 these went nowhere: a rejected PATCH rolled the optimistic
 * update back and the row simply sprang into its old state, which reads as the app
 * ignoring the click.
 */
function reportFailure(system: SystemHandle, action: string): void {
  system.notify({
    title: `Could not ${action}`,
    body: 'The change was not saved. Your list has been put back the way it was.',
    level: 'error',
  })
}

export function useTodosQuery(scope: Scope, options?: { refetchIntervalMs?: number }) {
  const system = useSystem()
  return useQuery({
    queryKey: todosKey(scope),
    queryFn: () => fetchTodos(system.http, scope),
    // The background service (brief 93) keeps the all-todos cache warm for the
    // due-date watcher even with no Todo window open — including hidden tabs,
    // where a due toast still has to land.
    refetchInterval: options?.refetchIntervalMs,
    refetchIntervalInBackground: options?.refetchIntervalMs !== undefined,
  })
}

export function useListsQuery() {
  const system = useSystem()
  return useQuery({ queryKey: LISTS_KEY, queryFn: () => fetchLists(system.http) })
}

export function useCreateTodoMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: (input: TodoInput) => createTodo(system.http, input),
    onError: () => reportFailure(system, 'add that task'),
    onSettled: invalidateTodos,
  })
}

export function useUpdateTodoMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: TodoPatch }) =>
      updateTodo(system.http, id, patch),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: TODOS_ROOT })
      const snapshots = queryClient.getQueriesData<Todo[]>({ queryKey: TODOS_ROOT })
      queryClient.setQueriesData<Todo[]>({ queryKey: TODOS_ROOT }, (old) =>
        old?.map((t) => (t.id === id ? applyPatch(t, patch) : t))
      )
      return { snapshots }
    },
    onError: (_err, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => queryClient.setQueryData(key, data))
      reportFailure(system, 'save that change')
    },
    onSettled: invalidateTodos,
  })
}

export function useDeleteTodoMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: (id: number) => deleteTodo(system.http, id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: TODOS_ROOT })
      const snapshots = queryClient.getQueriesData<Todo[]>({ queryKey: TODOS_ROOT })
      queryClient.setQueriesData<Todo[]>({ queryKey: TODOS_ROOT }, (old) =>
        old?.filter((t) => t.id !== id)
      )
      return { snapshots }
    },
    onError: (_err, _id, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => queryClient.setQueryData(key, data))
      reportFailure(system, 'delete that task')
    },
    onSettled: invalidateTodos,
  })
}

export function useReorderTodosMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: (ids: number[]) => reorderTodos(system.http, ids),
    onError: () => reportFailure(system, 'save the new order'),
    onSettled: invalidateTodos,
  })
}

export function useClearCompletedMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: (listId: number | null) => clearCompleted(system.http, listId),
    onError: () => reportFailure(system, 'clear the completed tasks'),
    onSettled: invalidateTodos,
  })
}

export function useCreateListMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: (name: string) => createList(system.http, name),
    onError: () => reportFailure(system, 'create that list'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: LISTS_KEY }),
  })
}

export function useRenameListMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => renameList(system.http, id, name),
    onError: () => reportFailure(system, 'rename that list'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: LISTS_KEY }),
  })
}

export function useDeleteListMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: (id: number) => deleteList(system.http, id),
    onError: () => reportFailure(system, 'delete that list'),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: LISTS_KEY })
      // The todos that were in it are now unfiled, so their scopes are stale too.
      invalidateTodos()
    },
  })
}

/**
 * Apply a patch to a cached todo.
 *
 * Not a plain spread: `dueAt` and `listId` may legitimately be `null`, and a
 * spread of `{ dueAt: undefined }` would erase a value the patch never mentioned.
 */
function applyPatch(todo: Todo, patch: TodoPatch): Todo {
  return {
    ...todo,
    ...(patch.text !== undefined ? { text: patch.text } : {}),
    ...(patch.completed !== undefined ? { completed: patch.completed } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt } : {}),
    ...(patch.listId !== undefined ? { listId: patch.listId } : {}),
  }
}

export type { TodoList }
