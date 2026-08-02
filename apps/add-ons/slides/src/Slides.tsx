import { useEffect, useRef, useState } from 'react'
import { Presentation, Download, Loader2, Info } from 'lucide-react'
import {
  Button,
  Tooltip,
  downloadUrl,
  fetchFileBytes,
  fileName,
  useFileDialog,
  useOpenIntent,
} from '@imbatranim/core'
import { renderPptx } from './engine/pptx'

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
  const { openFile, fileDialog } = useFileDialog(windowId)
  const pickFile = () => void openFile({ extensions: ['pptx'] })
  // Starts true: the render effect runs as soon as a source is latched and only
  // flips these in async paths (avoids synchronous setState-in-effect).
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)

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
        const width = Math.max(320, scroll.clientWidth - SLIDE_GUTTER)
        const height = Math.round(width * SLIDE_ASPECT)
        await renderPptx(renderTarget, bytes, { width, height })
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
        if (!renderedAnything) {
          setError('This presentation could not be previewed. Download it to open in PowerPoint.')
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[slides] failed to render', err)
          setError('Could not render this presentation. Download it to open in PowerPoint.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [source])

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

  return (
    <div className="bg-surface-container-lowest flex h-full flex-col">
      {/* Toolbar / best-effort hint */}
      <div className="border-outline-variant bg-surface-container-low flex items-center gap-2 border-b px-2 py-1">
        <Info size={12} className="text-on-surface-variant shrink-0" />
        <span className="font-ui text-on-surface-variant text-[11px]">
          Best-effort preview — layout may differ from PowerPoint.
        </span>
        <span className="font-ui text-on-surface-variant ml-1 max-w-[160px] truncate text-[11px]">
          {fileName(source.path, 'presentation.pptx')}
        </span>
        <div className="flex-1" />
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
          className={loading || error ? 'hidden' : 'flex flex-col items-center gap-4 p-4'}
        />
      </div>
    </div>
  )
}
