/**
 * View-model types for the norPDF reader shell. These describe UI state only —
 * all PDF data types come from `@pdfcore/engine`.
 *
 * Ported from the AtelierPDF reference reader; the OS owns the global theme
 * (via `[data-theme]` on `<html>`), so the reader carries no theme state.
 */
import type { DocumentMetadata, OutlineNode, PdfDoc, TextHit } from '@pdfcore/engine'

/** How the page scale is derived. `custom` = an explicit zoom the user set. */
export type FitMode = 'width' | 'page' | 'actual' | 'custom'

/** Left panel tabs. Part B may register additional tabs (e.g. "forms"). */
export type PanelTab = 'thumbnails' | 'outline' | (string & {})

/**
 * The main-area mode. `read` = the continuous-scroll reader (Part A).
 * `organize` is the page-grid view Part B mounts; the shell reserves it here so
 * the swap point exists without Part A implementing it.
 */
export type ViewMode = 'read' | 'organize' | (string & {})

/** Measured page geometry in PDF points (rotation-aware once a page renders). */
export interface PageDim {
  /** Width in points (already rotation-corrected once measured). */
  w: number
  /** Height in points. */
  h: number
  /** True once a real render viewport refined the estimate. */
  measured: boolean
}

export interface SearchState {
  query: string
  hits: TextHit[]
  /** Index into `hits` of the focused hit, or -1 when none. */
  activeIndex: number
  busy: boolean
  /** Whether a search has been run for the current `query`. */
  ran: boolean
}

/**
 * Where a write-back Save lands: the `{root, path}` of the OS file this document
 * was opened from. `null` for a document with no OS home (a dragged-in `File`),
 * where Save can only export a downloaded copy.
 */
export interface SaveTarget {
  root: string
  path: string
}

/**
 * The reader controller — the single object Part A and Part B both consume via
 * {@link ReaderContext}. Everything the editor tools need to read state, drive
 * navigation, and re-sync after a mutating edit lives here.
 */
export interface ReaderController {
  /** The OS window this reader lives in — used to scope window-global keys. */
  windowId: string

  /* ── Document ─────────────────────────────────────────────────────────── */
  doc: PdfDoc | null
  docName: string
  pageCount: number
  metadata: DocumentMetadata | null
  outline: OutlineNode[]
  pageDims: PageDim[]
  /** Reports one page's true (rotated) point size after its first render. */
  reportPageDim: (index0: number, w: number, h: number) => void

  /* ── File I/O ─────────────────────────────────────────────────────────── */
  /** Open from a File (manual picker / drag-drop) — no OS home, so no write-back. */
  openFile: (file: File) => Promise<void>
  /**
   * Open from raw bytes. `target` is the OS `{root, path}` a write-back Save
   * lands on; omit it (the drag-drop / File path) to open without a save home.
   */
  openBytes: (bytes: Uint8Array, name: string, target?: SaveTarget | null) => Promise<void>
  /**
   * Export the current (possibly edited) document as a downloaded copy. The
   * SECONDARY action — the primary Save writes back to {@link saveTarget} (see
   * the editor controller's `saveToDisk`).
   */
  exportCopy: () => Promise<void>
  /** The OS file a write-back Save lands on, or null for a dragged-in document. */
  saveTarget: SaveTarget | null
  /** True when the document has edits not yet written to {@link saveTarget}. */
  dirty: boolean
  /** Mark the document changed since its last save (arms the unsaved-close guard). */
  markDirty: () => void
  /** Mark the document saved (clears dirty). */
  markSaved: () => void
  loading: boolean
  error: string | null

  /* ── Navigation & zoom ────────────────────────────────────────────────── */
  currentPage: number
  setCurrentPage: (page: number) => void
  /** Scroll the reader to a 1-based page. `pending` requests survive a not-yet-mounted reader. */
  goToPage: (page: number) => void
  /** A one-shot scroll request the Reader consumes (page + nonce to retrigger). */
  scrollRequest: { page: number; nonce: number } | null
  scale: number
  fitMode: FitMode
  setFitMode: (mode: FitMode) => void
  zoomIn: () => void
  zoomOut: () => void
  setScale: (scale: number, mode?: FitMode) => void
  /** Reader reports its computed scale back when a fit-mode is active. */
  reportFitScale: (scale: number) => void

  /* ── Panels & mode ────────────────────────────────────────────────────── */
  panelOpen: boolean
  togglePanel: () => void
  panelTab: PanelTab
  setPanelTab: (tab: PanelTab) => void
  mode: ViewMode
  setMode: (mode: ViewMode) => void

  /* ── Search ───────────────────────────────────────────────────────────── */
  search: SearchState
  runSearch: (query: string) => Promise<void>
  clearSearch: () => void
  gotoHit: (index: number) => void
  nextHit: () => void
  prevHit: () => void

  /* ── Re-sync after an edit (Part B) ───────────────────────────────────── */
  /**
   * Bump the render epoch so every rendered page + text layer rebuilds. Cheap;
   * use after an in-place annotation edit whose result is already reflected by
   * the engine's read caches.
   */
  bumpRenderEpoch: () => void
  renderEpoch: number
  /**
   * Full re-sync after a mutating edit + `doc.save()`: re-reads pageCount,
   * page sizes, metadata and outline, then bumps the render epoch. Part B calls
   * this after page reorder/delete/insert or form-flatten.
   */
  reloadDocument: () => Promise<void>
}
