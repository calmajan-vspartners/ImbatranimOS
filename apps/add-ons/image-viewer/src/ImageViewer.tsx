import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Image as ImageIcon,
  ImageOff,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize,
  RotateCcw,
  RotateCw,
  Download,
  Loader2,
} from 'lucide-react'
import {
  Button,
  Tooltip,
  downloadUrl,
  fileName,
  useFileDialog,
  useOpenIntent,
} from '@imbatranim/core'
import { listDir } from './api/listDir'
import type { FsEntry } from './api/types'
import { isImagePath, parentDir, clamp } from './lib/imagePath'

const MIN_ZOOM = 0.1
const MAX_ZOOM = 8
const ZOOM_STEP = 0.25

type ZoomMode = 'fit' | 'manual'
type Size = { width: number; height: number }

export function ImageViewer({ windowId }: { windowId: string }) {
  // One-shot open intent, drained by the shared hook (StrictMode-safe). This is
  // the file the window was opened with; folder navigation below only ever
  // moves a local `index` over the sibling list — it never re-drains an intent.
  const source = useOpenIntent(windowId)

  // Lets the app open a file on its own instead of dead-ending on
  // "open one from Files". The pick latches into the same store
  // useOpenIntent reads, so the existing load path runs unchanged.
  const { openFile, fileDialog } = useFileDialog(windowId)
  const pickFile = () =>
    void openFile({
      extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'],
    })
  // Sibling image files in the same folder, name-sorted. `null` = not resolved
  // yet (or the listing failed) — prev/next stay disabled and the opened file
  // is still shown on its own via `source`.
  const [siblings, setSiblings] = useState<FsEntry[] | null>(null)
  const [index, setIndex] = useState(0)

  const [rotation, setRotation] = useState(0) // degrees, always a multiple of 90
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit')
  const [zoom, setZoom] = useState(1)

  const [containerSize, setContainerSize] = useState<Size>({ width: 0, height: 0 })
  const [naturalSize, setNaturalSize] = useState<Size | null>(null)
  // Starts true: the effect that resets per-image state also arms this, and it
  // only flips in the <img> load/error callbacks (avoids setState-in-render).
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const focusRef = useRef<HTMLDivElement>(null)

  const currentPath =
    siblings && siblings.length > 0 ? (siblings[index]?.path ?? null) : (source?.path ?? null)
  const currentRoot = source?.root ?? null

  // Resolve the folder's image siblings once, from the path we were opened
  // with. Not re-run on navigation — `index` alone drives prev/next.
  useEffect(() => {
    if (!source) return
    let cancelled = false
    ;(async () => {
      try {
        const dir = parentDir(source.path)
        const entries = await listDir(source.root, dir)
        const images = entries
          .filter((e) => e.type === 'file' && isImagePath(e.name))
          .sort((a, b) => a.name.localeCompare(b.name))
        if (cancelled) return
        setSiblings(images)
        const i = images.findIndex((e) => e.path === source.path)
        setIndex(i >= 0 ? i : 0)
      } catch (err) {
        console.error('[image-viewer] failed to list folder', err)
        if (!cancelled) setSiblings([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [source])

  // Loading a new image resets zoom/rotate and the loaded-natural-size cache.
  // Deliberately NOT a `useEffect` (which would set state synchronously inside
  // an effect body — a cascading-render footgun); this is React's documented
  // "adjust state during render when a prop changes" bail-out instead.
  const [resetForPath, setResetForPath] = useState<string | null>(null)
  if (currentPath !== resetForPath) {
    setResetForPath(currentPath)
    setRotation(0)
    setZoomMode('fit')
    setZoom(1)
    setNaturalSize(null)
    setLoading(true)
    setError(null)
  }

  // Track the viewport size so "fit to window" stays honest across resizes.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height })
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Focus the pane once a file is open so keyboard shortcuts work without an
  // extra click.
  useEffect(() => {
    if (source) focusRef.current?.focus()
  }, [source])

  const goPrev = useCallback(() => {
    setIndex((i) =>
      siblings && siblings.length > 0 ? (i - 1 + siblings.length) % siblings.length : i
    )
  }, [siblings])
  const goNext = useCallback(() => {
    setIndex((i) => (siblings && siblings.length > 0 ? (i + 1) % siblings.length : i))
  }, [siblings])

  // Rotation flips which natural axis maps to width vs. height, so "fit"
  // fits the rotated bounding box, not the raw pixel one.
  const contentWidth = naturalSize
    ? rotation % 180 === 0
      ? naturalSize.width
      : naturalSize.height
    : 0
  const contentHeight = naturalSize
    ? rotation % 180 === 0
      ? naturalSize.height
      : naturalSize.width
    : 0
  const fitScale =
    naturalSize &&
    contentWidth > 0 &&
    contentHeight > 0 &&
    containerSize.width > 0 &&
    containerSize.height > 0
      ? clamp(
          Math.min(containerSize.width / contentWidth, containerSize.height / contentHeight),
          MIN_ZOOM,
          MAX_ZOOM
        )
      : 1
  const scale = zoomMode === 'fit' ? fitScale : zoom

  const zoomIn = useCallback(() => {
    setZoom((z) => clamp((zoomMode === 'fit' ? fitScale : z) + ZOOM_STEP, MIN_ZOOM, MAX_ZOOM))
    setZoomMode('manual')
  }, [zoomMode, fitScale])
  const zoomOut = useCallback(() => {
    setZoom((z) => clamp((zoomMode === 'fit' ? fitScale : z) - ZOOM_STEP, MIN_ZOOM, MAX_ZOOM))
    setZoomMode('manual')
  }, [zoomMode, fitScale])
  const fitToWindow = useCallback(() => setZoomMode('fit'), [])
  const zoomActual = useCallback(() => {
    setZoomMode('manual')
    setZoom(1)
  }, [])
  const rotateLeft = useCallback(() => setRotation((r) => (r - 90 + 360) % 360), [])
  const rotateRight = useCallback(() => setRotation((r) => (r + 90) % 360), [])

  function handleImgLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget
    setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight })
    setLoading(false)
  }
  function handleImgError() {
    setLoading(false)
    setError('Could not load this image.')
  }

  function triggerDownload() {
    if (!currentRoot || !currentPath) return
    const url = downloadUrl(currentRoot, currentPath)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName(currentPath, 'image')
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault()
        goPrev()
        break
      case 'ArrowRight':
        e.preventDefault()
        goNext()
        break
      case '+':
      case '=':
        e.preventDefault()
        zoomIn()
        break
      case '-':
      case '_':
        e.preventDefault()
        zoomOut()
        break
      case '0':
        e.preventDefault()
        fitToWindow()
        break
      case 'r':
      case 'R':
        e.preventDefault()
        rotateRight()
        break
      default:
        break
    }
  }

  const hasSiblingNav = !!siblings && siblings.length > 1
  const zoomLabel = zoomMode === 'fit' ? 'Fit' : `${Math.round(scale * 100)}%`

  if (!source) {
    return (
      <div className="bg-surface-container-lowest text-on-surface-variant flex h-full flex-col items-center justify-center gap-2 text-center">
        <ImageIcon size={40} strokeWidth={1} />
        <span className="font-ui text-[12px]">Nothing open</span>
        <Button size="sm" variant="primary" onClick={pickFile}>
          Open an image
        </Button>
        {fileDialog}
      </div>
    )
  }

  return (
    <div
      ref={focusRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="bg-surface-container-lowest flex h-full flex-col outline-none"
    >
      {/* Toolbar */}
      <div className="border-outline-variant bg-surface-container-low flex items-center gap-1 border-b px-2 py-1">
        <Tooltip content="Previous image">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            onClick={goPrev}
            disabled={!hasSiblingNav}
          >
            <ChevronLeft size={13} />
          </Button>
        </Tooltip>
        <span className="font-ui text-on-surface-variant min-w-[48px] text-center text-[11px] tabular-nums">
          {siblings && siblings.length > 0 ? `${index + 1} / ${siblings.length}` : '— / —'}
        </span>
        <Tooltip content="Next image">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            onClick={goNext}
            disabled={!hasSiblingNav}
          >
            <ChevronRight size={13} />
          </Button>
        </Tooltip>

        <div className="bg-outline-variant mx-1 h-4 w-px" />

        <Tooltip content="Zoom out">
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={zoomOut}>
            <ZoomOut size={13} />
          </Button>
        </Tooltip>
        <span className="font-ui text-on-surface-variant min-w-[40px] text-center text-[11px] tabular-nums">
          {zoomLabel}
        </span>
        <Tooltip content="Zoom in">
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={zoomIn}>
            <ZoomIn size={13} />
          </Button>
        </Tooltip>
        <Tooltip content="Fit to window">
          <Button
            variant={zoomMode === 'fit' ? 'primary' : 'ghost'}
            size="sm"
            className="h-5 w-5 p-0"
            onClick={fitToWindow}
          >
            <Maximize size={13} />
          </Button>
        </Tooltip>
        <Tooltip content="Actual size (100%)">
          <Button
            variant={zoomMode === 'manual' && zoom === 1 ? 'primary' : 'ghost'}
            size="sm"
            className="font-ui h-5 px-1.5 text-[11px]"
            onClick={zoomActual}
          >
            100%
          </Button>
        </Tooltip>

        <div className="bg-outline-variant mx-1 h-4 w-px" />

        <Tooltip content="Rotate left">
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={rotateLeft}>
            <RotateCcw size={13} />
          </Button>
        </Tooltip>
        <Tooltip content="Rotate right">
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={rotateRight}>
            <RotateCw size={13} />
          </Button>
        </Tooltip>

        <div className="flex-1" />

        <span className="font-ui text-on-surface-variant mr-1 max-w-[160px] truncate text-[11px]">
          {fileName(currentPath ?? source.path, 'image')}
        </span>
        <Tooltip content="Download">
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={triggerDownload}>
            <Download size={13} />
          </Button>
        </Tooltip>
      </div>

      {/* Image surface */}
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 items-center justify-center overflow-auto"
      >
        {loading && !error && (
          <div className="text-on-surface-variant font-ui flex items-center gap-2 text-[12px]">
            <Loader2 size={16} className="animate-spin" />
            Loading image…
          </div>
        )}
        {error && (
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <ImageOff size={40} strokeWidth={1} className="text-on-surface-variant" />
            <span className="text-error font-ui text-[12px]">{error}</span>
          </div>
        )}
        {currentRoot && currentPath && (
          <img
            key={currentPath}
            src={downloadUrl(currentRoot, currentPath)}
            alt={fileName(currentPath)}
            draggable={false}
            onLoad={handleImgLoad}
            onError={handleImgError}
            className={loading || error ? 'hidden' : 'select-none'}
            style={{
              transform: `rotate(${rotation}deg) scale(${scale})`,
              transformOrigin: 'center center',
            }}
          />
        )}
      </div>
    </div>
  )
}
