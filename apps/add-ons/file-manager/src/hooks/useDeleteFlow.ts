import { useCallback, useState } from 'react'
import type { FsEntry } from '../types'
import type { useDeleteEntryMutation } from '../queries/filesQueries'

/**
 * A pending delete is either a single targeted entry or a batch of the current
 * selection — one discriminated union in place of the old intertwined
 * `deleteTarget` + `batchDeletePending` pair.
 */
export type DeleteRequest = { kind: 'single'; target: FsEntry } | { kind: 'batch' } | null

type UseDeleteFlowArgs = {
  selected: Set<string>
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>
  deleteMutation: ReturnType<typeof useDeleteEntryMutation>
  onError: (message: string) => void
  /**
   * Whether deletions go to the Trash. Only the `home` root has one — `notes`
   * is a separate directory tree, so a cross-root rename would fail and it
   * keeps confirm-then-permanent.
   */
  trashEnabled: boolean
  /** Reports the outcome to the notification centre. */
  onTrashed: (label: string, count: number) => void
}

/**
 * Owns the confirm -> mutate -> report flow for deletions.
 *
 * Batch delete preserves the CS-4 partial-failure contract exactly: it fires
 * all deletes with `Promise.allSettled`, keeps ONLY the failed paths selected
 * (dropping the ones that succeeded), and surfaces an error banner when any
 * failed. Single delete removes just its target from the selection on success
 * and reports an error on failure.
 */
export function useDeleteFlow({
  selected,
  setSelected,
  deleteMutation,
  onError,
  trashEnabled,
  onTrashed,
}: UseDeleteFlowArgs) {
  const [request, setRequest] = useState<DeleteRequest>(null)
  /** Set by Shift+Delete to bypass the Trash for this one request. */
  const [permanent, setPermanent] = useState(false)

  const requestSingle = useCallback((entry: FsEntry, forcePermanent = false) => {
    setPermanent(forcePermanent)
    setRequest({ kind: 'single', target: entry })
  }, [])

  const requestBatch = useCallback(
    (forcePermanent = false) => {
      if (selected.size === 0) return
      setPermanent(forcePermanent)
      setRequest({ kind: 'batch' })
    },
    [selected]
  )

  const cancel = useCallback(() => setRequest(null), [])

  const confirm = useCallback(async () => {
    if (request?.kind === 'batch') {
      const paths = Array.from(selected)
      const toTrash = trashEnabled && !permanent
      const results = await Promise.allSettled(
        paths.map((p) => deleteMutation.mutateAsync({ path: p, toTrash }))
      )
      // Keep only the items that failed selected; drop the ones we deleted.
      const failedPaths = paths.filter((_, i) => results[i].status === 'rejected')
      setSelected(new Set(failedPaths))
      if (failedPaths.length > 0) {
        onError(
          `Failed to delete ${failedPaths.length} item${failedPaths.length !== 1 ? 's' : ''}.`
        )
      }
      const moved = paths.length - failedPaths.length
      if (moved > 0 && toTrash) onTrashed(`${moved} items`, moved)
    } else if (request?.kind === 'single') {
      const target = request.target
      const toTrash = trashEnabled && !permanent
      try {
        await deleteMutation.mutateAsync({ path: target.path, toTrash })
        setSelected((prev) => {
          const next = new Set(prev)
          next.delete(target.path)
          return next
        })
        if (toTrash) onTrashed(target.name, 1)
      } catch {
        onError(`Failed to delete "${target.name}".`)
      }
    }
    setRequest(null)
  }, [request, selected, deleteMutation, setSelected, onError, trashEnabled, permanent, onTrashed])

  const dialogOpen = request !== null
  const deleteCount = request?.kind === 'batch' ? selected.size : 1
  const deleteLabel =
    request?.kind === 'batch'
      ? `${selected.size} item${selected.size !== 1 ? 's' : ''}`
      : request?.kind === 'single'
        ? request.target.name
        : undefined

  return {
    /** True when confirming will move to the Trash rather than delete forever. */
    willTrash: trashEnabled && !permanent,
    requestSingle,
    requestBatch,
    cancel,
    confirm,
    dialogOpen,
    deleteCount,
    deleteLabel,
    isPending: deleteMutation.isPending,
  }
}
