/**
 * The reader controller hook — owns all shell state and exposes the actions the
 * shell and Part B drive. One instance lives at the NorPdf root and is shared
 * via {@link ReaderContext}.
 *
 * Design notes for Part B:
 *  • The loaded document is a single `PdfDoc` (`doc`). It is mutated in place by
 *    the editor capabilities (`doc.annotate`, `doc.forms`, `doc.pages`, …). The
 *    engine's read caches (render/text/outline) re-parse after `doc.save()`.
 *  • After an in-place annotation edit, call `bumpRenderEpoch()` to re-render.
 *  • After a structural edit + `await doc.save()`, call `reloadDocument()`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PdfDoc } from '@pdfcore/engine'
import type { DocumentMetadata, OutlineNode } from '@pdfcore/engine'
import { useUnsavedGuard } from '@imbatranim/core'
import type {
  FitMode,
  PageDim,
  PanelTab,
  ReaderController,
  SaveTarget,
  SearchState,
  ViewMode,
} from './types'

/** Points → CSS px factor at 100% ("actual size", 72pt/in vs 96px/in). */
const ACTUAL = 96 / 72
const ZOOM_STEP = 1.2
const MIN_SCALE = 0.25
const MAX_SCALE = 8

const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

const EMPTY_SEARCH: SearchState = {
  query: '',
  hits: [],
  activeIndex: -1,
  busy: false,
  ran: false,
}

