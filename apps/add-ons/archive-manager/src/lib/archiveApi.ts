import type { SystemHttp } from '@imbatranim/ui'
import type {
  ArchiveEntry,
  ArchiveFormat,
  ArchiveJob,
  ArchiveListing,
  CompressResult,
  DirEntry,
  ExtractResult,
} from '../types'

/**
 * The app's own backend module, reached through the injected handle (brief 48).
 * Plain functions take the capability as their first argument; only hooks may
 * call `useSystem()`, and these are not hooks.
 */

/** POST /api/archive/extract — unpack `path` into `dest` (jailed server-side). */
export async function extractArchive(
  http: SystemHttp,
  root: string,
  path: string,
  dest?: string
): Promise<ExtractResult> {
  const { data } = await http.post<ExtractResult>('/archive/extract', {
    root,
    path,
    dest,
  })
  return data
}

/** POST /api/archive/compress — pack `paths[]` into the archive at `dest`. */
export async function compressPaths(
  http: SystemHttp,
  root: string,
  paths: string[],
  dest: string,
  format: ArchiveFormat
): Promise<CompressResult> {
  const { data } = await http.post<CompressResult>('/archive/compress', {
    root,
    paths,
    dest,
    format,
  })
  return data
}

/** GET /api/files — list a directory (used to preview extracted contents). */
export async function listDir(http: SystemHttp, root: string, path: string): Promise<DirEntry[]> {
  const { data } = await http.get<DirEntry[]>('/files', {
    params: { root, path },
  })
  return data
}

/** Human-readable byte size (helpers live in a `.ts`, per add-on convention). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

/** Last path segment of a virtual path (no node:path in the browser bundle). */
export function basename(p: string): string {
  const parts = p.split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1] : p
}

/** Extract a human error message from an axios-style failure. */
export function errorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const maybe = err as {
      response?: { data?: { message?: string | string[] } }
      message?: string
    }
    const msg = maybe.response?.data?.message
    if (Array.isArray(msg)) return msg.join(', ')
    if (typeof msg === 'string') return msg
    if (typeof maybe.message === 'string') return maybe.message
  }
  return 'Operation failed'
}

// ---------------------------------------------------------------------------
// Brief 78
// ---------------------------------------------------------------------------

/** GET /api/archive/list — read an archive's contents, extracting nothing. */
export async function listArchive(
  http: SystemHttp,
  root: string,
  path: string
): Promise<ArchiveListing> {
  const { data } = await http.get<ArchiveListing>('/archive/list', {
    params: { root, path },
  })
  return data
}

/**
 * POST /api/archive/extract-job — start an extraction and get an id to poll.
 *
 * `entries` extracts only those members. The backend re-validates every one of
 * them through the same jail a full extract uses, and refuses any name the
 * archive does not itself declare.
 */
export async function startExtractJob(
  http: SystemHttp,
  root: string,
  path: string,
  dest?: string,
  entries?: string[]
): Promise<{ id: string }> {
  const { data } = await http.post<{ id: string }>('/archive/extract-job', {
    root,
    path,
    dest,
    entries,
  })
  return data
}

/** GET /api/archive/job/:id — poll a running extraction. */
export async function fetchJob(http: SystemHttp, id: string): Promise<ArchiveJob> {
  const { data } = await http.get<ArchiveJob>(`/archive/job/${id}`)
  return data
}

/** A short, human description of an entry's size. */
export function entrySize(entry: ArchiveEntry): string {
  if (entry.directory) return ''
  if (entry.size === null) return '—'
  return formatBytes(entry.size)
}
