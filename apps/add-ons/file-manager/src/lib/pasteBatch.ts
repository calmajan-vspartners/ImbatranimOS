import type { FsEntry } from '../types'

/**
 * Paste arithmetic (brief 111) — where each clipboard entry lands, and what to
 * say when only some of them get there.
 *
 * Pulled out of `useFileClipboard` when the clipboard went multi-entry: a batch
 * paste's honest failure reporting is the same contract batch delete already
 * has (`useDeleteFlow`), and getting "3 of 5" right is worth a test.
 */

export type PasteMove = { from: string; to: string; name: string }

/**
 * Destination path for each entry, pasted into `destDir`.
 *
 * The basename comes from the entry's PATH, not its `name`: a hit synthesized
 * elsewhere in the app can carry a display name, and the path is what the
 * backend will actually move.
 */
export function pasteMoves(entries: readonly FsEntry[], destDir: string): PasteMove[] {
  return entries.map((entry) => {
    const name = entry.path.split('/').pop() ?? entry.name
    return { from: entry.path, to: destDir ? `${destDir}/${name}` : name, name }
  })
}

/**
 * True when an entry would be pasted onto itself — the same directory, same
 * name. The backend would either no-op or clobber; neither is what the user
 * meant by Ctrl+C then Ctrl+V without moving.
 */
export function isNoOpPaste(move: PasteMove): boolean {
  return move.from === move.to
}

/** One message for a partly-failed paste, or null when everything landed. */
export function pasteFailureMessage(
  mode: 'copy' | 'cut',
  failed: readonly PasteMove[],
  total: number
): string | null {
  if (failed.length === 0) return null
  const verb = mode === 'cut' ? 'move' : 'paste'
  if (total === 1) return `Could not ${verb} “${failed[0].name}”.`
  return `Could not ${verb} ${failed.length} of ${total} items.`
}
