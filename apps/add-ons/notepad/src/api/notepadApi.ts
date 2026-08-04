import { api } from '@imbatranim/core'
import type { NoteEntry, NoteFile, RecentFile } from '../types'
import type { NotepadRoot } from '../lib/notepadRoot'

/**
 * Every call now takes the root explicitly.
 *
 * It used to be the module constant `'notes'`, which is what put Notepad on a
 * different filesystem from every other app in the OS — see `lib/notepadRoot.ts`
 * for the migration rule. There is deliberately no default parameter: a silent
 * fallback is how one call site quietly keeps writing to the old root.
 */

export async function fetchNotes(root: NotepadRoot, path: string = ''): Promise<NoteEntry[]> {
  const res = await api.get<NoteEntry[]>('/files', { params: { root, path } })
  return res.data
}

export async function readFile(root: NotepadRoot, path: string): Promise<NoteFile> {
  const res = await api.get<NoteFile>('/files/content', { params: { root, path } })
  return res.data
}

export async function createFile(
  root: NotepadRoot,
  path: string,
  content: string = ''
): Promise<NoteFile> {
  const res = await api.put<NoteEntry>('/files/content', { root, path, content })
  return { path: res.data.path, content }
}

export async function updateFile(
  root: NotepadRoot,
  path: string,
  content: string
): Promise<NoteFile> {
  const res = await api.put<NoteEntry>('/files/content', { root, path, content })
  return { path: res.data.path, content }
}

export async function deleteFile(root: NotepadRoot, path: string): Promise<void> {
  await api.delete('/files', { params: { root, path } })
}

export async function createDirectory(root: NotepadRoot, path: string): Promise<void> {
  await api.post('/files/directory', { root, path })
}

export async function deleteDirectory(root: NotepadRoot, path: string): Promise<void> {
  await api.delete('/files', { params: { root, path } })
}

/**
 * Does the legacy `notes` root still hold anything?
 *
 * Drives the one-time default-root decision. Returns false rather than throwing on
 * any error: if the answer cannot be had, opening into `home` (the consistent
 * choice) is the better failure.
 */
export async function notesRootHasFiles(): Promise<boolean> {
  try {
    const entries = await fetchNotes('notes', '')
    return entries.length > 0
  } catch {
    return false
  }
}

export async function fetchRecent(): Promise<RecentFile[]> {
  const res = await api.get<RecentFile[]>('/notes/recent')
  return res.data
}

export async function upsertRecent(path: string): Promise<void> {
  await api.post('/notes/recent', { path })
}
