import type { FsEntry } from '../types'

/**
 * Ordering and filtering for the file list.
 *
 * Pure functions, kept out of the components, because this is the one piece of
 * the File Manager where being subtly wrong is invisible: a list is always in
 * *some* order, so a broken comparator looks like a working one.
 *
 * ## Directories are pinned above files, always
 *
 * Even when sorting by size or date, and in both directions. That is the
 * convention the existing UI already implied (`sortEntries` did it for name), and
 * it is what every desktop file manager does — a folder has no meaningful size to
 * compare against a file's, so interleaving them by size would order folders by an
 * inode size the user cannot see.
 */

export type SortKey = 'name' | 'size' | 'modified'
export type SortDir = 'asc' | 'desc'

export const SORT_KEYS: readonly SortKey[] = ['name', 'size', 'modified']

/** Column header labels, so the header and the persisted key cannot drift. */
export const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name',
  size: 'Size',
  modified: 'Modified',
}

function compareName(a: FsEntry, b: FsEntry): number {
  return a.name.localeCompare(b.name)
}

/**
 * A directory's `size` is the inode size, which is not comparable to a file's and
 * is not something the user can see — so two directories fall back to comparing by
 * name. Sorting a folder list by "size" and getting an apparently arbitrary
 * shuffle is worse than getting alphabetical.
 *
 * The direction still applies to that fallback, so descending reverses the folder
 * names too. That is deliberate: it matches Explorer, and folders running A→Z
 * while the files beneath them run Z→A from the same click reads as a bug.
 */
function compareSize(a: FsEntry, b: FsEntry): number {
  if (a.type === 'directory' && b.type === 'directory') return compareName(a, b)
  return a.size - b.size
}

function compareModified(a: FsEntry, b: FsEntry): number {
  const at = Date.parse(a.modifiedAt)
  const bt = Date.parse(b.modifiedAt)
  // An unparseable timestamp sorts last rather than poisoning the comparator with
  // NaN, which would make the sort order depend on the input order (and on the
  // engine's sort implementation).
  const aBad = Number.isNaN(at)
  const bBad = Number.isNaN(bt)
  if (aBad && bBad) return compareName(a, b)
  if (aBad) return 1
  if (bBad) return -1
  return at - bt
}

const COMPARATORS: Record<SortKey, (a: FsEntry, b: FsEntry) => number> = {
  name: compareName,
  size: compareSize,
  modified: compareModified,
}

/**
 * Sort a directory listing. Never mutates the input — it is TanStack Query's
 * cached array, and sorting it in place would reorder the cache under other
 * readers.
 */
export function sortEntries(entries: FsEntry[], key: SortKey, dir: SortDir): FsEntry[] {
  const compare = COMPARATORS[key]
  const sign = dir === 'desc' ? -1 : 1
  return [...entries].sort((a, b) => {
    // Directories first, and NOT flipped by direction: "reverse by name" should
    // still list folders above files, or descending order would hide every folder
    // below a long file list.
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    const primary = compare(a, b) * sign
    if (primary !== 0) return primary
    // Name is the tiebreak for every key, so the order is total and stable: two
    // files of equal size must not swap places between renders.
    return key === 'name' ? 0 : compareName(a, b)
  })
}

/** Whether an entry is hidden by the dotfile convention. */
export function isHidden(entry: FsEntry): boolean {
  return entry.name.startsWith('.')
}

/**
 * Drop dotfiles unless the user asked for them.
 *
 * Filtered client-side on purpose: the backend lists them unconditionally, and
 * teaching it to filter would change `search` behaviour too, where "find my
 * .bashrc" is a reasonable thing to want.
 */
export function filterHidden(entries: FsEntry[], showHidden: boolean): FsEntry[] {
  if (showHidden) return entries
  return entries.filter((e) => !isHidden(e))
}

/**
 * The direction a header click should produce.
 *
 * Clicking a new column starts at its natural direction rather than inheriting
 * the previous column's: ascending for names (A→Z), descending for size and date
 * (biggest and newest first), which is what the user means by "sort by size".
 * Clicking the active column flips it.
 */
export function nextSort(
  current: { key: SortKey; dir: SortDir },
  clicked: SortKey
): { key: SortKey; dir: SortDir } {
  if (current.key === clicked) {
    return { key: clicked, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  }
  return { key: clicked, dir: clicked === 'name' ? 'asc' : 'desc' }
}

/** `aria-sort` value for a column header. */
export function ariaSort(
  column: SortKey,
  current: { key: SortKey; dir: SortDir }
): 'ascending' | 'descending' | 'none' {
  if (current.key !== column) return 'none'
  return current.dir === 'asc' ? 'ascending' : 'descending'
}

/** Icons-view tile geometry, shared by the grid and the virtualizer's estimator. */
export const TILE_WIDTH = 96
export const TILE_HEIGHT = 92

/**
 * How many tiles fit across a pane of `width` CSS pixels.
 *
 * Never zero: a zero column count divides into `Infinity` rows and NaN indices,
 * and a pane genuinely measures 0 before first layout and while a window is
 * dragged to nothing.
 */
export function gridColumns(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1
  return Math.max(1, Math.floor(width / TILE_WIDTH))
}

/** Number of grid rows needed for `count` entries at `columns` per row. */
export function gridRowCount(count: number, columns: number): number {
  if (count <= 0) return 0
  return Math.ceil(count / Math.max(1, columns))
}
