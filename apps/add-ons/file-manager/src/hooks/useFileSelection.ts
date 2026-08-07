import { useCallback, useRef, useState } from 'react'
import { applySelect, nextAnchor, rangeBetween, type SelectMode } from '../lib/selectionModel'

/**
 * Multi-select state for the file list.
 *
 * Plain click replaces the selection (clicking the sole selected row clears
 * it) and ctrl/meta-click toggles — both byte-for-byte as before brief 111.
 * Shift-click and Shift+Arrow now extend a range from an anchor.
 *
 * The anchor lives here rather than in `FileManager` (which is where the brief
 * put it) for a mechanical reason: `clear()` has to reset it, and `clear()` is
 * called from four places. An anchor stored beside the selection cannot drift
 * out of sync with it; an anchor stored one level up can, and the failure mode
 * — a Shift-click that selects a range starting at a row deleted three actions
 * ago — is invisible until it happens. It is a ref, not state: nothing renders
 * from it.
 *
 * `setSelected` stays exposed for callers that need whole-set updates (the
 * delete flow's partial-failure re-selection, keyboard nav) so their semantics
 * are unchanged.
 */
export function useFileSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const anchorRef = useRef<string | null>(null)
  /**
   * The row the last click or arrow landed on — where the NEXT arrow moves
   * from. It cannot be derived from the selection: with a range selected there
   * is no single current row, and guessing "the end nearest the direction of
   * travel" gets Shift+Up after Shift+Down wrong (it walks off the *start* of
   * the range instead of pulling the *end* back). Also a ref: nothing renders
   * from it, and it must be readable inside a keydown without a re-render.
   */
  const cursorRef = useRef<string | null>(null)

  /**
   * Apply a click/keypress to the selection. `orderedPaths` must be the same
   * order the rows are rendered in — ranges are meaningless against any other.
   */
  const select = useCallback((entryPath: string, mode: SelectMode, orderedPaths: string[] = []) => {
    setSelected((prev) => applySelect(prev, mode, entryPath, orderedPaths, anchorRef.current))
    anchorRef.current = nextAnchor(mode, entryPath, anchorRef.current)
    cursorRef.current = entryPath
  }, [])

  /** Extend the selection to `toPath` from the current anchor, leaving it put. */
  const selectRange = useCallback((orderedPaths: string[], toPath: string) => {
    const from = anchorRef.current ?? toPath
    anchorRef.current = from
    cursorRef.current = toPath
    setSelected(new Set(rangeBetween(orderedPaths, from, toPath)))
  }, [])

  const selectAll = useCallback((orderedPaths: string[]) => {
    if (orderedPaths.length === 0) return
    anchorRef.current = orderedPaths[0]
    cursorRef.current = orderedPaths[orderedPaths.length - 1]
    setSelected(new Set(orderedPaths))
  }, [])

  /** Point the anchor at a row without changing what is selected. */
  const setAnchor = useCallback((entryPath: string | null) => {
    anchorRef.current = entryPath
    cursorRef.current = entryPath
  }, [])

  /** Where the next arrow moves from, or null when there is nowhere yet. */
  const getCursor = useCallback(() => cursorRef.current, [])

  const clear = useCallback(() => {
    anchorRef.current = null
    cursorRef.current = null
    setSelected(new Set())
  }, [])

  return { selected, setSelected, select, selectRange, selectAll, setAnchor, getCursor, clear }
}
