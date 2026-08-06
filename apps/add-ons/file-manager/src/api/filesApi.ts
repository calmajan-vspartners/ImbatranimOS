import type { SystemHttp } from '@imbatranim/ui'
import type { FsEntry } from '../types'

// S2 — wired against S1 FilesService contract:
// GET    /api/files?root=&path=
// GET    /api/files/content?root=&path=
// GET    /api/files/download?root=&path=
// POST   /api/files/upload          (multipart: root, path, file)
// PUT    /api/files/content         (json: root, path, content)
// POST   /api/files/directory       (json: root, path)
// POST   /api/files/move            (json: root, from, to)
// POST   /api/files/copy            (json: root, from, to)
// DELETE /api/files?root=&path=

export async function listDirectory(
  http: SystemHttp,
  root: string,
  path: string
): Promise<FsEntry[]> {
  const res = await http.get<FsEntry[]>('/files', { params: { root, path } })
  return res.data
}

export async function readContent(
  http: SystemHttp,
  root: string,
  path: string
): Promise<{ path: string; content: string }> {
  const res = await http.get<{ path: string; content: string }>('/files/content', {
    params: { root, path },
  })
  return res.data
}

export async function writeContent(
  http: SystemHttp,
  root: string,
  path: string,
  content: string
): Promise<FsEntry> {
  const res = await http.put<FsEntry>('/files/content', { root, path, content })
  return res.data
}

export async function createDirectory(
  http: SystemHttp,
  root: string,
  path: string
): Promise<FsEntry> {
  const res = await http.post<FsEntry>('/files/directory', { root, path })
  return res.data
}

export async function moveEntry(
  http: SystemHttp,
  root: string,
  from: string,
  to: string
): Promise<FsEntry> {
  const res = await http.post<FsEntry>('/files/move', { root, from, to })
  return res.data
}

export async function copyEntry(
  http: SystemHttp,
  root: string,
  from: string,
  to: string
): Promise<FsEntry> {
  const res = await http.post<FsEntry>('/files/copy', { root, from, to })
  return res.data
}

export async function deleteEntry(
  http: SystemHttp,
  root: string,
  path: string,
  toTrash = false
): Promise<void> {
  // `trash=1` is only honoured for the home root; the backend falls back to a
  // permanent delete otherwise, which is what the notes root and Shift+Delete
  // both want.
  await http.delete('/files', {
    params: { root, path, ...(toTrash ? { trash: '1' } : {}) },
  })
}

export async function uploadFile(
  http: SystemHttp,
  root: string,
  path: string,
  file: File
): Promise<FsEntry> {
  const formData = new FormData()
  formData.append('root', root)
  formData.append('path', path)
  formData.append('file', file)
  const res = await http.post<FsEntry>('/files/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

// ── Trash ─────────────────────────────────────────────────────────────────────

export type TrashEntry = {
  id: string
  name: string
  originalPath: string
  deletedAt: string
  isDirectory: boolean
  sizeBytes: number
}

export async function listTrash(http: SystemHttp): Promise<TrashEntry[]> {
  const res = await http.get<TrashEntry[]>('/files/trash')
  return res.data
}

export async function restoreFromTrash(http: SystemHttp, id: string): Promise<{ path: string }> {
  const res = await http.post<{ path: string }>(`/files/trash/${encodeURIComponent(id)}/restore`)
  return res.data
}

export async function deleteFromTrash(http: SystemHttp, id: string): Promise<void> {
  await http.delete(`/files/trash/${encodeURIComponent(id)}`)
}

export async function emptyTrash(http: SystemHttp): Promise<{ removed: number }> {
  const res = await http.delete<{ removed: number }>('/files/trash')
  return res.data
}
