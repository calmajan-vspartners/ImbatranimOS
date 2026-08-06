export type ArchiveFormat = 'zip' | 'targz'

/**
 * The one-shot payload the file-manager context menu hands the window via
 * `openApp('archive-manager', intent)`. Two shapes: extract an archive, or
 * compress a selection.
 */
export type ArchiveIntent =
  | { action: 'extract'; root: string; path: string; dest?: string }
  | {
      action: 'compress'
      root: string
      paths: string[]
      dest: string
      format: ArchiveFormat
    }

export interface ExtractResult {
  dest: string
  entries: number
  totalBytes: number
}

export interface CompressResult {
  dest: string
  entries: number
  bytes: number
}

/** A directory listing row from the files API (subset we render). */
export interface DirEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size: number
}

// ---------------------------------------------------------------------------
// Brief 78
// ---------------------------------------------------------------------------

/** One row of an archive listing, as the backend validated it. */
export interface ArchiveEntry {
  name: string
  size: number | null
  compressedSize: number | null
  directory: boolean
  modified: string | null
  /** The stored name was not valid UTF-8; the extracted name will differ. */
  nameRepaired: boolean
}

export interface ArchiveListing {
  format: string
  entries: ArchiveEntry[]
  /** Entries the archive declares that the backend refuses to extract. */
  refused: { name: string; reason: string }[]
  encrypted: boolean
  truncated: boolean
}

export interface ArchiveJob {
  id: string
  state: 'running' | 'done' | 'failed'
  percent: number
  entriesDone: number
  entriesTotal: number
  result?: ExtractResult
  error?: string
}
