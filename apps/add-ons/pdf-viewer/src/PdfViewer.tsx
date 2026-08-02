import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FileText,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize,
  Download,
  Loader2,
} from 'lucide-react'
import {
  Button,
  Tooltip,
  downloadUrl,
  fetchFileBytes,
  fileName,
  useFileDialog,
  useOpenIntent,
} from '@imbatranim/core'
import { loadPdfDocument, type LoadedPdf, type PDFDocumentProxy } from './engine/pdf'

const MIN_ZOOM = 0.25
const MAX_ZOOM = 4
const ZOOM_STEP = 0.25
const PAGE_GUTTER = 32 // horizontal breathing room used when fitting to width

export function PdfViewer({ windowId }: { windowId: string }) {
  // One-shot open intent, drained by the shared hook (StrictMode-safe).
  const source = useOpenIntent(windowId)

  // Lets the app open a file on its own instead of dead-ending on
  // "open one from Files". The pick latches into the same store
  // useOpenIntent reads, so the existing load path runs unchanged.
  const { openFile, fileDialog } = useFileDialog(windowId)
  const pickFile = () => void openFile({ extensions: ['pdf'] })
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [pageNum, setPageNum] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [fitWidth, setFitWidth] = useState(true)
  // Starts true: the load effect runs as soon as a source is latched, and only
  // ever flips these in async paths (avoids synchronous setState-in-effect).
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [containerWidth, setContainerWidth] = useState<number | null>(null)

  // Track the scroll viewport width so "fit width" stays honest across resizes.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setContainerWidth(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Load + parse the PDF once a source is latched. The document is destroyed on
  // unmount / source change so pdf.js releases its worker-side buffers.
  useEffect(() => {
    if (!source) return
    let cancelled = false
    let loaded: LoadedPdf | null = null
    ;(async () => {
      try {
        const bytes = await fetchFileBytes(source.root, source.path)
        const pdf = await loadPdfDocument(bytes)
        if (cancelled) {
          pdf.destroy()
          return
        }
        loaded = pdf
        setDoc(pdf.doc)
        setNumPages(pdf.doc.numPages)
        setPageNum(1)
      } catch (err) {
        if (!cancelled) {
          console.error('[pdf-viewer] failed to open', err)
          setError('Could not open this PDF.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      if (loaded) loaded.destroy()
    }
  }, [source])

  // Render the current page whenever it, the zoom, or the fit target changes.
  // A stale render is cancelled before a new one starts (rapid paging / zoom).
  useEffect(() => {
    if (!doc) return
    let cancelled = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let task: any = null

    ;(async () => {
      const page = await doc.getPage(pageNum)
      if (cancelled) return

      const base = page.getViewport({ scale: 1 })
      const scale =
        fitWidth && containerWidth
          ? Math.max(MIN_ZOOM, (containerWidth - PAGE_GUTTER) / base.width)
          : zoom
      const viewport = page.getViewport({ scale })

      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const outputScale = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`

      task = page.render({
        canvas,
        canvasContext: ctx,
        viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
      })
      try {
        await task.promise
      } catch {
        // RenderingCancelledException when superseded — ignore.
      }
    })()

    return () => {
      cancelled = true
      if (task) task.cancel()
    }
  }, [doc, pageNum, zoom, fitWidth, containerWidth])

  const goPrev = useCallback(() => setPageNum((p) => Math.max(1, p - 1)), [])
  const goNext = useCallback(() => setPageNum((p) => Math.min(numPages, p + 1)), [numPages])
  const zoomIn = useCallback(() => {
    setFitWidth(false)
    setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))
  }, [])
  const zoomOut = useCallback(() => {
    setFitWidth(false)
    setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))
  }, [])
  const fitToWidth = useCallback(() => setFitWidth(true), [])

  function triggerDownload() {
    if (!source) return
    const url = downloadUrl(source.root, source.path)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName(source.path, 'document.pdf')
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  // Effective zoom label: while fitting, report the last computed fit scale.
  const zoomLabel = fitWidth ? 'Fit' : `${Math.round(zoom * 100)}%`

  if (!source) {
    return (
      <div className="bg-surface-container-lowest text-on-surface-variant flex h-full flex-col items-center justify-center gap-2 text-center">
        <FileText size={40} strokeWidth={1} />
        <span className="font-ui text-[12px]">Nothing open</span>
        <Button size="sm" variant="primary" onClick={pickFile}>
          Open a PDF
        </Button>
        {fileDialog}
      </div>
    )
  }

  return (
    <div className="bg-surface-container-lowest flex h-full flex-col">
      {/* Toolbar */}
      <div className="border-outline-variant bg-surface-container-low flex items-center gap-1 border-b px-2 py-1">
        <Tooltip content="Previous page">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            onClick={goPrev}
            disabled={!doc || pageNum <= 1}
          >
            <ChevronLeft size={13} />
          </Button>
        </Tooltip>
        <span className="font-ui text-on-surface-variant min-w-[72px] text-center text-[11px] tabular-nums">
          {doc ? `${pageNum} / ${numPages}` : '— / —'}
        </span>
        <Tooltip content="Next page">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            onClick={goNext}
            disabled={!doc || pageNum >= numPages}
          >
            <ChevronRight size={13} />
          </Button>
        </Tooltip>

        <div className="bg-outline-variant mx-1 h-4 w-px" />

        <Tooltip content="Zoom out">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            onClick={zoomOut}
            disabled={!doc}
          >
            <ZoomOut size={13} />
          </Button>
        </Tooltip>
        <span className="font-ui text-on-surface-variant min-w-[40px] text-center text-[11px] tabular-nums">
          {zoomLabel}
        </span>
        <Tooltip content="Zoom in">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            onClick={zoomIn}
            disabled={!doc}
          >
            <ZoomIn size={13} />
          </Button>
        </Tooltip>
        <Tooltip content="Fit to width">
          <Button
            variant={fitWidth ? 'primary' : 'ghost'}
            size="sm"
            className="h-5 w-5 p-0"
            onClick={fitToWidth}
            disabled={!doc}
          >
            <Maximize size={13} />
          </Button>
        </Tooltip>

        <div className="flex-1" />

        <span className="font-ui text-on-surface-variant mr-1 max-w-[160px] truncate text-[11px]">
          {fileName(source.path, 'document.pdf')}
        </span>
        <Tooltip content="Download">
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={triggerDownload}>
            <Download size={13} />
          </Button>
        </Tooltip>
      </div>

      {/* Page surface */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        {loading && (
          <div className="text-on-surface-variant font-ui flex h-full items-center justify-center gap-2 text-[12px]">
            <Loader2 size={16} className="animate-spin" />
            Loading PDF…
          </div>
        )}
        {error && !loading && (
          <div className="text-error font-ui flex h-full items-center justify-center text-[12px]">
            {error}
          </div>
        )}
        {!error && (
          <div className="flex justify-center p-4">
            <canvas
              ref={canvasRef}
              className={loading ? 'hidden' : 'border-outline-variant border shadow-sm'}
            />
          </div>
        )}
      </div>
    </div>
  )
}
