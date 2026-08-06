/**
 * The continuous-scroll reader: a virtualised vertical stack of pages. Only
 * pages within one screen of the viewport are mounted (and therefore
 * rasterised), so opening a 500-page PDF stays cheap. Owns:
 *  • layout — cumulative page offsets from measured/estimated point sizes × scale
 *  • fit-to-width / fit-to-page scale computation (reported to the controller)
 *  • current-page tracking from scroll position
 *  • scroll-to-page (nav, outline, thumbnails, search) via the controller's
 *    one-shot scrollRequest
 *  • keyboard navigation (arrows / PageUp-Down / Space / Home / End / +/-/0)
 *
 * A native `overflow-auto` element (not the OS ScrollArea) backs the scroll —
 * the virtual window reads `scrollTop`/`clientHeight` off this node directly.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { Rect, TextHit } from '@pdfcore/engine'
import { useTopWindowKeydown } from '@imbatranim/ui'
import { useReader } from '../app/context'
import { PageView } from './PageView'

const GAP = 24 // px between pages
const PAD_Y = 32
const PAD_X = 32
const CURRENT_LINE = 0.38 // fraction of viewport height marking "current page"

export function Reader(): JSX.Element {
  const {
    doc,
    pageCount,
    pageDims,
    scale,
    fitMode,
    reportFitScale,
    reportPageDim,
    renderEpoch,
    scrollRequest,
    currentPage,
    setCurrentPage,
    zoomIn,
    zoomOut,
    setFitMode,
    search,
  } = useReader()

  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ w: 0, h: 0 })
  const [scrollTop, setScrollTop] = useState(0)

  /* ── Track the scroll container's size ─────────────────────────────────── */
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setViewport({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* ── Compute fit scale for width/page modes → report to controller ─────── */
  const maxPageW = useMemo(() => pageDims.reduce((m, d) => Math.max(m, d.w), 1), [pageDims])
  useEffect(() => {
    if (!viewport.w) return
    const availW = viewport.w - PAD_X * 2
    if (fitMode === 'width') {
      reportFitScale(availW / maxPageW)
    } else if (fitMode === 'page') {
      const cur = pageDims[currentPage - 1]
      if (cur) {
        const availH = viewport.h - PAD_Y * 2
        reportFitScale(Math.min(availW / cur.w, availH / cur.h))
      }
    }
  }, [fitMode, viewport.w, viewport.h, maxPageW, pageDims, currentPage, reportFitScale])

  /* ── Layout: page boxes + cumulative offsets ───────────────────────────── */
  const layout = useMemo(() => {
    const tops: number[] = []
    const sizes: Array<{ w: number; h: number }> = []
    let y = PAD_Y
    for (let i = 0; i < pageCount; i++) {
      const d = pageDims[i] ?? { w: 612, h: 792, measured: false }
      const w = d.w * scale
      const h = d.h * scale
      tops.push(y)
      sizes.push({ w, h })
      y += h + GAP
    }
    const total = pageCount ? y - GAP + PAD_Y : 0
    return { tops, sizes, total }
  }, [pageCount, pageDims, scale])

  const contentWidth = useMemo(
    () => layout.sizes.reduce((m, s) => Math.max(m, s.w), 0) + PAD_X * 2,
    [layout]
  )

  /* ── Scroll handling: current page + repaint on scroll ─────────────────── */
  const raf = useRef(0)
  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    if (raf.current) return
    raf.current = requestAnimationFrame(() => {
      raf.current = 0
      setScrollTop(el.scrollTop)
      // current page = the one crossing the "current line"
      const probe = el.scrollTop + el.clientHeight * CURRENT_LINE
      let page = 1
      for (let i = 0; i < layout.tops.length; i++) {
        const top = layout.tops[i] ?? 0
        if (top <= probe) page = i + 1
        else break
      }
      if (page !== currentPage) setCurrentPage(page)
    })
  }, [layout, currentPage, setCurrentPage])

  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current)
    },
    []
  )

  /* ── Scroll to a requested page ────────────────────────────────────────── */
  useEffect(() => {
    if (!scrollRequest) return
    const el = scrollRef.current
    if (!el) return
    const top = layout.tops[scrollRequest.page - 1]
    if (top == null) return
    el.scrollTo({ top: Math.max(0, top - PAD_Y + 2), behavior: 'auto' })
    // reflect immediately
    setScrollTop(el.scrollTop)
  }, [scrollRequest, layout])

  /* ── Keyboard navigation ───────────────────────────────────────────────── */
  // Transport keys (arrows / PageUp-Down / Space / Home / End / +/-/0) via the
  // SDK seam: they fire ONLY while this is the top-most window and never while
  // the user is typing (the default `ignoreTextEntry`), so a background reader
  // no longer scrolls and Space no longer steals from another app's text field.
  useTopWindowKeydown((e) => {
    const el = scrollRef.current
    if (!el) return
    const page = el.clientHeight * 0.92
    switch (e.key) {
      case 'ArrowDown':
        el.scrollBy({ top: 90 })
        e.preventDefault()
        break
      case 'ArrowUp':
        el.scrollBy({ top: -90 })
        e.preventDefault()
        break
      case 'PageDown':
        el.scrollBy({ top: page })
        e.preventDefault()
        break
      case 'PageUp':
        el.scrollBy({ top: -page })
        e.preventDefault()
        break
      case ' ':
        el.scrollBy({ top: e.shiftKey ? -page : page })
        e.preventDefault()
        break
      case 'Home':
        el.scrollTo({ top: 0 })
        e.preventDefault()
        break
      case 'End':
        el.scrollTo({ top: el.scrollHeight })
        e.preventDefault()
        break
      case '+':
      case '=':
        zoomIn()
        e.preventDefault()
        break
      case '-':
        zoomOut()
        e.preventDefault()
        break
      case '0':
        setFitMode('actual')
        e.preventDefault()
        break
      default:
    }
  })

  /* ── Search hit indexing per page ──────────────────────────────────────── */
  const hitsByPage = useMemo(() => {
    const map = new Map<number, TextHit[]>()
    for (const h of search.hits) {
      const arr = map.get(h.page)
      if (arr) arr.push(h)
      else map.set(h.page, [h])
    }
    return map
  }, [search.hits])

  const activeHit = search.activeIndex >= 0 ? search.hits[search.activeIndex] : undefined

  /* ── Which pages to mount (virtual window) ─────────────────────────────── */
  const overscan = viewport.h || 800
  const windowTop = scrollTop - overscan
  const windowBottom = scrollTop + (viewport.h || 800) + overscan

  const pages: JSX.Element[] = []
  if (doc) {
    for (let i = 0; i < pageCount; i++) {
      const top = layout.tops[i] ?? 0
      const size = layout.sizes[i] ?? { w: 0, h: 0 }
      if (top + size.h < windowTop || top > windowBottom) continue
      const pageNo = i + 1
      const pageHits = hitsByPage.get(pageNo) ?? []
      const activeRects: Rect[] | null =
        activeHit && activeHit.page === pageNo ? activeHit.rects : null
      pages.push(
        <div
          key={`${pageNo}-${renderEpoch}`}
          className="absolute top-0 left-1/2 will-change-transform"
          style={{ transform: `translate(-50%, ${top}px)`, width: size.w }}
        >
          <PageView
            doc={doc}
            pageNumber={pageNo}
            width={size.w}
            height={size.h}
            scale={scale}
            renderEpoch={renderEpoch}
            hits={pageHits}
            activeRects={activeRects}
            onMeasured={reportPageDim}
          />
        </div>
      )
    }
  }

  return (
    <div
      ref={scrollRef}
      className="bg-surface-container relative min-w-0 flex-1 overflow-auto"
      onScroll={onScroll}
      tabIndex={0}
      role="region"
      aria-label="Document pages"
    >
      <div
        className="relative mx-auto"
        style={{
          height: layout.total,
          width: Math.max(contentWidth, viewport.w),
        }}
      >
        {pages}
      </div>
    </div>
  )
}
