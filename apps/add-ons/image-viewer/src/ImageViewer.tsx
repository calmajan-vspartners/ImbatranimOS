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
  Save,
  Copy,
} from 'lucide-react'
import {
  Button,
  Tooltip,
  cn,
  fileName,
  reportFileFailure,
  useFileDialog,
  useOpenIntent,
  useElementSize,
  useSaveHotkey,
  useSystem,
  useUnsavedGuard,
} from '@imbatranim/ui'
import { listDir } from './api/listDir'
import type { FsEntry } from './api/types'
import { isImagePath, parentDir, clamp } from './lib/imagePath'
import { canPan, clampPan, NO_PAN, renderedSize, type Offset } from './lib/pan'
import { canSaveInPlace, copyName, encodeMime, noSaveReason, rotatedCanvasSize } from './lib/encode'

const MIN_ZOOM = 0.1
const MAX_ZOOM = 8
const ZOOM_STEP = 0.25

type ZoomMode = 'fit' | 'manual'
type Size = { width: number; height: number }

export function ImageViewer({ windowId: _windowId }: { windowId: string }) {
  const system = useSystem()

  // One-shot open intent, drained by the shared hook (StrictMode-safe). This is
  // the file the window was opened with; folder navigation below only ever
  // moves a local `index` over the sibling list — it never re-drains an intent.
  const source = useOpenIntent()

  // Lets the app open a file on its own instead of dead-ending on
  // "open one from Files". The pick latches into the same store
  // useOpenIntent reads, so the existing load path runs unchanged.
  const { openFile, saveFile } = useFileDialog()
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

  // The pane's live box, via core's `useElementSize` — a ref callback, because a
  // mount effect never binds: this component early-returns an "Nothing open" tree
  // until the open intent is drained, so the pane does not exist on the first
  // commit. See that hook's doc for the three apps this silently broke.
  const [containerSize, attachScroll] = useElementSize()
  const [naturalSize, setNaturalSize] = useState<Size | null>(null)
  // Starts true: the effect that resets per-image state also arms this, and it
  // only flips in the <img> load/error callbacks (avoids setState-in-render).
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Rotation the file on disk already has. Rotating away from it makes the image
  // dirty; saving brings the two back together. Without this, rotate was
  // display-only — turn a sideways photo upright, close the window, and it is
  // sideways again, with the user's action silently discarded.
  const [savedRotation, setSavedRotation] = useState(0)
  const [saving, setSaving] = useState(false)
  const [offset, setOffset] = useState<Offset>(NO_PAN)
  // Mirrors `dragRef` for the cursor only. The ref is the source of truth during
  // a drag (a pointermove must not wait for a render), but the cursor has to be
  // state: a ref read during render would never re-render, so the grabbing
  // cursor would simply never appear.
  const [dragging, setDragging] = useState(false)

  const focusRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    from: Offset
  } | null>(null)

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
        const entries = await listDir(system.http, source.root, dir)
        const images = entries
          .filter((e) => e.type === 'file' && isImagePath(e.name))
          .sort((a, b) => a.name.localeCompare(b.name))
        if (cancelled) return
        const i = images.findIndex((e) => e.path === source.path)
        if (i >= 0) {
          setSiblings(images)
          setIndex(i)
        } else {
          // The opened file is not among the folder's images (deleted, renamed, or
          // not itself an image). Show the opened path alone — falling back through
          // `currentPath` to `source.path` — rather than silently displaying
          // `images[0]` while the counter claims "1 / N" (L6).
          setSiblings([])
          setIndex(0)
        }
      } catch (err) {
        console.error('[image-viewer] failed to list folder', err)
        if (!cancelled) setSiblings([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [source, system])

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
    setOffset(NO_PAN)
    setSavedRotation(0)
  }

  // Focus the pane once a file is open so keyboard shortcuts work without an
  // extra click.
  useEffect(() => {
    if (source) focusRef.current?.focus()
  }, [source])

  // Moving to a sibling throws away an unsaved rotation, because every per-image
  // piece of state is reset for the new path. `useUnsavedGuard` only covers
  // *closing* the window, so without this an arrow key silently discards the
  // user's turn — the same defect as rotate not persisting at all, just harder to
  // notice. Uses the same `window.confirm` spine as the close guard.
  const confirmDiscard = useCallback(() => {
    if (rotation === savedRotation) return true
    return window.confirm(
      'This image has an unsaved rotation. Move to the next image without saving?'
    )
  }, [rotation, savedRotation])

  const goPrev = useCallback(() => {
    if (!confirmDiscard()) return
    setIndex((i) =>
      siblings && siblings.length > 0 ? (i - 1 + siblings.length) % siblings.length : i
    )
  }, [siblings, confirmDiscard])
  const goNext = useCallback(() => {
    if (!confirmDiscard()) return
    setIndex((i) => (siblings && siblings.length > 0 ? (i + 1) % siblings.length : i))
  }, [siblings, confirmDiscard])

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

  // On-screen bounding box, so pan bounds are right for a rotated image too.
  const content = renderedSize(naturalSize, scale, rotation)
  const pannable = canPan(content, containerSize)
  // Clamped on read as well as on write: a zoom-out or a window resize can leave
  // a previously-legal offset out of bounds, and the image would sit stranded
  // half off-screen with no way to bring it back.
  const pan = clampPan(offset, content, containerSize)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!pannable) return
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, from: pan }
      setDragging(true)
    },
    [pannable, pan]
  )

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    setOffset({
      x: drag.from.x + (e.clientX - drag.startX),
      y: drag.from.y + (e.clientY - drag.startY),
    })
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    dragRef.current = null
    setDragging(false)
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }, [])

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
  // Rotating changes which axis overflows, so a pan offset from before the turn
  // is meaningless — reset it rather than leaving the image somewhere arbitrary.
  const rotateLeft = useCallback(() => {
    setRotation((r) => (r - 90 + 360) % 360)
    setOffset(NO_PAN)
  }, [])
  const rotateRight = useCallback(() => {
    setRotation((r) => (r + 90) % 360)
    setOffset(NO_PAN)
  }, [])

  // ── Saving a rotation ───────────────────────────────────────────────────────

  const dirty = rotation !== savedRotation
  const savable = currentPath ? canSaveInPlace(currentPath) : false
  const cannotSaveWhy = currentPath ? noSaveReason(currentPath) : null

  // Same spine as every other editor in the OS: the title carries a dirty marker
  // and closing with unsaved changes warns.
  useUnsavedGuard(dirty, currentPath ? fileName(currentPath, 'image') : '')

  /**
   * Re-encode the visible image at its current rotation.
   *
   * `drawImage` receives the pixels the user is looking at — the browser has
   * already applied any EXIF orientation (measured; see `lib/encode.ts`) — so the
   * output needs no orientation tag and cannot disagree with itself.
   */
  const encodeRotated = useCallback(
    async (mime: string): Promise<ArrayBuffer> => {
      const img = imgRef.current
      if (!img || !naturalSize) throw new Error('The image is not loaded yet.')
      const size = rotatedCanvasSize(naturalSize, rotation)
      const canvas = document.createElement('canvas')
      canvas.width = size.width
      canvas.height = size.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('This browser would not provide a 2D canvas.')
      // Rotate about the centre of the OUTPUT box, then draw the image centred on
      // its own axes — the only ordering that works for both quarter turns.
      ctx.translate(size.width / 2, size.height / 2)
      ctx.rotate((rotation * Math.PI) / 180)
      ctx.drawImage(img, -naturalSize.width / 2, -naturalSize.height / 2)
      const blob = await new Promise<Blob | null>((resolve) =>
        // JPEG quality 0.92: a re-encode is a generation loss either way, and this
        // is high enough that one rotation is not visible.
        canvas.toBlob((b) => resolve(b), mime, 0.92)
      )
      if (!blob) throw new Error('The image could not be re-encoded.')
      return blob.arrayBuffer()
    },
    [naturalSize, rotation]
  )

  const saveRotation = useCallback(async () => {
    if (!currentRoot || !currentPath || !dirty || saving || !savable) return
    const turnedTo = rotation
    setSaving(true)
    setError(null)
    try {
      const bytes = await encodeRotated(encodeMime(currentPath))
      await system.fs.upload(currentRoot, currentPath, bytes, fileName(currentPath, 'image'))
      // Only now is the file's rotation the one on screen. If the user turned it
      // again mid-save, `rotation` has moved on and it stays dirty.
      setSavedRotation(turnedTo)
    } catch (err) {
      setError(
        reportFileFailure(system, 'save', err, {
          noun: 'image',
          name: fileName(currentPath, 'image'),
        })
      )
    } finally {
      setSaving(false)
    }
  }, [currentRoot, currentPath, dirty, saving, savable, rotation, encodeRotated, system])

  useSaveHotkey(saveRotation)

  const saveCopy = useCallback(async () => {
    if (!currentPath || saving || !naturalSize) return
    const choice = await saveFile({
      title: 'Save a rotated copy',
      suggestedName: copyName(currentPath, rotation),
      extensions: ['png'],
    })
    if (!choice) return
    setSaving(true)
    setError(null)
    try {
      // Always PNG: a copy is a new file, so there is no extension to keep
      // faithful to, and lossless is the right default for one.
      const bytes = await encodeRotated('image/png')
      await system.fs.upload(choice.root, choice.path, bytes, fileName(choice.path, 'image.png'))
    } catch (err) {
      setError(
        reportFileFailure(system, 'save', err, {
          noun: 'image copy',
          name: fileName(choice.path, 'image.png'),
        })
      )
    } finally {
      setSaving(false)
    }
  }, [currentPath, saving, naturalSize, rotation, saveFile, encodeRotated, system])

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
    const url = system.fs.downloadUrl(currentRoot, currentPath)
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

        {dirty && (
          <>
            {/* When the format cannot take a rotation, there is no Save button at
                all rather than a greyed one: a Tooltip on a disabled trigger never
                opens, so the reason would have been unreachable — measured. The
                reason goes inline instead, where it is always readable. */}
            {savable ? (
              <Tooltip content="Save the rotation to the file (Ctrl+S)">
                <Button
                  variant="primary"
                  size="sm"
                  className="ml-1 flex h-5 items-center gap-1 px-1.5"
                  aria-label="Save rotation"
                  disabled={saving}
                  onClick={() => void saveRotation()}
                >
                  {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                  Save
                </Button>
              </Tooltip>
            ) : (
              <span className="font-ui text-on-surface-variant ml-1 max-w-[280px] truncate text-[11px]">
                {cannotSaveWhy}
              </span>
            )}
            <Tooltip content="Save a rotated copy as PNG">
              <Button
                variant={savable ? 'default' : 'primary'}
                size="sm"
                className="flex h-5 items-center gap-1 px-1.5"
                aria-label="Save a rotated copy"
                disabled={saving}
                onClick={() => void saveCopy()}
              >
                <Copy size={11} />
                Copy
              </Button>
            </Tooltip>
          </>
        )}

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

      {/* Image surface.
          `overflow-hidden`, not `overflow-auto`: now that the image is sized
          explicitly it genuinely overflows when zoomed, and native scrollbars
          plus dragging would be two competing ways to move the same picture.
          Panning is the single mechanism. */}
      <div
        ref={attachScroll}
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden"
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
            ref={imgRef}
            src={system.fs.downloadUrl(currentRoot, currentPath)}
            alt={fileName(currentPath)}
            draggable={false}
            onLoad={handleImgLoad}
            onError={handleImgError}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className={cn(
              loading || error ? 'hidden' : 'select-none',
              pannable && (dragging ? 'cursor-grabbing' : 'cursor-grab')
            )}
            style={{
              // Sized explicitly, NOT scaled by the transform. As a flex child the
              // image was already shrunk to the pane's width before any transform
              // ran, so `scale(fitScale)` shrank an already-shrunk box — fit came
              // out at a third of the right size and "100%" showed 638px of a
              // 2000px photo. Measured; see the ref-callback note above for the
              // other half of the same bug.
              ...(naturalSize
                ? { width: naturalSize.width * scale, height: naturalSize.height * scale }
                : null),
              // Defeat the flex/CSS constraints that caused it: the pane centres
              // the image and panning moves it, so it must keep its own size.
              flexShrink: 0,
              maxWidth: 'none',
              maxHeight: 'none',
              // Translate FIRST, in screen space, so a drag moves the image by the
              // pointer distance regardless of rotation. Putting it after rotate
              // would move it along the image's rotated axes instead.
              transform: `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg)`,
              transformOrigin: 'center center',
              // The image is not decoded through a canvas for display, only for
              // save — SVG stays an <img> src, which is the form that cannot
              // execute script. Do not inline SVG here for any reason.
              touchAction: pannable ? 'none' : undefined,
            }}
          />
        )}
      </div>
    </div>
  )
}