export function useReaderController(windowId: string): ReaderController {
  const [doc, setDoc] = useState<PdfDoc | null>(null)
  const [docName, setDocName] = useState('')
  const [saveTarget, setSaveTarget] = useState<SaveTarget | null>(null)
  const [dirty, setDirty] = useState(false)
  const [pageCount, setPageCount] = useState(0)
  const [metadata, setMetadata] = useState<DocumentMetadata | null>(null)
  const [outline, setOutline] = useState<OutlineNode[]>([])
  const [pageDims, setPageDims] = useState<PageDim[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [currentPage, setCurrentPage] = useState(1)
  const [scrollRequest, setScrollRequest] = useState<{
    page: number
    nonce: number
  } | null>(null)
  const [scale, setScaleState] = useState(ACTUAL)
  const [fitMode, setFitModeState] = useState<FitMode>('width')

  const [panelOpen, setPanelOpen] = useState(true)
  const [panelTab, setPanelTab] = useState<PanelTab>('thumbnails')
  const [mode, setMode] = useState<ViewMode>('read')

  const [search, setSearch] = useState<SearchState>(EMPTY_SEARCH)
  const [renderEpoch, setRenderEpoch] = useState(0)

  // A monotonic open id, so a slow earlier open cannot clobber a newer one. Each
  // `openBytes` claims the next id and only adopts / reports failure if it is
  // still the latest when its `PdfDoc.load` resolves (L2).
  const openIdRef = useRef(0)

  // Latest search state, read outside the `setSearch` updater in
  // `reloadDocument` — running a search inside an updater double-fires under
  // StrictMode (L7).
  const searchRef = useRef(search)
  useEffect(() => {
    searchRef.current = search
  }, [search])

  const markDirty = useCallback(() => setDirty(true), [])
  const markSaved = useCallback(() => setDirty(false), [])

  // Reflect the filename + a dirty marker in the window title and warn before
  // closing with unsaved edits — the save spine every other editor uses.
  useUnsavedGuard(windowId, dirty, docName)

  /* ── Load a document from an engine PdfDoc ─────────────────────────────── */
  const adopt = useCallback((loaded: PdfDoc, name: string, target: SaveTarget | null) => {
    setDoc(loaded)
    setDocName(name)
    setSaveTarget(target)
    setDirty(false)
    const count = loaded.pageCount()
    setPageCount(count)
    setMetadata(loaded.metadata())
    const dims: PageDim[] = loaded
      .pageSizes()
      .map((s) => ({ w: s.width, h: s.height, measured: false }))
    setPageDims(dims)
    setCurrentPage(1)
    setSearch(EMPTY_SEARCH)
    setMode('read')
    setRenderEpoch((e) => e + 1)
    setScrollRequest({ page: 1, nonce: Date.now() })
    // Outline is async; fetch it in the background.
    void loaded.outline
      .tree()
      .then((tree) => setOutline(tree))
      .catch(() => setOutline([]))
  }, [])

  const openBytes = useCallback(
    async (bytes: Uint8Array, name: string, target: SaveTarget | null = null) => {
      const openId = ++openIdRef.current
      setLoading(true)
      setError(null)
      try {
        const loaded = await PdfDoc.load(bytes)
        // A newer open started while this one was loading — drop this result so
        // the slower, older document can't replace the newer one.
        if (openId !== openIdRef.current) return
        adopt(loaded, name, target)
      } catch (err) {
        if (openId !== openIdRef.current) return
        setDoc(null)
        setPageCount(0)
        setSaveTarget(null)
        setError(`Could not open “${name}”: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        if (openId === openIdRef.current) setLoading(false)
      }
    },
    [adopt]
  )

  const openFile = useCallback(
    async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer())
      await openBytes(bytes, file.name)
    },
    [openBytes]
  )

  const exportCopy = useCallback(async () => {
    if (!doc) return
    try {
      const bytes = await doc.save()
      // Copy into a fresh, exactly-sized ArrayBuffer for the Blob.
      const buf = bytes.slice().buffer
      const blob = new Blob([buf], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const base = docName.replace(/\.pdf$/i, '') || 'document'
      a.download = `${base}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoke on the next tick so the download has a chance to start.
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch (err) {
      setError(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [doc, docName])

  const reportPageDim = useCallback((index0: number, w: number, h: number) => {
    setPageDims((prev) => {
      const cur = prev[index0]
      if (cur && cur.measured && Math.abs(cur.w - w) < 0.5 && Math.abs(cur.h - h) < 0.5) {
        return prev // no meaningful change — avoid a reflow loop
      }
      const next = prev.slice()
      next[index0] = { w, h, measured: true }
      return next
    })
  }, [])

  /* ── Navigation ────────────────────────────────────────────────────────── */
  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.min(Math.max(1, page), Math.max(1, pageCount))
      setScrollRequest({ page: clamped, nonce: Date.now() })
    },
    [pageCount]
  )

  /* ── Zoom / fit ────────────────────────────────────────────────────────── */
  const setScale = useCallback((next: number, nextMode: FitMode = 'custom') => {
    setScaleState(clampScale(next))
    setFitModeState(nextMode)
  }, [])

  const setFitMode = useCallback((m: FitMode) => {
    setFitModeState(m)
    if (m === 'actual') setScaleState(ACTUAL)
  }, [])

  const zoomIn = useCallback(() => {
    setScaleState((s) => clampScale(s * ZOOM_STEP))
    setFitModeState('custom')
  }, [])

  const zoomOut = useCallback(() => {
    setScaleState((s) => clampScale(s / ZOOM_STEP))
    setFitModeState('custom')
  }, [])

  // The Reader computes the actual scale for width/page fits and reports it so
  // the zoom indicator stays truthful without the controller knowing viewport
  // dimensions.
  const reportFitScale = useCallback((next: number) => {
    setScaleState((prev) => (Math.abs(prev - next) < 0.001 ? prev : clampScale(next)))
  }, [])

  /* ── Panels ────────────────────────────────────────────────────────────── */
  const togglePanel = useCallback(() => setPanelOpen((o) => !o), [])

  /* ── Search ────────────────────────────────────────────────────────────── */
  const runSearch = useCallback(
    async (query: string) => {
      const q = query.trim()
      if (!doc || !q) {
        setSearch({ ...EMPTY_SEARCH, query })
        return
      }
      setSearch((s) => ({ ...s, query, busy: true }))
      try {
        const hits = await doc.text.search(q, {})
        setSearch({
          query,
          hits,
          activeIndex: hits.length ? 0 : -1,
          busy: false,
          ran: true,
        })
        if (hits[0]) setScrollRequest({ page: hits[0].page, nonce: Date.now() })
      } catch (err) {
        setError(`Search failed: ${err instanceof Error ? err.message : String(err)}`)
        setSearch({ query, hits: [], activeIndex: -1, busy: false, ran: true })
      }
    },
    [doc]
  )

  const clearSearch = useCallback(() => setSearch(EMPTY_SEARCH), [])

  const gotoHit = useCallback((index: number) => {
    setSearch((s) => {
      if (!s.hits.length) return s
      const wrapped = ((index % s.hits.length) + s.hits.length) % s.hits.length
      const hit = s.hits[wrapped]
      if (hit) setScrollRequest({ page: hit.page, nonce: Date.now() })
      return { ...s, activeIndex: wrapped }
    })
  }, [])

  const nextHit = useCallback(() => {
    setSearch((s) => {
      if (!s.hits.length) return s
      const wrapped = (s.activeIndex + 1 + s.hits.length) % s.hits.length
      const hit = s.hits[wrapped]
      if (hit) setScrollRequest({ page: hit.page, nonce: Date.now() })
      return { ...s, activeIndex: wrapped }
    })
  }, [])

  const prevHit = useCallback(() => {
    setSearch((s) => {
      if (!s.hits.length) return s
      const wrapped = (s.activeIndex - 1 + s.hits.length) % s.hits.length
      const hit = s.hits[wrapped]
      if (hit) setScrollRequest({ page: hit.page, nonce: Date.now() })
      return { ...s, activeIndex: wrapped }
    })
  }, [])

  /* ── Re-sync after edits (Part B) ──────────────────────────────────────── */
  const bumpRenderEpoch = useCallback(() => setRenderEpoch((e) => e + 1), [])

  const reloadDocument = useCallback(async () => {
    if (!doc) return
    const count = doc.pageCount()
    setPageCount(count)
    setMetadata(doc.metadata())
    setPageDims(doc.pageSizes().map((s) => ({ w: s.width, h: s.height, measured: false })))
    setCurrentPage((p) => Math.min(p, Math.max(1, count)))
    try {
      setOutline(await doc.outline.tree())
    } catch {
      setOutline([])
    }
    // Re-run any active search against the new bytes. Read the latest search
    // from a ref and act on it OUTSIDE any `setSearch` updater — kicking off a
    // search inside an updater double-fires under StrictMode (L7).
    const current = searchRef.current
    if (current.ran && current.query.trim()) void runSearch(current.query)
    setRenderEpoch((e) => e + 1)
  }, [doc, runSearch])

  return useMemo<ReaderController>(
    () => ({
      windowId,
      doc,
      docName,
      pageCount,
      metadata,
      outline,
      pageDims,
      reportPageDim,
      openFile,
      openBytes,
      exportCopy,
      saveTarget,
      dirty,
      markDirty,
      markSaved,
      loading,
      error,
      currentPage,
      setCurrentPage,
      goToPage,
      scrollRequest,
      scale,
      fitMode,
      setFitMode,
      zoomIn,
      zoomOut,
      setScale,
      reportFitScale,
      panelOpen,
      togglePanel,
      panelTab,
      setPanelTab,
      mode,
      setMode,
      search,
      runSearch,
      clearSearch,
      gotoHit,
      nextHit,
      prevHit,
      bumpRenderEpoch,
      renderEpoch,
      reloadDocument,
    }),
    [
      windowId,
      doc,
      docName,
      pageCount,
      metadata,
      outline,
      pageDims,
      reportPageDim,
      openFile,
      openBytes,
      exportCopy,
      saveTarget,
      dirty,
      markDirty,
      markSaved,
      loading,
      error,
      currentPage,
      goToPage,
      scrollRequest,
      scale,
      fitMode,
      setFitMode,
      zoomIn,
      zoomOut,
      setScale,
      reportFitScale,
      panelOpen,
      togglePanel,
      panelTab,
      mode,
      search,
      runSearch,
      clearSearch,
      gotoHit,
      nextHit,
      prevHit,
      bumpRenderEpoch,
      renderEpoch,
      reloadDocument,
    ]
  )
}
