import type { SystemHttp } from '@imbatranim/ui'
import type { StickyNote, StickyNoteInput, StickyNotePatch } from '../types'

/**
 * The app's own backend module, reached through the injected handle (brief 48).
 * Plain functions take the capability as their first argument; only hooks may
 * call `useSystem()`, and these are not hooks.
 */

export async function fetchStickyNotes(http: SystemHttp): Promise<StickyNote[]> {
  const res = await http.get<StickyNote[]>('/sticky-notes')
  return res.data
}

export async function createStickyNote(
  http: SystemHttp,
  input: StickyNoteInput = {}
): Promise<StickyNote> {
  const res = await http.post<StickyNote>('/sticky-notes', input)
  return res.data
}

export async function updateStickyNote(
  http: SystemHttp,
  id: number,
  patch: StickyNotePatch
): Promise<StickyNote> {
  const res = await http.patch<StickyNote>(`/sticky-notes/${id}`, patch)
  return res.data
}

export async function deleteStickyNote(http: SystemHttp, id: number): Promise<void> {
  await http.delete(`/sticky-notes/${id}`)
}
