import { useCallback, useState } from 'react'
import type { FsEntry } from '../types'
import type { useCopyEntryMutation, useMoveEntryMutation } from '../queries/filesQueries'

export type ClipboardEntry = {
  entry: FsEntry
  mode: 'copy' | 'cut'
}

type UseFileClipboardArgs = {
  path: string
  copyMutation: ReturnType<typeof useCopyEntryMutation>
  moveMutation: ReturnType<typeof useMoveEntryMutation>
  /** Surface a failed paste — the same reporter the rest of the app uses. */
  onError: (message: string) => void
}

/**
 * Copy/cut/paste clipboard for a single entry plus the paste orchestration.
 * A copy pastes via the copy mutation and keeps the clipboard; a cut pastes via
 * the move mutation and then clears the clipboard — same as the inline version.
 */
export function useFileClipboard({
  path,
  copyMutation,
  moveMutation,
  onError,
}: UseFileClipboardArgs) {
  const [clipboard, setClipboard] = useState<ClipboardEntry | null>(null)

  const copy = useCallback((entry: FsEntry) => setClipboard({ entry, mode: 'copy' }), [])
  const cut = useCallback((entry: FsEntry) => setClipboard({ entry, mode: 'cut' }), [])
  const clear = useCallback(() => setClipboard(null), [])

  const paste = useCallback(() => {
    if (!clipboard) return
    const name = clipboard.entry.path.split('/').pop() ?? clipboard.entry.name
    const dest = path ? `${path}/${name}` : name
    if (clipboard.mode === 'copy') {
      copyMutation.mutate(
        { from: clipboard.entry.path, to: dest },
        { onError: () => onError(`Could not paste “${name}”.`) }
      )
    } else {
      // Clear the clipboard only AFTER the move lands. Clearing it up front meant a
      // refused paste silently discarded the cut, with nothing left to retry (M3).
      moveMutation.mutate(
        { from: clipboard.entry.path, to: dest },
        {
          onSuccess: () => setClipboard(null),
          onError: () => onError(`Could not move “${name}”.`),
        }
      )
    }
  }, [clipboard, path, copyMutation, moveMutation, onError])

  return { clipboard, copy, cut, clear, paste }
}
