import { useMutation, useQuery } from '@tanstack/react-query'
import { queryClient, useSystem, type SystemHandle } from '@imbatranim/ui'
import {
  createGroup,
  createLink,
  deleteGroup,
  deleteLink,
  fetchGroups,
  importBookmarks,
  reorderGroups,
  reorderLinks,
  updateGroup,
  updateLink,
} from '../api/bookmarksApi'
import type {
  BookmarkGroup,
  CreateGroupInput,
  CreateLinkInput,
  UpdateGroupInput,
  UpdateLinkInput,
} from '../types'
import type { ParsedFolder } from '../netscape'

export const GROUPS_KEY = ['bookmarks', 'groups'] as const

/**
 * Report a failed write.
 *
 * Before brief 75 this app had **no** failure signal at all — every mutation carried
 * `onSuccess` only, so a rejected create or a refused move did nothing visible and
 * the row simply stayed as it was. That reads as the app ignoring the click.
 */
function reportFailure(system: SystemHandle, action: string): void {
  system.notify({
    title: `Could not ${action}`,
    body: 'The change was not saved.',
    level: 'error',
  })
}

const invalidate = () => queryClient.invalidateQueries({ queryKey: GROUPS_KEY })

/** Read the cache without subscribing — for duplicate checks and export. */
export function peekGroups(): BookmarkGroup[] {
  return queryClient.getQueryData<BookmarkGroup[]>(GROUPS_KEY) ?? []
}

export function useBookmarkGroupsQuery() {
  const system = useSystem()
  return useQuery({ queryKey: GROUPS_KEY, queryFn: () => fetchGroups(system.http) })
}

export function useCreateGroupMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: (input: CreateGroupInput) => createGroup(system.http, input),
    onError: () => reportFailure(system, 'create that folder'),
    onSettled: invalidate,
  })
}

export function useUpdateGroupMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateGroupInput }) =>
      updateGroup(system.http, id, data),
    onError: () => reportFailure(system, 'save that folder'),
    onSettled: invalidate,
  })
}

export function useDeleteGroupMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: (id: number) => deleteGroup(system.http, id),
    onError: () => reportFailure(system, 'delete that folder'),
    onSettled: invalidate,
  })
}

export function useCreateLinkMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: (input: CreateLinkInput) => createLink(system.http, input),
    onError: () => reportFailure(system, 'add that bookmark'),
    onSettled: invalidate,
  })
}

export function useUpdateLinkMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateLinkInput }) =>
      updateLink(system.http, id, data),
    onError: () => reportFailure(system, 'save that bookmark'),
    onSettled: invalidate,
  })
}

export function useDeleteLinkMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: (id: number) => deleteLink(system.http, id),
    onError: () => reportFailure(system, 'delete that bookmark'),
    onSettled: invalidate,
  })
}

export function useReorderLinksMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: (ids: number[]) => reorderLinks(system.http, ids),
    onError: () => reportFailure(system, 'reorder those bookmarks'),
    onSettled: invalidate,
  })
}

export function useReorderGroupsMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: (ids: number[]) => reorderGroups(system.http, ids),
    onError: () => reportFailure(system, 'reorder those folders'),
    onSettled: invalidate,
  })
}

export function useImportMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: ({ folders, parentId }: { folders: ParsedFolder[]; parentId?: number }) =>
      importBookmarks(system.http, folders, parentId),
    // The import is one transaction, so a failure means nothing was written — say so,
    // because "nothing happened" is otherwise indistinguishable from "nothing to do".
    onError: () =>
      system.notify({
        title: 'Import failed',
        body: 'No bookmarks were added.',
        level: 'error',
      }),
    onSettled: invalidate,
  })
}
