import { useMutation, useQuery } from '@tanstack/react-query'
import { notify, queryClient } from '@imbatranim/core'
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
function reportFailure(action: string): void {
  notify({
    title: `Could not ${action}`,
    body: 'The change was not saved.',
    appId: 'bookmarks',
    level: 'error',
  })
}

const invalidate = () => queryClient.invalidateQueries({ queryKey: GROUPS_KEY })

/** Read the cache without subscribing — for duplicate checks and export. */
export function peekGroups(): BookmarkGroup[] {
  return queryClient.getQueryData<BookmarkGroup[]>(GROUPS_KEY) ?? []
}

export function useBookmarkGroupsQuery() {
  return useQuery({ queryKey: GROUPS_KEY, queryFn: fetchGroups })
}

export function useCreateGroupMutation() {
  return useMutation({
    mutationFn: (input: CreateGroupInput) => createGroup(input),
    onError: () => reportFailure('create that folder'),
    onSettled: invalidate,
  })
}

export function useUpdateGroupMutation() {
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateGroupInput }) => updateGroup(id, data),
    onError: () => reportFailure('save that folder'),
    onSettled: invalidate,
  })
}

export function useDeleteGroupMutation() {
  return useMutation({
    mutationFn: (id: number) => deleteGroup(id),
    onError: () => reportFailure('delete that folder'),
    onSettled: invalidate,
  })
}

export function useCreateLinkMutation() {
  return useMutation({
    mutationFn: (input: CreateLinkInput) => createLink(input),
    onError: () => reportFailure('add that bookmark'),
    onSettled: invalidate,
  })
}

export function useUpdateLinkMutation() {
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateLinkInput }) => updateLink(id, data),
    onError: () => reportFailure('save that bookmark'),
    onSettled: invalidate,
  })
}

export function useDeleteLinkMutation() {
  return useMutation({
    mutationFn: (id: number) => deleteLink(id),
    onError: () => reportFailure('delete that bookmark'),
    onSettled: invalidate,
  })
}

export function useReorderLinksMutation() {
  return useMutation({
    mutationFn: (ids: number[]) => reorderLinks(ids),
    onError: () => reportFailure('reorder those bookmarks'),
    onSettled: invalidate,
  })
}

export function useReorderGroupsMutation() {
  return useMutation({
    mutationFn: (ids: number[]) => reorderGroups(ids),
    onError: () => reportFailure('reorder those folders'),
    onSettled: invalidate,
  })
}

export function useImportMutation() {
  return useMutation({
    mutationFn: ({ folders, parentId }: { folders: ParsedFolder[]; parentId?: number }) =>
      importBookmarks(folders, parentId),
    // The import is one transaction, so a failure means nothing was written — say so,
    // because "nothing happened" is otherwise indistinguishable from "nothing to do".
    onError: () =>
      notify({
        title: 'Import failed',
        body: 'No bookmarks were added.',
        appId: 'bookmarks',
        level: 'error',
      }),
    onSettled: invalidate,
  })
}
