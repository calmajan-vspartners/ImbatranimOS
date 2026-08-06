import type { SystemHttp } from '@imbatranim/ui'
import type { NoteEntry, NoteFile } from '../types'
import type { NotepadRoot } from '../lib/notepadRoot'

/**
 * Every call now takes the root explicitly.
 *
 * It used to be the module constant `'notes'`, which is what put Notepad on a
 * different filesystem from every other app in the OS — see `lib/notepadRoot.ts`
 * for the migration rule. There is deliberately no default parameter: a silent
 * fallback is how one call site quietly keeps writing to the old root.
 *
 * Plain functions take the capability as their first argument (brief 48); only
 * hooks may call `useSystem()`, and these are not hooks.
 */

export async function fetchNotes(
  http: SystemHttp,
  root: NotepadRoot,
  path: string = ''
): Promise<NoteEntry[]> {
  const res = await http.get<NoteEntry[]>('/files', { params: { root, path } })
  return res.data
}

export async function readFile(
  http: SystemHttp,
  root: NotepadRoot,
  path: string
): Promise<NoteFile> {
  const res = await http.get<NoteFile>('/files/content', { params: { root, path } })
  return res.data
}

export async function createFile(
  http: SystemHttp,
  root: NotepadRoot,
  path: string,
  content: string = ''
): Promise<NoteFile> {
  const res = await http.put<NoteEntry>('/files/content', { root, path, content })
  return { path: res.data.path, content }
}

export async function updateFile(
  http: SystemHttp,
  root: NotepadRoot,
  path: string,
  content: string
): Promise<NoteFile> {
  const res = await http.put<NoteEntry>('/files/content', { root, path, content })
  return { path: res.data.path, content }
}

export async function deleteFile(http: SystemHttp, root: NotepadRoot, path: string): Promise<void> {
  await http.delete('/files', { params: { root, path } })
}

export async function createDirectory(
  http: SystemHttp,
  root: NotepadRoot,
  path: string
): Promise<void> {
  await http.post('/files/directory', { root, path })
}

export async function deleteDirectory(
  http: SystemHttp,
  root: NotepadRoot,
  path: string
): Promise<void> {
  await http.delete('/files', { params: { root, path } })
}

/**
 * Does the legacy `notes` root still hold anything?
 *
 * Drives the one-time default-root decision. Returns false rather than throwing on
 * any error: if the answer cannot be had, opening into `home` (the consistent
 * choice) is the better failure.
 */
export async function notesRootHasFiles(http: SystemHttp): Promise<boolean> {
  try {
    const entries = await fetchNotes(http, 'notes', '')
    return entries.length > 0
  } catch {
    return false
  }
}
