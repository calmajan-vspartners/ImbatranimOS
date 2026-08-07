import { useCallback, useState } from 'react'
import type { FsEntry } from '../types'
import type { useCopyEntryMutation, useMoveEntryMutation } from '../queries/filesQueries'
import { isNoOpPaste, pasteFailureMessage, pasteMoves } from '../lib/pasteBatch'

export type ClipboardContents = {
  entries: FsEntry[]
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
 * Copy/cut/paste for one *or many* entries, plus the paste orchestration.
 *
 * Multi-entry since brief 111: Ctrl+C on a five-item selection quietly copying
 * one of them is a trap, and the context menu's Copy/Cut now act on the whole
 * selection the same way Compress already did.
 *
 * Two contracts survive the rewrite unchanged. A cut clears the clipboard only
 * AFTER the move lands (the M3 fix) — extended to a batch, it clears only when
 * every move landed, and otherwise keeps exactly the entries that failed so the
 * cut is still there to retry. And a partial failure reports honestly ("2 of 3")
 * rather than as all-or-nothing, mirroring batch delete.
 */
export function useFileClipboard({
  path,
  copyMutation,
  moveMutation,
  onError,
}: UseFileClipboardArgs) {
  const [clipboard, setClipboard] = useState<ClipboardContents | null>(null)

  const copy = useCallback((entries: FsEntry[]) => {
    if (entries.length > 0) setClipboard({ entries, mode: 'copy' })
  }, [])
  const cut = useCallback((entries: FsEntry[]) => {
    if (entries.length > 0) setClipboard({ entries, mode: 'cut' })
  }, [])
  const clear = useCallback(() => setClipboard(null), [])

  const paste = useCallback(async () => {
    if (!clipboard) return
    const moves = pasteMoves(clipboard.entries, path)
    // Pasting into the folder the entries already live in would either no-op or
    // clobber. Say so once instead of firing requests that cannot mean anything.
    const real = moves.filter((m) => !isNoOpPaste(m))
    if (real.length === 0) {
      onError(
        clipboard.entries.length === 1
          ? `“${moves[0].name}” is already here.`
          : 'Those items are already here.'
      )
      return
    }

    const mutate = clipboard.mode === 'copy' ? copyMutation : moveMutation
    const results = await Promise.allSettled(
      real.map((m) => mutate.mutateAsync({ from: m.from, to: m.to }))
    )
    const failed = real.filter((_, i) => results[i].status === 'rejected')

    if (clipboard.mode === 'cut') {
      // Keep exactly what did not move, so the cut survives to be retried.
      if (failed.length === 0) setClipboard(null)
      else {
        const failedPaths = new Set(failed.map((m) => m.from))
        setClipboard({
          mode: 'cut',
          entries: clipboard.entries.filter((e) => failedPaths.has(e.path)),
        })
      }
    }

    const message = pasteFailureMessage(clipboard.mode, failed, real.length)
    if (message) onError(message)
  }, [clipboard, path, copyMutation, moveMutation, onError])

  return { clipboard, copy, cut, clear, paste }
}
