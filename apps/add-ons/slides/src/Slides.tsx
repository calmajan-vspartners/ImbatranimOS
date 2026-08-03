import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Image as ImageIcon,
  Info,
  Loader2,
  Maximize2,
  Minus,
  NotebookText,
  PanelLeft,
  Plus,
  Presentation,
} from 'lucide-react'
import {
  Button,
  Tooltip,
  cn,
  downloadUrl,
  fetchFileBytes,
  fileName,
  notify,
  reportFileFailure,
  uploadFileBytes,
  useFileDialog,
  useOpenIntent,
} from '@imbatranim/core'
import { renderPptx } from './engine/pptx'
import { extractNotes } from './engine/notes'
import { ThumbnailRail } from './components/ThumbnailRail'
import { DEFAULT_ZOOM, resolveScale, stepZoom, zoomLabel, type Zoom } from './lib/zoom'

// 16:9 slide, sized to the available width. pptx-preview scales its content to
// this box; the host div scrolls when the stack of slides overflows.
const SLIDE_ASPECT = 9 / 16
const SLIDE_GUTTER = 32

export function Slides({ windowId }: { windowId: string }) {
  // One-shot open intent, drained by the shared hook (StrictMode-safe).
  const source = useOpenIntent(windowId)

  // Lets the app open a file on its own instead of dead-ending on
  // "open one from Files". The pick latches into the same store
  // useOpenIntent reads, so the existing load path runs unchanged.
  const { openFile, saveFile, fileDialog } = useFileDialog(windowId)
  const pickFile = () => void openFile({ extensions: ['pptx'] })
  // Starts true: the render effect runs as soon as a source is latched and only
  // flips these in async paths (avoids synchronous setState-in-effect).
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  // The rendered slide elements live in a ref, not in state: they are live DOM
  // owned by the renderer, and presenting moves one of them between parents.
  // Held as state, that mutation is a render-time write to state — which the
  // react-hooks rules correctly refuse, and which would be a real hazard the
  // first time something memoised on the array.
  const slidesRef = useRef<HTMLElement[]>([])
  const [slideCount, setSlideCount] = useState(0)
  const [current, setCurrent] = useState(0)
  const [zoom, setZoom] = useState<Zoom>(DEFAULT_ZOOM)
  const [showRail, setShowRail] = useState(true)
  const [showNotes, setShowNotes] = useState(false)
  const [presenting, setPresenting] = useState(false)
  const [exporting, setExporting] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const presentRef = useRef<HTMLDivElement>(null)

  const docName = source ? fileName(source.path, 'presentation.pptx') : ''
  const currentNote = notes[current] ?? ''
  const hasAnyNote = notes.some((n) => n.trim() !== '')

  // Fetch + render once a source is latched. Keyed on [source] only (like the
  // PDF viewer): StrictMode's mount→cleanup→mount cancels the first pass and the
  // second renders cleanly. Width is measured synchronously from the live scroll
  // viewport at render time, so we render at the current width without re-parsing
  // on later resizes (a ResizeObserver dep would re-run and re-parse the deck).
  useEffect(() => {
    if (!source) return
    const stage = stageRef.current
    const scroll = scrollRef.current
    if (!stage || !scroll) return

    let cancelled = false
    // Each render owns a FRESH detached node and only commits it into the shared
    // stage if it is still the current render when it resolves. A slower, stale
    // render (e.g. open deck A then deck B in the same window) writes into its
    // own discarded node and can never clobber or interleave the newer deck.
    const renderTarget = document.createElement('div')
    ;(async () => {
      try {
        const bytes = await fetchFileBytes(source.root, source.path)
        if (cancelled) return
        // Notes are read BEFORE the render, not after: pptx-preview consumes the
        // buffer (a post-render parse came back empty every time, because there
        // was nothing left to unzip). Cheap enough — a few milliseconds — and it
        // cannot fail loudly, since extractNotes returns [] on anything it cannot
        // read rather than throwing.
        const parsedNotes = await extractNotes(bytes)
        if (cancelled) return
        const width = Math.max(320, scroll.clientWidth - SLIDE_GUTTER)
        const height = Math.round(width * SLIDE_ASPECT)
        const deck = await renderPptx(renderTarget, bytes, { width, height })
        if (cancelled) return
        // pptx-preview resolves even when it can't reconstruct a deck (it leaves
        // an empty container). Detect a no-op render — the node holds only the
        // renderer's empty wrapper, no slide elements — and fall back to the
        // Download hint rather than a blank window. (Element counts are used, not
        // innerText: the stage is display:none while loading, so text isn't
        // measurable yet, but the DOM is.)
        const renderedAnything = renderTarget.querySelector('svg, img, p, span, table, li') !== null
        // Commit: this render is current, so it owns the stage now.
        stage.replaceChildren(renderTarget)
        slidesRef.current = deck.slides
        setSlideCount(deck.slides.length)
        setCurrent(0)
        if (!renderedAnything) {
          const message =
            'This presentation could not be previewed. Download it to open in PowerPoint.'
          setError(message)
          // Sticky, because a deck that came up blank in a background window is
          // otherwise indistinguishable from one nobody has looked at yet.
          notify({
            level: 'warning',
            appId: 'slides',
            title: 'Could not preview this presentation',
            body: `${docName} — ${message}`,
          })
        } else {
          setNotes(parsedNotes)
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            reportFileFailure('open', err, {
              appId: 'slides',
              noun: 'presentation',
              name: docName,
            })
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [source, docName])

  // ── Navigation ──────────────────────────────────────────────────────────────

  const goTo = useCallback(
    (index: number) => {
      const clamped = Math.min(Math.max(index, 0), Math.max(slideCount - 1, 0))
      setCurrent(clamped)
      // In the scrolling view, "go to" means bring it into view; while presenting
      // the slide is in the fullscreen host, where there is nothing to scroll.
      slidesRef.current[clamped]?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    },
    [slideCount]
  )

  // Stable identity, so the rail's clone effect re-runs when a new deck arrives
  // and not on every navigation.
  const getSlide = useCallback(
    (index: number): HTMLElement | undefined => slidesRef.current[index],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slideCount]
  )

  const next = useCallback(() => goTo(current + 1), [goTo, current])
  const prev = useCallback(() => goTo(current - 1), [goTo, current])

  // Keyboard navigation, scoped so it cannot fire while another window is on top
  // or while the user is typing somewhere. Bound directly rather than through the
  // shortcut registry: these only exist while a deck is open, and a row that
  // appears and vanishes with a window is worse than no row.
  useEffect(() => {
    if (!source || slideCount === 0) return
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable === true)
      ) {
        return
      }
      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          e.preventDefault()
          next()
          break
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault()
          prev()
          break
        case 'Home':
          e.preventDefault()
          goTo(0)
          break
        case 'End':
          e.preventDefault()
          goTo(slideCount - 1)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [source, slideCount, next, prev, goTo])

  // ── Presenter mode ──────────────────────────────────────────────────────────

  const enterPresent = useCallback(() => {
    const el = presentRef.current
    if (!el) return
    setPresenting(true)
    // requestFullscreen can reject (no user gesture, or a policy that forbids
    // it). Presenting in-window is still better than doing nothing, so the state
    // flips either way and the catch only stops an unhandled rejection.
    void el.requestFullscreen?.().catch(() => undefined)
  }, [])

  const exitPresent = useCallback(() => {
    setPresenting(false)
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined)
  }, [])

  // The browser owns fullscreen exit (Escape, F11, the OS), so follow it — or the
  // app carries on pretending to present after the user has left.
  useEffect(() => {
    function onChange() {
      if (!document.fullscreenElement) setPresenting(false)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Escape has to work even when fullscreen never happened. `requestFullscreen`
  // can be refused — by a permissions policy, or an embedding context — and this
  // presents in-window instead, which is better than doing nothing. But then no
  // `fullscreenchange` ever fires, so without this the user is trapped in a black
  // overlay with no way back. Found in a browser that refused the request.
  useEffect(() => {
    if (!presenting) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        exitPresent()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [presenting, exitPresent])

  // While presenting, the current slide is moved into the fullscreen host and put
  // back on exit. Moving rather than cloning keeps it the same element the rail
  // and the export path already point at.
  useEffect(() => {
    const host = presentRef.current
    const slide = slidesRef.current[current]
    if (!presenting || !host || !slide) return
    const parent = slide.parentElement
    const nextSibling = slide.nextSibling
    const previous = {
      transform: slide.style.transform,
      transformOrigin: slide.style.transformOrigin,
    }
    host.appendChild(slide)
    const fit = Math.min(
      host.clientWidth / (slide.offsetWidth || 1),
      host.clientHeight / (slide.offsetHeight || 1)
    )
    if (Number.isFinite(fit) && fit > 0) {
      slide.style.transform = `scale(${fit})`
      slide.style.transformOrigin = 'center center'
    }
    return () => {
      slide.style.transform = previous.transform
      slide.style.transformOrigin = previous.transformOrigin
      if (parent) parent.insertBefore(slide, nextSibling)
    }
  }, [presenting, slideCount, current])

  // ── Zoom ────────────────────────────────────────────────────────────────────

  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box) setViewport({ width: box.width, height: box.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // The rendered slide's own pixel box, measured once per deck. A measurement of
  // live DOM belongs in an effect, not in a render-time memo — and the elements'
  // size does not change afterwards, because zoom is a transform rather than a
  // re-render.
  const [slideBox, setSlideBox] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const first = slidesRef.current[0]
    if (!first) return
    const box = { width: first.offsetWidth, height: first.offsetHeight }
    setSlideBox((prev) => (prev.width === box.width && prev.height === box.height ? prev : box))
  }, [slideCount])

  const scale = resolveScale(zoom, slideBox, {
    width: Math.max(0, viewport.width - SLIDE_GUTTER),
    height: Math.max(0, viewport.height - SLIDE_GUTTER),
  })

  // ── Export the current slide as a PNG ───────────────────────────────────────

  const exportSlide = useCallback(async () => {
    const slide = slidesRef.current[current]
    if (!slide || exporting) return
    const suggested = `${docName.replace(/\.pptx$/i, '')}-slide-${current + 1}.png`
    const choice = await saveFile({
      title: 'Export slide as PNG',
      suggestedName: suggested,
      extensions: ['png'],
    })
    if (!choice) return
    setExporting(true)
    try {
      // `html-to-image` is already in the tree for the Snipping Tool, so this
      // costs no new dependency — and it is dynamically imported so it stays out
      // of this app's entry chunk.
      const { toBlob } = await import('html-to-image')
      const blob = await toBlob(slide, {
        pixelRatio: window.devicePixelRatio || 1,
        backgroundColor: '#ffffff',
      })
      if (!blob) throw new Error('The slide could not be rasterized.')
      const name = fileName(choice.path, suggested)
      await uploadFileBytes(choice.root, choice.path, await blob.arrayBuffer(), name)
      notify({
        level: 'success',
        appId: 'slides',
        title: 'Slide exported',
        body: `${name} — saved to /${choice.path.split('/').slice(0, -1).join('/') || 'home'}`,
      })
    } catch (err) {
      setError(
        reportFileFailure('save', err, { appId: 'slides', noun: 'slide image', name: docName })
      )
    } finally {
      setExporting(false)
    }
  }, [current, exporting, docName, saveFile])

  function triggerDownload() {
    if (!source) return
    const url = downloadUrl(source.root, source.path)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName(source.path, 'presentation.pptx')
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  if (!source) {
    return (
      <div className="bg-surface-container-lowest text-on-surface-variant flex h-full flex-col items-center justify-center gap-2 text-center">
        <Presentation size={40} strokeWidth={1} />
        <span className="font-ui text-[12px]">Nothing open</span>
        <Button size="sm" variant="primary" onClick={pickFile}>
          Open a presentation
        </Button>
        {fileDialog}
      </div>
    )
  }

  const canNavigate = slideCount > 1

  return (
    <div className="bg-surface-container-lowest flex h-full flex-col">
      {/* Toolbar */}
      <div className="border-outline-variant bg-surface-container-low flex items-center gap-1 border-b px-2 py-1">
        <Tooltip content="Slide thumbnails">
          <Button
            variant={showRail ? 'primary' : 'ghost'}
            size="sm"
            className="h-6 w-6 p-0"
            aria-label="Toggle slide thumbnails"
            aria-pressed={showRail}
            onClick={() => setShowRail((v) => !v)}
          >
            <PanelLeft size={12} />
          </Button>
        </Tooltip>

        <div className="border-outline-variant mx-1 h-4 border-l" />

        <Tooltip content="Previous slide (←)">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            aria-label="Previous slide"
            disabled={!canNavigate || current === 0}
            onClick={prev}
          >
            <ChevronLeft size={13} />
          </Button>
        </Tooltip>
        <span className="font-ui text-on-surface-variant min-w-[52px] text-center text-[11px] tabular-nums">
          {slideCount === 0 ? '—' : `${current + 1} / ${slideCount}`}
        </span>
        <Tooltip content="Next slide (→)">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            aria-label="Next slide"
            disabled={!canNavigate || current >= slideCount - 1}
            onClick={next}
          >
            <ChevronRight size={13} />
          </Button>
        </Tooltip>

        <div className="border-outline-variant mx-1 h-4 border-l" />

        <Tooltip content="Zoom out">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            aria-label="Zoom out"
            onClick={() => setZoom(stepZoom(scale, -1))}
          >
            <Minus size={12} />
          </Button>
        </Tooltip>
        <button
          type="button"
          onClick={() =>
            setZoom((z) => ({
              mode: z.mode === 'fit-width' ? 'fit-page' : 'fit-width',
              scale: 1,
            }))
          }
          className="font-ui text-on-surface-variant hover:text-on-surface min-w-[62px] text-center text-[11px] tabular-nums"
          title="Switch between fit width and fit page"
        >
          {zoomLabel(zoom, scale)}
        </button>
        <Tooltip content="Zoom in">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            aria-label="Zoom in"
            onClick={() => setZoom(stepZoom(scale, 1))}
          >
            <Plus size={12} />
          </Button>
        </Tooltip>

        <div className="border-outline-variant mx-1 h-4 border-l" />

        <Tooltip content={hasAnyNote ? 'Speaker notes' : 'This deck has no speaker notes'}>
          <Button
            variant={showNotes ? 'primary' : 'ghost'}
            size="sm"
            className="h-6 w-6 p-0"
            aria-label="Toggle speaker notes"
            aria-pressed={showNotes}
            disabled={!hasAnyNote}
            onClick={() => setShowNotes((v) => !v)}
          >
            <NotebookText size={12} />
          </Button>
        </Tooltip>
        <Tooltip content="Present (Escape to exit)">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            aria-label="Present"
            disabled={slideCount === 0}
            onClick={enterPresent}
          >
            <Maximize2 size={12} />
          </Button>
        </Tooltip>
        <Tooltip content="Export this slide as a PNG">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            aria-label="Export slide as PNG"
            disabled={slideCount === 0 || exporting}
            onClick={() => void exportSlide()}
          >
            {exporting ? <Loader2 size={12} className="animate-spin" /> : <ImageIcon size={12} />}
          </Button>
        </Tooltip>

        <div className="flex-1" />

        <Tooltip content="Best-effort preview — layout may differ from PowerPoint">
          <Info size={12} className="text-on-surface-variant shrink-0" />
        </Tooltip>
        <span className="font-ui text-on-surface-variant max-w-[160px] truncate text-[11px]">
          {docName}
        </span>
        <Tooltip content="Download original">
          <Button
            variant="default"
            size="sm"
            className="flex items-center gap-1"
            onClick={triggerDownload}
          >
            <Download size={12} />
            Download
          </Button>
        </Tooltip>
      </div>

      <div className="flex min-h-0 flex-1">
        {showRail && slideCount > 0 && !loading && (
          <ThumbnailRail count={slideCount} getSlide={getSlide} current={current} onSelect={goTo} />
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Slide stage */}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
            {loading && (
              <div className="text-on-surface-variant font-ui flex h-full items-center justify-center gap-2 text-[12px]">
                <Loader2 size={16} className="animate-spin" />
                Rendering slides…
              </div>
            )}
            {error && !loading && (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <Presentation size={40} strokeWidth={1} className="text-on-surface-variant" />
                <span className="text-error font-ui text-[12px]">{error}</span>
                <Button
                  variant="primary"
                  size="sm"
                  className="flex items-center gap-1"
                  onClick={triggerDownload}
                >
                  <Download size={12} />
                  Download
                </Button>
              </div>
            )}
            <div
              ref={stageRef}
              style={
                scale === 1
                  ? undefined
                  : { transform: `scale(${scale})`, transformOrigin: 'top center' }
              }
              className={loading || error ? 'hidden' : 'flex flex-col items-center gap-4 p-4'}
            />
          </div>

          {showNotes && hasAnyNote && (
            <div className="border-outline-variant bg-surface-container-low h-[28%] min-h-[80px] shrink-0 overflow-auto border-t px-3 py-2">
              <div className="font-ui text-on-surface-variant mb-1 text-[10px] font-semibold tracking-wider uppercase">
                Notes — slide {current + 1}
              </div>
              <p className="font-content text-on-surface text-[12px] whitespace-pre-wrap">
                {currentNote.trim() === '' ? 'No notes on this slide.' : currentNote}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Presenter surface. Always mounted so `requestFullscreen` has a stable
          element; only visible while presenting. */}
      <div
        ref={presentRef}
        className={cn(
          'items-center justify-center bg-black',
          presenting ? 'fixed inset-0 z-[100] flex' : 'hidden'
        )}
        onClick={next}
      >
        {presenting && (
          <>
            <span className="font-ui pointer-events-none fixed right-4 bottom-3 text-[12px] text-white/70 tabular-nums">
              {current + 1} / {slideCount}
            </span>
            {/* A visible way out, not only a key: a black rectangle with no
                affordance is the kind of thing people close the tab over. */}
            <button
              type="button"
              aria-label="Exit presenting"
              onClick={(e) => {
                e.stopPropagation()
                exitPresent()
              }}
              className="font-ui fixed top-3 right-4 border border-white/30 px-2 py-0.5 text-[12px] text-white/70 hover:bg-white/10 hover:text-white"
            >
              Exit (Esc)
            </button>
          </>
        )}
      </div>

      {fileDialog}
    </div>
  )
}
