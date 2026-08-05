import { api } from '@imbatranim/core'
import type { StickyNote, StickyNoteInput, StickyNotePatch } from '../types'

export async function fetchStickyNotes(): Promise<StickyNote[]> {
  const res = await api.get<StickyNote[]>('/sticky-notes')
  return res.data
}

export async function createStickyNote(input: StickyNoteInput = {}): Promise<StickyNote> {
  const res = await api.post<StickyNote>('/sticky-notes', input)
  return res.data
}

export async function updateStickyNote(id: number, patch: StickyNotePatch): Promise<StickyNote> {
  const res = await api.patch<StickyNote>(`/sticky-notes/${id}`, patch)
  return res.data
}

export async function deleteStickyNote(id: number): Promise<void> {
  await api.delete(`/sticky-notes/${id}`)
}
