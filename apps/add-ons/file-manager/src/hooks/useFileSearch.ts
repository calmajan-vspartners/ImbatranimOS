import { useCallback, useState } from 'react'
import { useSearchQuery } from '../queries/filesQueries'
import type { SearchHit } from '../api/filesApi'
import { useDebouncedValue } from '../lib/useDebouncedValue'

export type FileSearchState = {
  hits: SearchHit[]
  truncated: boolean
  /** A request (or the debounce before it) is outstanding. */
  searching: boolean
  /** The visible rows answer an EARLIER query — kept to avoid strobing. */
  stale: boolean
  /** Content mode, with a query typed but not yet run — waiting on Enter. */
  awaitingRun: boolean
  error: boolean
  /** Run the content search for the query as typed right now. */
  run: () => void
}

const NAME_DEBOUNCE_MS = 300

/**
 * The file manager's search, scoped to the folder it is showing (brief 112).
 *
 * Two speeds, deliberately:
 *
 * - **Names** search live on a ~300ms debounce. That is what makes the box feel
 *   like the command palette rather than a form.
 * - **Content** runs only when the user presses Enter. The content grep is a
 *   real filesystem walk that reads up to 256 KB per file under a 3s budget
 *   (`FilesService.searchBounds`), so firing it per keystroke would turn typing
 *   into a self-inflicted DoS of the container.
 *
 * The content latch is state, not an effect: `latched` only ever changes on an
 * explicit `run()`, and the effective query drops back to '' the moment the box
 * stops matching what was run. So editing after a content search clears the
 * rows rather than leaving an answer to a question the user has moved on from.
 *
 * Staleness is handled by the query key, not by request ids — see
 * `useSearchQuery`. `stale` here is react-query's placeholder flag surfaced so
 * the view can say "these are the previous results" instead of implying the
 * rows answer what is currently typed.
 */
export function useFileSearch(
  root: string,
  path: string,
  query: string,
  contentMode: boolean
): FileSearchState {
  const trimmed = query.trim()
  const debounced = useDebouncedValue(trimmed, NAME_DEBOUNCE_MS)
  const [latched, setLatched] = useState('')

  const run = useCallback(() => setLatched(trimmed), [trimmed])

  // In content mode only the latched query is ever sent, and only while the box
  // still says the same thing — never a stale answer under a changed question.
  const effective = contentMode ? (latched !== '' && latched === trimmed ? latched : '') : debounced

  const q = useSearchQuery(root, path, effective, contentMode, trimmed.length > 0)

  const idle = effective === ''
  const debouncePending = !contentMode && trimmed !== debounced

  return {
    hits: idle ? [] : (q.data?.items ?? []),
    truncated: idle ? false : Boolean(q.data?.truncated),
    searching: trimmed.length > 0 && (debouncePending || (!idle && q.isFetching)),
    stale: !idle && q.isPlaceholderData,
    awaitingRun: contentMode && trimmed.length > 0 && idle,
    error: !idle && q.isError,
    run,
  }
}
