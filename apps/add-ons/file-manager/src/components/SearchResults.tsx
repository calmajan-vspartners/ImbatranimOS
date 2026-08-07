import { SearchX, AlertTriangle, CornerDownLeft } from 'lucide-react'
import { cn } from '@imbatranim/ui'
import { ScrollArea } from '@imbatranim/ui'
import type { SearchHit } from '../api/filesApi'
import { getFileIcon } from '../lib/entryPresentation'
import { parentOf, resultCountLabel, scopeLabel, truncationNote } from '../lib/searchPresentation'

type SearchResultsProps = {
  hits: SearchHit[]
  truncated: boolean
  searching: boolean
  stale: boolean
  awaitingRun: boolean
  error: boolean
  /** What the user typed (for the empty state — the header names the scope). */
  query: string
  contentMode: boolean
  rootLabel: string
  /** Folder the search is scoped to, root-relative ('' = the root itself). */
  path: string
  selectedPath: string | null
  onSelect: (path: string) => void
  onOpen: (hit: SearchHit) => void
  /** Escape inside the list clears the search and returns to the listing. */
  onDismiss: () => void
  containerRef: React.RefObject<HTMLDivElement | null>
}

/**
 * The results view (brief 112) — a SIBLING of the directory listing, never a
 * child of it.
 *
 * That placement is load-bearing. The listing pane is wrapped in an
 * `UploadDropzone` and a div carrying `onClick={selection.clear}`,
 * `onContextMenu={openBackgroundMenu}` and `onKeyDown={handleListKeyDown}` —
 * all four of which are about the *current directory*. Rendered inside it,
 * ArrowDown would move an invisible selection through the hidden listing,
 * right-click would offer "New Folder" in the folder you left, and a dropped
 * file would upload to the wrong place. Swapping the whole block out means
 * none of that can reach these rows.
 *
 * No virtualizer: the backend caps at `FILES_SEARCH_MAX_RESULTS` (100), and it
 * tells us when it stopped early instead of pretending that was everything.
 */
export function SearchResults({
  hits,
  truncated,
  searching,
  stale,
  awaitingRun,
  error,
  query,
  contentMode,
  rootLabel,
  path,
  selectedPath,
  onSelect,
  onOpen,
  onDismiss,
  containerRef,
}: SearchResultsProps) {
  const scope = scopeLabel(rootLabel, path)

  /** Move the selection by `delta` rows and keep it on screen. */
  function step(delta: number) {
    if (hits.length === 0) return
    const current = hits.findIndex((h) => h.path === selectedPath)
    // From nothing, ArrowDown lands on the first row and ArrowUp on the last.
    const next =
      current === -1
        ? delta > 0
          ? 0
          : hits.length - 1
        : Math.min(hits.length - 1, Math.max(0, current + delta))
    onSelect(hits[next].path)
    containerRef.current
      ?.querySelector(`[data-hit-index="${next}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      step(1)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      step(-1)
      return
    }
    if (e.key === 'Enter') {
      const hit = hits.find((h) => h.path === selectedPath)
      if (hit) {
        e.preventDefault()
        onOpen(hit)
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onDismiss()
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* Scope header — which folder these rows came from, always. */}
      <div className="border-outline-variant bg-surface-container flex items-center gap-2 border-b px-2 py-1">
        <span className="font-ui text-on-surface text-[12px] font-semibold">
          Results in {scope}
        </span>
        <span className="font-ui text-on-surface-variant text-[11px]">
          {searching && hits.length === 0
            ? 'Searching…'
            : stale
              ? 'Searching…'
              : resultCountLabel(hits.length)}
        </span>
        {contentMode && (
          <span className="font-ui text-primary text-[11px]">inside file contents</span>
        )}
      </div>

      {truncated && (
        <div className="border-outline-variant bg-surface-container-low flex items-center gap-2 border-b px-2 py-1">
          <AlertTriangle size={12} className="text-tertiary shrink-0" />
          <span className="font-ui text-on-surface-variant text-[11px]">
            {truncationNote(hits.length)}
          </span>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div
          ref={containerRef}
          tabIndex={0}
          role="listbox"
          aria-label={`Search results in ${scope}`}
          onKeyDown={handleKeyDown}
          className="min-h-full outline-none"
        >
          {error ? (
            <Empty icon={<AlertTriangle size={32} strokeWidth={1} />} label="Search failed." />
          ) : awaitingRun ? (
            <Empty
              icon={<CornerDownLeft size={32} strokeWidth={1} />}
              label="Press Enter to search inside file contents."
            />
          ) : hits.length === 0 && searching ? (
            <Empty icon={<SearchX size={32} strokeWidth={1} />} label="Searching…" />
          ) : hits.length === 0 ? (
            <Empty
              icon={<SearchX size={32} strokeWidth={1} />}
              label={`No matches for “${query.trim()}” in ${scope}.`}
            />
          ) : (
            hits.map((hit, index) => {
              const folder = scopeLabel(rootLabel, parentOf(hit.path))
              const selected = hit.path === selectedPath
              return (
                <div
                  key={hit.path}
                  data-hit-index={index}
                  role="option"
                  aria-selected={selected}
                  onClick={() => onSelect(hit.path)}
                  onDoubleClick={() => onOpen(hit)}
                  className={cn(
                    'flex cursor-default items-center gap-2 px-2 py-1 select-none',
                    selected ? 'bg-primary text-on-primary' : 'hover:bg-surface-container'
                  )}
                >
                  <span className="shrink-0">
                    {getFileIcon({ ...hit, size: 0, modifiedAt: '' }, 14)}
                  </span>
                  <span className="font-content truncate text-[12px]">{hit.name}</span>
                  <span
                    className={cn(
                      'font-ui ml-auto shrink-0 truncate pl-2 text-[11px]',
                      selected ? 'text-on-primary/80' : 'text-on-surface-variant'
                    )}
                  >
                    {folder}
                  </span>
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function Empty({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="text-on-surface-variant flex flex-col items-center justify-center gap-2 py-12">
      {icon}
      <span className="font-ui px-4 text-center text-[12px]">{label}</span>
    </div>
  )
}
