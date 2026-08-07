import { useCallback } from 'react'
import type { FsEntry } from '../types'
import { classifyVerbKey } from '../lib/verbKeys'

type UseFileVerbKeysArgs = {
  orderedEntries: FsEntry[]
  selectedEntries: FsEntry[]
  renamingPath: string | null
  /** Any modal is up — every verb key must be inert while one is. */
  modalOpen: boolean
  /** The context menu is open; it owns the keyboard until it closes. */
  menuOpen: boolean
  onRename: (entry: FsEntry) => void
  /** Delete the current selection; `permanent` skips the Trash (Shift+Delete). */
  onDelete: (permanent: boolean) => void
  onCopy: (entries: FsEntry[]) => void
  onCut: (entries: FsEntry[]) => void
  onPaste: () => void
  onSelectAll: (orderedPaths: string[]) => void
  /**
   * Open the context menu at a screen point. Called with the selected row's
   * rect so the menu appears *on the row*, not wherever the mouse was left.
   */
  onOpenMenu: (entry: FsEntry | null, point: { x: number; y: number }) => void
  /** Bring an index into view before measuring its row (virtualized list). */
  scrollToIndex: (index: number) => void
  /** The scroll container, for finding a row's rect by `data-entry-path`. */
  listRef: React.RefObject<HTMLElement | null>
}

/**
 * The file verbs, on the keyboard (brief 111).
 *
 * Bound on the list wrapper that already hosts the arrow keys, not on the
 * window: the kit's dialogs portal to `document.body`, so a window-level
 * listener would still hear Delete while a confirm dialog's button has focus
 * and act on a list the user cannot see. Same focus scope as the arrows means
 * the same answer to "does this apply to what I'm looking at?" — yes, always.
 *
 * Which keys are ours (and, more importantly, when none of them are) lives in
 * `lib/verbKeys.ts` and is tested there. `preventDefault` fires only for a key
 * this actually handles.
 */
export function useFileVerbKeys({
  orderedEntries,
  selectedEntries,
  renamingPath,
  modalOpen,
  menuOpen,
  onRename,
  onDelete,
  onCopy,
  onCut,
  onPaste,
  onSelectAll,
  onOpenMenu,
  scrollToIndex,
  listRef,
}: UseFileVerbKeysArgs) {
  const handleVerbKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const verb = classifyVerbKey(
        {
          key: e.key,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          targetTag: target?.tagName ?? '',
          targetEditable: target?.isContentEditable === true,
        },
        { renaming: renamingPath !== null, modalOpen, menuOpen }
      )
      if (!verb) return

      // Ctrl+A and paste are meaningful with nothing selected; the rest are not.
      const needsSelection =
        verb === 'rename' ||
        verb === 'trash' ||
        verb === 'delete-permanently' ||
        verb === 'copy' ||
        verb === 'cut'
      if (needsSelection && selectedEntries.length === 0) return
      // Rename is inherently singular — there is one input.
      if (verb === 'rename' && selectedEntries.length !== 1) return

      e.preventDefault()
      switch (verb) {
        case 'rename':
          onRename(selectedEntries[0])
          return
        case 'trash':
          onDelete(false)
          return
        case 'delete-permanently':
          onDelete(true)
          return
        case 'copy':
          onCopy(selectedEntries)
          return
        case 'cut':
          onCut(selectedEntries)
          return
        case 'paste':
          onPaste()
          return
        case 'select-all':
          onSelectAll(orderedEntries.map((en) => en.path))
          return
        case 'context-menu': {
          const entry =
            selectedEntries.length === 1 ? selectedEntries[0] : (selectedEntries[0] ?? null)
          if (!entry) {
            // Nothing selected: the background menu, at the pane's top-left so
            // it is on screen rather than at a stale cursor position.
            const rect = listRef.current?.getBoundingClientRect()
            onOpenMenu(null, { x: (rect?.left ?? 0) + 16, y: (rect?.top ?? 0) + 16 })
            return
          }
          // The row may be scrolled out and therefore unmounted — ask the
          // virtualizer for it first, then measure. If it still is not there
          // (the scroll is async), fall back to the pane's own corner rather
          // than opening the menu at 0,0 in the top-left of the screen.
          const index = orderedEntries.findIndex((en) => en.path === entry.path)
          if (index >= 0) scrollToIndex(index)
          const row = listRef.current?.querySelector(
            `[data-entry-path="${CSS.escape(entry.path)}"]`
          )
          const rect = (row ?? listRef.current)?.getBoundingClientRect()
          onOpenMenu(entry, { x: (rect?.left ?? 0) + 24, y: (rect?.bottom ?? 0) - 4 })
          return
        }
      }
    },
    [
      orderedEntries,
      selectedEntries,
      renamingPath,
      modalOpen,
      menuOpen,
      onRename,
      onDelete,
      onCopy,
      onCut,
      onPaste,
      onSelectAll,
      onOpenMenu,
      scrollToIndex,
      listRef,
    ]
  )

  return { handleVerbKeyDown }
}
