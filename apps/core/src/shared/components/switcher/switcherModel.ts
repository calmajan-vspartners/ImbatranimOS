/**
 * The Alt+Tab switcher's pure core (brief 104) — the ordering and the
 * selection state machine, DOM-free so the unit tests can pin the semantics
 * that today's blind cycle got wrong (landing on the least-recently-used
 * window; no reverse; minimized windows unreachable).
 */

export type SwitcherWindow = {
  id: string
  appId: string
  title: string
  isVisible: boolean
  workspaceId: number
  zIndex: number
}

/**
 * The windows Alt+Tab cycles, most-recently-used first.
 *
 * MRU is zIndex DESCENDING — no new bookkeeping: `focusWindow` mints a
 * monotonically increasing zIndex on every focus, so the existing z stack is
 * the recency list. Minimized windows are included (a hidden window keeps the
 * z it had when last focused — and the overlay is what makes including them
 * safe, because you can see you are about to land on one). Scoped to one
 * workspace, like the per-workspace taskbar.
 */
export function switcherOrder<W extends SwitcherWindow>(
  windows: readonly W[],
  activeWorkspace: number
): W[] {
  return windows
    .filter((w) => w.workspaceId === activeWorkspace)
    .sort((a, b) => b.zIndex - a.zIndex)
}

export type SwitcherState = {
  /** Window ids in MRU order, snapshotted when the switcher opened. */
  ids: string[]
  /** Index of the selected cell. */
  index: number
}

/**
 * Open the switcher, or advance the selection if already open.
 *
 * Opening starts at the SECOND-most-recent entry (index 1) so a quick tap
 * toggles the last two windows — the single most common switch on any
 * desktop, and the direct fix for the old cycle landing on the LRU window.
 * With one candidate it opens showing that window (commit is then a no-op);
 * with zero it does not open.
 */
export function openOrAdvance(
  state: SwitcherState | null,
  orderedIds: string[],
  dir: 1 | -1
): SwitcherState | null {
  if (state === null) {
    if (orderedIds.length === 0) return null
    if (orderedIds.length === 1) return { ids: orderedIds, index: 0 }
    // Opening backwards (alt+shift+tab first press) starts at the far end.
    const index = dir === 1 ? 1 : orderedIds.length - 1
    return { ids: orderedIds, index }
  }
  const len = state.ids.length
  if (len === 0) return state
  return { ...state, index: (state.index + dir + len) % len }
}

/** The id a commit should focus, or null when there is nothing to do. */
export function commitTarget(state: SwitcherState | null): string | null {
  if (state === null || state.ids.length === 0) return null
  return state.ids[state.index] ?? null
}
