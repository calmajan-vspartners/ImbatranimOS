/**
 * The reader console — the top control bar. Identity + document title, file I/O,
 * search, zoom/fit and the panel toggle. Rebuilt in the OS design language
 * (Tailwind tokens + `@imbatranim/core` UI); the AtelierPDF chrome is gone.
 *
 * ── PART B SEAM ────────────────────────────────────────────────────────────
 * `toolbarSlot` renders a second console row. Part B mounts the **annotate
 * toolbar** here (pass it as the `toolbarSlot` prop from NorPdf). The row only
 * appears when the slot is non-empty and carries `data-slot="annotate-toolbar"`
 * for direct targeting.
 */
import { useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import {
  FilePen,
  FolderOpen,
  Download,
  Save as SaveIcon,
  Search,
  ZoomIn,
  ZoomOut,
  MoveHorizontal,
  Maximize,
  PanelLeft,
  ChevronUp,
  ChevronDown,
} from 'lucide-react'
import { Button, Separator, Tooltip, useSaveHotkey, useTopWindowKeydown } from '@imbatranim/core'
import { useReader } from '../app/context'
import { useEditor } from '../editor/context'
import { ToolButton } from './ToolButton'

const ACTUAL = 96 / 72

export interface TopBarProps {
  onOpenClick: () => void
  /** PART B annotate toolbar mounts here. */
  toolbarSlot?: ReactNode
}

export function TopBar({ onOpenClick, toolbarSlot }: TopBarProps): JSX.Element {
  const {
    windowId,
    doc,
    docName,
    currentPage,
    pageCount,
    goToPage,
    scale,
    fitMode,
    zoomIn,
    zoomOut,
    setFitMode,
    panelOpen,
    togglePanel,
    exportCopy,
    dirty,
    search,
    runSearch,
    clearSearch,
    nextHit,
    prevHit,
  } = useReader()
  const { saveToDisk, busy } = useEditor()

  const [query, setQuery] = useState('')
  const [pageInput, setPageInput] = useState(() => String(currentPage))
  const searchRef = useRef<HTMLInputElement>(null)

  // Sync local input state from props during render (the React-endorsed
  // "adjust state on prop change" pattern) rather than in an effect: the page
  // box follows external navigation, and the search box clears when the
  // controller's query is reset.
  const [syncedPage, setSyncedPage] = useState(currentPage)
  if (currentPage !== syncedPage) {
    setSyncedPage(currentPage)
    setPageInput(String(currentPage))
  }
  const [syncedQuery, setSyncedQuery] = useState(search.query)
  if (search.query !== syncedQuery) {
    setSyncedQuery(search.query)
    if (!search.query) setQuery('')
  }

  // Ctrl/Cmd+S writes the document back to its file (the save spine), and
  // Ctrl/Cmd+F focuses search — both scoped to the TOP window via the core
  // seams, so a background norPDF window never fires them and they never steal
  // the keystroke from another app. Registered here (inside EditorProvider) so
  // Save can reach the editor's write-back-and-reload path. `ignoreTextEntry:
  // false` on Find so it still works while a field (the search box itself, the
  // page jump) is focused.
  useSaveHotkey(windowId, () => void saveToDisk())
  useTopWindowKeydown(
    windowId,
    (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f' && doc) {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    },
    { ignoreTextEntry: false }
  )

  const pct = Math.round((scale / ACTUAL) * 100)
  const hasHits = search.hits.length > 0

  return (
    <header className="border-outline-variant bg-surface-container-low border-b">
      <div className="flex flex-wrap items-center gap-1 px-2 py-1">
        {/* Identity + panel toggle */}
        <ToolButton
          icon={PanelLeft}
          label={panelOpen ? 'Hide side panel' : 'Show side panel'}
          active={panelOpen}
          onClick={togglePanel}
          disabled={!doc}
        />
        <span className="text-on-surface font-ui mr-1 ml-0.5 flex items-center gap-1.5 text-[12px] font-semibold">
          <FilePen size={15} className="text-primary" />
          norPDF
        </span>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Document title + page jump */}
        <div className="flex min-w-0 items-center gap-1.5" title={docName}>
          {doc ? (
            <>
              <span className="text-on-surface-variant font-ui max-w-[180px] truncate text-[11px]">
                {docName}
              </span>
              <span className="text-on-surface-variant flex items-center gap-1 text-[11px] tabular-nums">
                <input
                  className="border-outline-variant bg-surface-container-lowest text-on-surface focus:border-primary w-9 border px-1 py-0.5 text-center outline-none"
                  value={pageInput}
                  inputMode="numeric"
                  onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const n = parseInt(pageInput, 10)
                      if (Number.isFinite(n)) goToPage(n)
                      ;(e.target as HTMLInputElement).blur()
                    }
                  }}
                  onFocus={(e) => e.target.select()}
                  aria-label="Go to page"
                />
                <span>/ {pageCount}</span>
              </span>
            </>
          ) : (
            <span className="text-on-surface-variant font-ui text-[11px] italic">
              No document open
            </span>
          )}
        </div>

        <div className="flex-1" />

        {/* Search */}
        <div className="border-outline-variant bg-surface-container-lowest focus-within:border-primary flex items-center gap-1 border px-1.5">
          <Search size={13} className="text-on-surface-variant shrink-0" />
          <input
            ref={searchRef}
            className="text-on-surface placeholder:text-on-surface-variant font-ui w-36 bg-transparent py-1 text-[12px] outline-none"
            type="search"
            placeholder="Search document…"
            value={query}
            disabled={!doc}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch(query)
              if (e.key === 'Escape') {
                setQuery('')
                clearSearch()
                ;(e.target as HTMLInputElement).blur()
              }
            }}
          />
          {search.busy && <span className="text-on-surface-variant text-[10px]">…</span>}
          {!search.busy && search.ran && (
            <span className="text-on-surface-variant text-[10px] tabular-nums">
              {hasHits ? `${search.activeIndex + 1}/${search.hits.length}` : '0'}
            </span>
          )}
          {hasHits && (
            <span className="flex items-center">
              <ToolButton icon={ChevronUp} iconSize={13} label="Previous match" onClick={prevHit} />
              <ToolButton icon={ChevronDown} iconSize={13} label="Next match" onClick={nextHit} />
            </span>
          )}
        </div>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Zoom / fit */}
        <ToolButton icon={ZoomOut} label="Zoom out (−)" onClick={zoomOut} disabled={!doc} />
        <span
          className="text-on-surface-variant min-w-[38px] text-center text-[11px] tabular-nums"
          aria-live="polite"
        >
          {doc ? `${pct}%` : '—'}
        </span>
        <ToolButton icon={ZoomIn} label="Zoom in (+)" onClick={zoomIn} disabled={!doc} />
        <ToolButton
          icon={MoveHorizontal}
          label="Fit width"
          active={fitMode === 'width'}
          onClick={() => setFitMode('width')}
          disabled={!doc}
        />
        <ToolButton
          icon={Maximize}
          label="Fit page"
          active={fitMode === 'page'}
          onClick={() => setFitMode('page')}
          disabled={!doc}
        />

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Actions */}
        <ToolButton icon={FolderOpen} label="Open PDF" onClick={onOpenClick} />
        <Tooltip content="Export a copy (download)">
          <Button
            variant="ghost"
            size="sm"
            className="flex items-center gap-1"
            onClick={() => void exportCopy()}
            disabled={!doc}
            aria-label="Export a copy"
          >
            <Download size={12} />
          </Button>
        </Tooltip>
        <Tooltip content="Save (Ctrl+S) — write changes back to the file">
          <Button
            variant="default"
            size="sm"
            className="flex items-center gap-1"
            onClick={() => void saveToDisk()}
            disabled={!doc || busy || !dirty}
          >
            <SaveIcon size={12} />
            Save
          </Button>
        </Tooltip>
      </div>

      {/* PART B: annotate toolbar row (renders only when a slot is provided). */}
      {toolbarSlot && (
        <div
          className="border-outline-variant bg-surface-container flex items-center gap-1 border-t px-2 py-1"
          data-slot="annotate-toolbar"
        >
          {toolbarSlot}
        </div>
      )}
    </header>
  )
}
