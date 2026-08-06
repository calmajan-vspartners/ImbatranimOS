import type { SystemHttp } from '@imbatranim/ui'

/**
 * Mirrors the shape of file-manager's `GET /files` entries. Kept as a local
 * type — add-ons may not import a sibling add-on package, so this is
 * redeclared here rather than imported.
 */
type FsEntry = {
  name: string
  path: string
  type: 'file' | 'directory'
  size: number
  modifiedAt: string
}

export type MediaKind = 'audio' | 'video'

export type Track = {
  path: string
  name: string
  kind: MediaKind
}

// Kept in lockstep with the extension list registered for `media-player` in
// the shell's `openWith.ts` (see brief 38).
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'opus']
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv']

/**
 * Everything this player claims, for the Open dialog.
 *
 * Derived rather than hand-listed, because the hand-written copy had drifted: it offered
 * `avi` and `weba` — which `mediaKind` does not recognise, so picking one landed on
 * "Unsupported file type" — and omitted `oga` and `ogv`, which it does.
 */
export const MEDIA_EXTENSIONS = [...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS]

export function extensionOf(path: string): string {
  const name = path.split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

/**
 * The playable media kind for `path`'s extension, or `null` when it isn't
 * one of the audio/video extensions this player is registered for.
 */
export function mediaKind(path: string): MediaKind | null {
  const ext = extensionOf(path)
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio'
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video'
  return null
}

/** Parent folder path of `path` (`""` for a top-level file). */
export function parentDir(path: string): string {
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return parts.join('/')
}

/** The playable queue plus every other file beside it, which is where sidecars live. */
export type FolderContents = {
  tracks: Track[]
  /** Paths of the non-media files in the same folder — subtitle candidates. */
  siblings: string[]
}

/**
 * List the folder a track was opened from: the sibling media files (the "queue",
 * name-sorted) and the paths of everything else in there.
 *
 * The non-media paths are returned rather than filtered away because a sidecar `.srt`
 * lives among them; discarding them would mean a second listing request for the same
 * directory to find subtitles.
 *
 * A thin wrapper over the injected `system.http`, mirroring file-manager's
 * `GET /files?root=&path=` contract without importing the file-manager
 * package. Plain function, so the capability arrives as the first argument.
 */
export async function listFolder(
  http: SystemHttp,
  root: string,
  path: string
): Promise<FolderContents> {
  const folder = parentDir(path)
  const res = await http.get<FsEntry[]>('/files', { params: { root, path: folder } })
  const tracks: Track[] = []
  const siblings: string[] = []
  for (const entry of res.data) {
    if (entry.type !== 'file') continue
    const kind = mediaKind(entry.path)
    if (kind) tracks.push({ path: entry.path, name: entry.name, kind })
    else siblings.push(entry.path)
  }
  tracks.sort((a, b) => a.name.localeCompare(b.name))
  return { tracks, siblings }
}
