export type SavedTab = { root: string; path: string }

const KEY = 'imbatranimos:code-editor:tabs'

/**
 * Remember which files were open, for the length of a browser session.
 *
 * Deliberately narrow, because the window layout it would want to key off does
 * not support anything wider. `PersistedWindow` stores no window id, so ids are
 * freshly minted on every reload and a per-window record could never be matched
 * back to its window. What is left that is still honest: one shared record of
 * the last tab set, claimed by the first editor window that opens with nothing
 * to show. That covers the case this exists for — an accidental reload losing
 * six open files — and does not pretend to cover per-window restore.
 *
 * `sessionStorage`, not `localStorage`: these are session state (brief 49), not
 * a durable dotfile, and a tab list that outlives the browser session would be
 * a config store nobody asked for. Untitled tabs are never recorded — their
 * contents are not on disk, so "restoring" one would restore an empty buffer
 * wearing the name of work that is gone.
 */
export function saveTabSession(tabs: SavedTab[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(tabs))
  } catch {
    // quota exceeded or storage disabled — the session record is optional
  }
}

export function loadTabSession(): SavedTab[] {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (t): t is SavedTab =>
        typeof t === 'object' &&
        t !== null &&
        typeof (t as SavedTab).root === 'string' &&
        typeof (t as SavedTab).path === 'string'
    )
  } catch {
    return []
  }
}

// Module-scoped, so it resets on reload exactly as the session record does.
let claimed = false

/**
 * Hand the saved tab set to the first caller of the page load, and nothing to
 * every caller after it. The editor is `multiInstance`, so without this a
 * second window would open a duplicate of the first one's tabs.
 */
export function claimTabSession(): SavedTab[] {
  if (claimed) return []
  claimed = true
  return loadTabSession()
}

/** Test seam — the claim flag is module state and must be resettable. */
export function resetTabSessionClaim(): void {
  claimed = false
}
