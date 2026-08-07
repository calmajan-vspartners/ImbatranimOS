/**
 * Selection arithmetic for the file list (brief 111).
 *
 * Pure, and separate from `useFileSelection`, because range selection is the
 * one part of this that is easy to get subtly wrong — backwards ranges, an
 * anchor that no longer exists after a refresh, a range that silently drops
 * everything. The hook owns the state; this owns the maths, and the maths has
 * tests.
 */

/** What a click or an arrow means, derived from the modifier keys. */
export type SelectMode = 'replace' | 'toggle' | 'range'

export function modeFromEvent(e: {
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}): SelectMode {
  // Shift wins over Ctrl: Ctrl+Shift+click is a range everywhere else in the
  // world, and picking "toggle" there would make the two modifiers fight.
  if (e.shiftKey) return 'range'
  if (e.ctrlKey || e.metaKey) return 'toggle'
  return 'replace'
}

/**
 * Every path between `from` and `to` inclusive, in list order, either direction.
 *
 * `orderedPaths` must be the SAME array the rows are rendered from
 * (`orderedEntries`) — a range computed over the raw query data would select
 * rows the user cannot see once sorting or the hidden-file filter is on.
 *
 * A missing anchor (deleted, renamed, or filtered away since it was set)
 * degrades to selecting just `to` rather than selecting nothing: the user
 * asked for a range ending here, and "here" is the half we can still honour.
 */
export function rangeBetween(orderedPaths: string[], from: string, to: string): string[] {
  const b = orderedPaths.indexOf(to)
  if (b === -1) return []
  const a = orderedPaths.indexOf(from)
  if (a === -1) return [to]
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  return orderedPaths.slice(lo, hi + 1)
}

/**
 * The next selection for a click/keypress on `path`.
 *
 * `replace` and `toggle` reproduce the pre-brief-111 behaviour exactly,
 * including the quirk that clicking the sole selected row clears it — that is
 * how this app has always behaved and the brief's regression surface pins it.
 */
export function applySelect(
  prev: ReadonlySet<string>,
  mode: SelectMode,
  path: string,
  orderedPaths: string[],
  anchor: string | null
): Set<string> {
  if (mode === 'range') {
    return new Set(rangeBetween(orderedPaths, anchor ?? path, path))
  }
  const next = new Set(prev)
  if (mode === 'toggle') {
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  }
  if (next.size === 1 && next.has(path)) return new Set()
  return new Set([path])
}

/**
 * Where the anchor should sit after a selection change.
 *
 * A range must NOT move it — that is the whole point of an anchor: Shift+Down
 * five times then Shift+Up three times has to shrink the same range, not walk
 * a one-row window down the list.
 */
export function nextAnchor(mode: SelectMode, path: string, anchor: string | null): string | null {
  return mode === 'range' ? (anchor ?? path) : path
}
