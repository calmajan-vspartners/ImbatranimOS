import { useCallback } from 'react'
import type { FsEntry } from '../types'

type UseListKeyboardNavArgs = {
  orderedEntries: FsEntry[]
  selectedEntries: FsEntry[]
  renamingPath: string | null
  onOpen: (entry: FsEntry) => void
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>
  /** Extend the selection from the anchor to a path (Shift+Arrow, brief 111). */
  selectRange: (orderedPaths: string[], toPath: string) => void
  /** Move the range anchor without changing the selection (plain arrows). */
  setAnchor: (entryPath: string | null) => void
  /** The row the last click/arrow landed on — where this arrow moves FROM. */
  getCursor: () => string | null
  /**
   * Brings a row into view by index. Must go through the virtualizer: a row
   * scrolled out of the window is unmounted, so a DOM `scrollIntoView` would
   * find nothing and the focused row would stay off-screen (and unmounted).
   */
  scrollToIndex: (index: number) => void
  /**
   * Entries per visual row: 1 in Details view, the grid's column count in Icons
   * view. Up/Down move by this many entries and Left/Right by one, which is what
   * makes arrow keys follow the *layout* rather than the array — in a grid,
   * ArrowDown moving by one entry would step sideways.
   */
  columns?: number
}

/**
 * Arrow-key + Enter navigation for the file list, in either view mode. Enter opens
 * a lone selection; arrows move a single-entry selection (starting from top/bottom
 * when nothing is selected) and never fire while an inline rename input is
 * focused. After a move it asks the virtualizer to scroll the newly selected index
 * into view.
 *
 * `columns` makes it work in the Icons grid: Up/Down move a whole row, Left/Right
 * move one tile. In Details view `columns` is 1 and the behaviour is exactly as it
 * was, including leaving Left/Right alone.
 */
export function useListKeyboardNav({
  orderedEntries,
  selectedEntries,
  renamingPath,
  onOpen,
  setSelected,
  selectRange,
  setAnchor,
  getCursor,
  scrollToIndex,
  columns = 1,
}: UseListKeyboardNavArgs) {
  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight'
      const vertical = e.key === 'ArrowDown' || e.key === 'ArrowUp'
      // Left/Right are only ours in a grid. In Details view they must stay
      // unhandled — the tree pane and the browser's own caret behaviour use them,
      // and claiming a key to do nothing is worse than not claiming it.
      if (!vertical && e.key !== 'Enter' && !(horizontal && columns > 1)) return
      if (orderedEntries.length === 0) return
      // Editing a name inline — let the input handle its own keys.
      if (renamingPath) return

      if (e.key === 'Enter') {
        if (selectedEntries.length === 1) {
          e.preventDefault()
          onOpen(selectedEntries[0])
        }
        return
      }

      e.preventDefault()
      // Move from the CURSOR, not from the selection. With a range selected
      // there is no single current row, and picking an end of the range by the
      // direction of travel gets Shift+Up-after-Shift+Down wrong: it walks off
      // the start of the range instead of pulling its end back.
      const forwardKey = e.key === 'ArrowDown' || e.key === 'ArrowRight'
      const cursor = getCursor()
      const currentPath =
        cursor !== null && orderedEntries.some((en) => en.path === cursor)
          ? cursor
          : selectedEntries.length === 1
            ? selectedEntries[0].path
            : null
      const currentIndex = currentPath
        ? orderedEntries.findIndex((en) => en.path === currentPath)
        : -1
      const last = orderedEntries.length - 1
      const step = vertical ? columns : 1
      const forward = forwardKey
      let nextIndex: number
      if (currentIndex === -1) {
        nextIndex = forward ? 0 : last
      } else {
        // Clamped rather than wrapped, and clamped to the ends of the list rather
        // than of the row: ArrowDown on the last row lands on the final entry
        // instead of doing nothing, which is what a partly-filled bottom row needs.
        nextIndex = Math.min(last, Math.max(0, currentIndex + (forward ? step : -step)))
      }
      const next = orderedEntries[nextIndex]
      if (e.shiftKey) {
        // The anchor stays where it was, so the range grows and shrinks around
        // it instead of dragging a one-row window down the list.
        selectRange(
          orderedEntries.map((en) => en.path),
          next.path
        )
      } else {
        setSelected(new Set([next.path]))
        setAnchor(next.path)
      }
      scrollToIndex(nextIndex)
    },
    [
      orderedEntries,
      selectedEntries,
      renamingPath,
      onOpen,
      setSelected,
      selectRange,
      setAnchor,
      getCursor,
      scrollToIndex,
      columns,
    ]
  )

  return { handleListKeyDown }
}
