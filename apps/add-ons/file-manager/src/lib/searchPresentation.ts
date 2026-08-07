/**
 * Wording for the search results view (brief 112).
 *
 * Pure, and separate from the components, for one reason: the header, the row
 * subtitles and the status bar all have to name the *same* place the same way.
 * When that formatting lived inline three times it drifted — the header said
 * "/docs", a row said "docs", and the status bar said "Home/docs".
 */

/** The directory portion of a root-relative path — '' for a top-level entry. */
export function parentOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

/**
 * How a folder inside a root is named to the user: the root's own label at the
 * top, a leading-slash path below it. `/docs` rather than `docs` so a folder
 * called "docs" can never be confused with a *file* called "docs" in a row that
 * shows both.
 */
export function scopeLabel(rootLabel: string, path: string): string {
  return path ? `/${path}` : rootLabel
}

/** "1 result" / "7 results" — the count, with the noun agreeing. */
export function resultCountLabel(count: number): string {
  return `${count} result${count === 1 ? '' : 's'}`
}

/**
 * The honest banner for a `truncated: true` response.
 *
 * The backend stops the walk at the first bound it hits (results, dirents,
 * depth or the 3s budget) and says so; the command palette drops that flag on
 * the floor. This view must not — "no more matches" and "I stopped looking"
 * are different answers, and only one of them means the file is not there.
 */
export function truncationNote(shown: number): string {
  return `Stopped early — first ${shown} shown. Narrow the search or look in a smaller folder.`
}
