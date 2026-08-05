import { api } from '@imbatranim/core'
import type {
  BookmarkGroup,
  BookmarkLink,
  CreateGroupInput,
  CreateLinkInput,
  UpdateGroupInput,
  UpdateLinkInput,
} from '../types'
import type { ParsedFolder } from '../netscape'

export async function fetchGroups(): Promise<BookmarkGroup[]> {
  const res = await api.get<BookmarkGroup[]>('/bookmarks/groups')
  return res.data
}

export async function createGroup(data: CreateGroupInput): Promise<BookmarkGroup> {
  const res = await api.post<BookmarkGroup>('/bookmarks/groups', data)
  return res.data
}

export async function updateGroup(id: number, data: UpdateGroupInput): Promise<BookmarkGroup> {
  const res = await api.patch<BookmarkGroup>(`/bookmarks/groups/${id}`, data)
  return res.data
}

export async function deleteGroup(id: number): Promise<void> {
  await api.delete(`/bookmarks/groups/${id}`)
}

export async function createLink(data: CreateLinkInput): Promise<BookmarkLink> {
  const res = await api.post<BookmarkLink>('/bookmarks/links', data)
  return res.data
}

export async function updateLink(id: number, data: UpdateLinkInput): Promise<BookmarkLink> {
  const res = await api.patch<BookmarkLink>(`/bookmarks/links/${id}`, data)
  return res.data
}

export async function deleteLink(id: number): Promise<void> {
  await api.delete(`/bookmarks/links/${id}`)
}

/** Every sibling in its new order — the server refuses a partial list. */
export async function reorderLinks(ids: number[]): Promise<void> {
  await api.post('/bookmarks/links/reorder', { ids })
}

export async function reorderGroups(ids: number[]): Promise<void> {
  await api.post('/bookmarks/groups/reorder', { ids })
}

/** One round trip and one transaction for a whole imported tree. */
export async function importBookmarks(
  folders: ParsedFolder[],
  parentId?: number
): Promise<{ folders: number; links: number }> {
  const res = await api.post<{ folders: number; links: number }>('/bookmarks/import', {
    folders,
    ...(parentId === undefined ? {} : { parentId }),
  })
  return res.data
}
