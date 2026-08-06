import type { SystemHttp } from '@imbatranim/ui'
import type {
  BookmarkGroup,
  BookmarkLink,
  CreateGroupInput,
  CreateLinkInput,
  UpdateGroupInput,
  UpdateLinkInput,
} from '../types'
import type { ParsedFolder } from '../netscape'

/**
 * The app's own backend module, reached through the injected handle (brief 48).
 * Plain functions take the capability as their first argument; only hooks may
 * call `useSystem()`, and these are not hooks.
 */

export async function fetchGroups(http: SystemHttp): Promise<BookmarkGroup[]> {
  const res = await http.get<BookmarkGroup[]>('/bookmarks/groups')
  return res.data
}

export async function createGroup(
  http: SystemHttp,
  data: CreateGroupInput
): Promise<BookmarkGroup> {
  const res = await http.post<BookmarkGroup>('/bookmarks/groups', data)
  return res.data
}

export async function updateGroup(
  http: SystemHttp,
  id: number,
  data: UpdateGroupInput
): Promise<BookmarkGroup> {
  const res = await http.patch<BookmarkGroup>(`/bookmarks/groups/${id}`, data)
  return res.data
}

export async function deleteGroup(http: SystemHttp, id: number): Promise<void> {
  await http.delete(`/bookmarks/groups/${id}`)
}

export async function createLink(http: SystemHttp, data: CreateLinkInput): Promise<BookmarkLink> {
  const res = await http.post<BookmarkLink>('/bookmarks/links', data)
  return res.data
}

export async function updateLink(
  http: SystemHttp,
  id: number,
  data: UpdateLinkInput
): Promise<BookmarkLink> {
  const res = await http.patch<BookmarkLink>(`/bookmarks/links/${id}`, data)
  return res.data
}

export async function deleteLink(http: SystemHttp, id: number): Promise<void> {
  await http.delete(`/bookmarks/links/${id}`)
}

/** Every sibling in its new order — the server refuses a partial list. */
export async function reorderLinks(http: SystemHttp, ids: number[]): Promise<void> {
  await http.post('/bookmarks/links/reorder', { ids })
}

export async function reorderGroups(http: SystemHttp, ids: number[]): Promise<void> {
  await http.post('/bookmarks/groups/reorder', { ids })
}

/** One round trip and one transaction for a whole imported tree. */
export async function importBookmarks(
  http: SystemHttp,
  folders: ParsedFolder[],
  parentId?: number
): Promise<{ folders: number; links: number }> {
  const res = await http.post<{ folders: number; links: number }>('/bookmarks/import', {
    folders,
    ...(parentId === undefined ? {} : { parentId }),
  })
  return res.data
}
