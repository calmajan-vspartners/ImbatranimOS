import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Brush,
  Circle,
  Crop,
  Eraser,
  FilePlus,
  FolderOpen,
  Minus,
  PaintBucket,
  Pencil,
  Pipette,
  Redo2,
  Save,
  Square,
  SquareDashed,
  Type,
  Undo2,
} from 'lucide-react'
import {
  Button,
  Checkbox,
  Select,
  Tooltip,
  cn,
  downloadUrl,
  fileName,
  notify,
  reportFileFailure,
  reportFileRefusal,
  uploadFileBytes,
  useConfirm,
  useFileDialog,
  useIntentStore,
  useRegisteredHotkeys,
  useSaveHotkey,
  useUnsavedGuard,
} from '@imbatranim/core'
import { floodFill } from './lib/floodFill'
import {
  canRedo,
  canUndo,
  createUndoStack,
  push as pushUndo,
  redo as redoStack,
  undo as undoStack,
  type UndoStack,
} from './lib/undoStack'
import { MAX_DIMENSION, canvasPoint, dragRect, isCroppable, type Rect } from './lib/geometry'

type Tool =
  | 'pencil'
  | 'brush'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'fill'
  | 'text'
  | 'eraser'
  | 'eyedropper'
  | 'select'

/** The six shared hue names (briefs 72/74) as ink, plus the monochrome core. */
const SWATCHES = [
  '#000000',
  '#666666',
  '#ffffff',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#f43f5e',
  '#8b5cf6',
  '#94a3b8',
]

const SIZES = [1, 3, 6, 12]
const ZOOMS = [0.5, 1, 2, 4]
const UNDO_CAP = 30

type Doc = { root: string; path: string }

function hexToRgba(hex: string): [number, number, number, number] {
  const v = hex.replace('#', '')
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
    255,
  ]
}

/** JPEG re-encodes lossily; everything else Paint writes is PNG. */
function formatFor(path: string): { mime: string; quality?: number } {
  return /\.(jpe?g)$/i.test(path) ? { mime: 'image/jpeg', quality: 0.92 } : { mime: 'image/png' }
}

const TOOLS: { id: Tool; icon: typeof Pencil; label: string }[] = [
  { id: 'pencil', icon: Pencil, label: 'Pencil' },
  { id: 'brush', icon: Brush, label: 'Brush' },
  { id: 'line', icon: Minus, label: 'Line' },
  { id: 'rect', icon: Square, label: 'Rectangle' },
  { id: 'ellipse', icon: Circle, label: 'Ellipse' },
  { id: 'fill', icon: PaintBucket, label: 'Fill' },
  { id: 'text', icon: Type, label: 'Text' },
  { id: 'eraser', icon: Eraser, label: 'Eraser' },
  { id: 'eyedropper', icon: Pipette, label: 'Pick colour' },
  { id: 'select', icon: SquareDashed, label: 'Select (for crop)' },
]

/**
 * Paint (brief 95): a canvas-2D image editor with the classic tool set —
 * v1 is Paint, not Photoshop. The pixel decisions (flood fill, undo model,
 * zoom coordinate math, size caps) live in ./lib as pure tested modules;
 * this component owns the canvas, the pointer choreography and the save
 * spine. Zero dependencies.
 */
export function Paint({ windowId }: { windowId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const [tool, setTool] = useState<Tool>('pencil')
  const [color, setColor] = useState('#000000')
  const [size, setSize] = useState(3)
  const [fillShapes, setFillShapes] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [doc, setDoc] = useState<Doc | null>(null)
  const [dirty, setDirty] = useState(false)
  const [dims, setDims] = useState({ width: 800, height: 600 })
  const [selection, setSelection] = useState<Rect | null>(null)
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null)
  const [textValue, setTextValue] = useState('')
  // Undo state lives in a ref (ImageData snapshots are heavy); the toolbar
  // reads these mirrored flags — a ref must not be read during render.
  const undoRef = useRef<UndoStack<ImageData>>(createUndoStack(UNDO_CAP))
  const [undoFlags, setUndoFlags] = useState({ undo: false, redo: false })
  const dragRef = useRef<{ startX: number; startY: number; lastX: number; lastY: number } | null>(
    null
  )
  const { openFile, saveFile, fileDialog } = useFileDialog(windowId)
  const { confirm, confirmDialog } = useConfirm()

  const ctx = () => canvasRef.current!.getContext('2d', { willReadFrequently: true })!

  const syncUndoFlags = () =>
    setUndoFlags({ undo: canUndo(undoRef.current), redo: canRedo(undoRef.current) })

  const snapshot = useCallback(() => {
    const c = canvasRef.current!
    undoRef.current = pushUndo(undoRef.current, ctx().getImageData(0, 0, c.width, c.height))
    setUndoFlags({ undo: canUndo(undoRef.current), redo: canRedo(undoRef.current) })
  }, [])

  const blank = useCallback((width: number, height: number) => {
    const c = canvasRef.current!
    c.width = width
    c.height = height
    const g = ctx()
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, width, height)
    setDims({ width, height })
    undoRef.current = createUndoStack(UNDO_CAP)
    setUndoFlags({ undo: false, redo: false })
    setSelection(null)
    setDirty(false)
  }, [])

  // First mount: a white 800×600 canvas. Priming the bitmap is the
  // sync-with-an-external-system an effect exists for; the setState mirrors
  // it once. Same scoped disable the intent drains carry.
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    blank(800, 600)
  }, [blank])

  const loadImage = useCallback(
    async (root: string, path: string) => {
      try {
        const img = new Image()
        img.src = downloadUrl(root, path)
        await img.decode()
        if (img.naturalWidth > MAX_DIMENSION || img.naturalHeight > MAX_DIMENSION) {
          reportFileRefusal(
            `is ${img.naturalWidth}×${img.naturalHeight} — Paint edits bitmaps whole and clamps at ${MAX_DIMENSION}px a side`,
            { appId: 'paint', name: fileName(path) }
          )
          return
        }
        blank(img.naturalWidth, img.naturalHeight)
        ctx().drawImage(img, 0, 0)
        setDoc({ root, path })
        setDirty(false)
      } catch (err) {
        reportFileFailure('open', err, { appId: 'paint', noun: 'image', name: fileName(path) })
      }
    },
    [blank]
  )

  // One-shot open intent (file manager's "Edit in Paint", snip handoff).
  const consumedRef = useRef(false)
  useEffect(() => {
    if (consumedRef.current) return
    consumedRef.current = true
    const intent = useIntentStore.getState().consumeIntent(windowId) as
      | { openPath?: string; root?: string; dataUrl?: string }
      | undefined
    // Draining a one-shot intent IS the "sync from an external system" an
    // effect is for (ref-guarded; the house pattern since brief 30).
    /* eslint-disable react-hooks/set-state-in-effect */
    if (intent?.openPath && intent.root) {
      void loadImage(intent.root, intent.openPath)
    } else if (intent?.dataUrl) {
      const img = new Image()
      img.onload = () => {
        blank(Math.min(img.naturalWidth, MAX_DIMENSION), Math.min(img.naturalHeight, MAX_DIMENSION))
        ctx().drawImage(img, 0, 0)
        setDirty(true)
      }
      img.src = intent.dataUrl
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    // Mount-once drain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowId])

  const point = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return canvasPoint(e.clientX, e.clientY, rect, dims.width, dims.height)
  }

  const strokeStyle = (g: CanvasRenderingContext2D) => {
    g.strokeStyle = color
    g.fillStyle = color
    g.lineWidth = tool === 'pencil' ? 1 : size
    g.lineCap = 'round'
    g.lineJoin = 'round'
  }

  const clearOverlay = () => {
    const o = overlayRef.current!
    o.getContext('2d')!.clearRect(0, 0, o.width, o.height)
  }

  const drawShapePreview = (g: CanvasRenderingContext2D, x: number, y: number) => {
    const d = dragRef.current!
    strokeStyle(g)
    g.beginPath()
    if (tool === 'line') {
      g.moveTo(d.startX + 0.5, d.startY + 0.5)
      g.lineTo(x + 0.5, y + 0.5)
      g.stroke()
      return
    }
    const r = dragRect(d.startX, d.startY, x, y, dims.width, dims.height)
    if (tool === 'rect') {
      if (fillShapes) g.fillRect(r.x, r.y, r.width, r.height)
      else g.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(1, r.width - 1), Math.max(1, r.height - 1))
      return
    }
    if (tool === 'ellipse') {
      g.ellipse(r.x + r.width / 2, r.y + r.height / 2, r.width / 2, r.height / 2, 0, 0, 2 * Math.PI)
      if (fillShapes) g.fill()
      else g.stroke()
      return
    }
    if (tool === 'select') {
      g.setLineDash([4, 3])
      g.lineWidth = 1
      g.strokeStyle = '#000000'
      g.strokeRect(r.x + 0.5, r.y + 0.5, r.width, r.height)
      g.setLineDash([])
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const { x, y } = point(e)

    if (tool === 'eyedropper') {
      const [r, g, b] = ctx().getImageData(x, y, 1, 1).data
      setColor(`#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`)
      return
    }
    if (tool === 'fill') {
      snapshot()
      const c = canvasRef.current!
      const image = ctx().getImageData(0, 0, c.width, c.height)
      if (floodFill(image, x, y, hexToRgba(color))) {
        ctx().putImageData(image, 0, 0)
        setDirty(true)
      }
      return
    }
    if (tool === 'text') {
      setTextAt({ x, y })
      setTextValue('')
      return
    }

    dragRef.current = { startX: x, startY: y, lastX: x, lastY: y }
    if (tool === 'pencil' || tool === 'brush' || tool === 'eraser') {
      snapshot()
      const g = ctx()
      strokeStyle(g)
      if (tool === 'eraser') {
        g.strokeStyle = '#ffffff'
        g.lineWidth = Math.max(6, size * 2)
      }
      g.beginPath()
      g.moveTo(x + 0.5, y + 0.5)
      g.lineTo(x + 0.5, y + 0.5)
      g.stroke()
      setDirty(true)
    } else {
      setSelection(null)
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const { x, y } = point(e)
    if (tool === 'pencil' || tool === 'brush' || tool === 'eraser') {
      const g = ctx()
      strokeStyle(g)
      if (tool === 'eraser') {
        g.strokeStyle = '#ffffff'
        g.lineWidth = Math.max(6, size * 2)
      }
      g.beginPath()
      g.moveTo(d.lastX + 0.5, d.lastY + 0.5)
      g.lineTo(x + 0.5, y + 0.5)
      g.stroke()
      d.lastX = x
      d.lastY = y
      return
    }
    // Shape/selection preview on the overlay.
    clearOverlay()
    drawShapePreview(overlayRef.current!.getContext('2d')!, x, y)
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    const { x, y } = point(e)
    if (tool === 'line' || tool === 'rect' || tool === 'ellipse') {
      clearOverlay()
      snapshot()
      drawShapePreview(ctx(), x, y)
      setDirty(true)
      return
    }
    if (tool === 'select') {
      clearOverlay()
      const r = dragRect(d.startX, d.startY, x, y, dims.width, dims.height)
      // Keep the marquee visible on the overlay while the selection stands.
      const g = overlayRef.current!.getContext('2d')!
      g.setLineDash([4, 3])
      g.strokeStyle = '#000000'
      g.strokeRect(r.x + 0.5, r.y + 0.5, r.width, r.height)
      g.setLineDash([])
      setSelection(isCroppable(r) ? r : null)
    }
  }

  const commitText = () => {
    if (textAt && textValue.trim()) {
      snapshot()
      const g = ctx()
      g.fillStyle = color
      g.font = `${12 + size * 4}px system-ui, sans-serif`
      g.textBaseline = 'top'
      g.fillText(textValue, textAt.x, textAt.y)
      setDirty(true)
    }
    setTextAt(null)
    setTextValue('')
  }

  const crop = () => {
    if (!isCroppable(selection)) return
    snapshot()
    const image = ctx().getImageData(selection.x, selection.y, selection.width, selection.height)
    const c = canvasRef.current!
    c.width = selection.width
    c.height = selection.height
    ctx().putImageData(image, 0, 0)
    setDims({ width: selection.width, height: selection.height })
    setSelection(null)
    clearOverlay()
    setDirty(true)
  }

  const applyUndo = useCallback((direction: 'undo' | 'redo') => {
    const c = canvasRef.current!
    const present = ctx().getImageData(0, 0, c.width, c.height)
    const result =
      direction === 'undo'
        ? undoStack(undoRef.current, present)
        : redoStack(undoRef.current, present)
    if (!result) return
    undoRef.current = result.stack
    // A snapshot may have different dimensions (crop/resize was undone).
    c.width = result.state.width
    c.height = result.state.height
    ctx().putImageData(result.state, 0, 0)
    setDims({ width: result.state.width, height: result.state.height })
    setSelection(null)
    clearOverlay()
    setDirty(true)
    syncUndoFlags()
  }, [])

  const toBlob = (): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const fmt = formatFor(doc?.path ?? '.png')
      canvasRef.current!.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('encode failed'))),
        fmt.mime,
        fmt.quality
      )
    })

  const saveTo = useCallback(
    async (target: Doc) => {
      try {
        const blob = await toBlob()
        const bytes = new Uint8Array(await blob.arrayBuffer())
        await uploadFileBytes(target.root, target.path, bytes, fileName(target.path))
        setDoc(target)
        setDirty(false)
        notify({ title: 'Saved', body: fileName(target.path), appId: 'paint', level: 'info' })
      } catch (err) {
        reportFileFailure('save', err, {
          appId: 'paint',
          noun: 'image',
          name: fileName(target.path),
        })
      }
    },
    // toBlob reads doc for the format; recreate when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc]
  )

  const save = useCallback(async () => {
    if (doc) return saveTo(doc)
    const choice = await saveFile({
      title: 'Save image as',
      extensions: ['png', 'jpg', 'jpeg'],
      suggestedName: 'untitled.png',
    })
    if (choice) {
      const path = /\.(png|jpe?g)$/i.test(choice.path) ? choice.path : `${choice.path}.png`
      await saveTo({ root: choice.root, path })
    }
  }, [doc, saveTo, saveFile])

  const open = useCallback(async () => {
    if (
      dirty &&
      !(await confirm({
        title: 'Discard changes?',
        message: 'Unsaved edits will be lost.',
        confirmLabel: 'Discard',
        destructive: true,
      }))
    )
      return
    const choice = await openFile({
      title: 'Open image',
      extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
    })
    if (choice) await loadImage(choice.root, choice.path)
  }, [dirty, confirm, openFile, loadImage])

  const fresh = useCallback(async () => {
    if (
      dirty &&
      !(await confirm({
        title: 'Discard changes?',
        message: 'Unsaved edits will be lost.',
        confirmLabel: 'Discard',
        destructive: true,
      }))
    )
      return
    setDoc(null)
    blank(800, 600)
  }, [dirty, confirm, blank])

  useSaveHotkey(windowId, () => void save())
  useUnsavedGuard(windowId, dirty, doc ? fileName(doc.path) : 'untitled')

  // Handlers via a ref: useRegisteredHotkeys captures per key set (brief 98).
  const actionsRef = useRef({ undo: () => {}, redo: () => {} })
  useEffect(() => {
    actionsRef.current = { undo: () => applyUndo('undo'), redo: () => applyUndo('redo') }
  })
  useRegisteredHotkeys([
    {
      id: 'paint.undo',
      keys: 'mod+z',
      description: 'Undo, in Paint',
      scope: 'Editing',
      handler: () => actionsRef.current.undo(),
    },
    {
      id: 'paint.redo',
      keys: 'mod+shift+z',
      description: 'Redo, in Paint',
      scope: 'Editing',
      handler: () => actionsRef.current.redo(),
    },
  ])

  return (
    <div className="bg-surface flex h-full flex-col">
      {/* Top bar: file actions, colours, size, zoom */}
      <div className="border-outline-variant bg-surface-container-low flex flex-none flex-wrap items-center gap-1.5 border-b px-2 py-1">
        <Tooltip content="New canvas">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            aria-label="New canvas"
            onClick={() => void fresh()}
          >
            <FilePlus size={13} />
          </Button>
        </Tooltip>
        <Tooltip content="Open image">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            aria-label="Open image"
            onClick={() => void open()}
          >
            <FolderOpen size={13} />
          </Button>
        </Tooltip>
        <Tooltip content="Save (mod+S)">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            aria-label="Save"
            onClick={() => void save()}
          >
            <Save size={13} />
          </Button>
        </Tooltip>
        <div className="bg-outline-variant mx-0.5 h-4 w-px" />
        <Tooltip content="Undo (mod+Z)">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            aria-label="Undo"
            disabled={!undoFlags.undo}
            onClick={() => applyUndo('undo')}
          >
            <Undo2 size={13} />
          </Button>
        </Tooltip>
        <Tooltip content="Redo (mod+shift+Z)">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            aria-label="Redo"
            disabled={!undoFlags.redo}
            onClick={() => applyUndo('redo')}
          >
            <Redo2 size={13} />
          </Button>
        </Tooltip>
        {isCroppable(selection) && (
          <Button size="sm" variant="primary" onClick={crop}>
            <Crop size={12} /> Crop
          </Button>
        )}
        <div className="bg-outline-variant mx-0.5 h-4 w-px" />
        {SWATCHES.map((hex) => (
          <button
            key={hex}
            type="button"
            aria-label={`Colour ${hex}`}
            onClick={() => setColor(hex)}
            className={cn(
              'border-outline-variant h-5 w-5 border',
              color === hex && 'ring-primary ring-2 ring-offset-1'
            )}
            style={{ backgroundColor: hex }}
          />
        ))}
        <input
          type="color"
          aria-label="Custom colour"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="border-outline-variant h-6 w-7 cursor-pointer border bg-transparent p-0.5"
        />
        <div className="flex-1" />
        <label className="font-ui text-on-surface-variant flex items-center gap-1 text-[11px]">
          <Checkbox checked={fillShapes} onCheckedChange={(v) => setFillShapes(v === true)} />
          Fill shapes
        </label>
        <Select
          aria-label="Stroke size"
          className="w-16"
          value={String(size)}
          onValueChange={(v) => setSize(Number(v))}
          options={SIZES.map((s) => ({ value: String(s), label: `${s} px` }))}
        />
        <Select
          aria-label="Zoom"
          className="w-20"
          value={String(zoom)}
          onValueChange={(v) => setZoom(Number(v))}
          options={ZOOMS.map((z) => ({ value: String(z), label: `${z * 100}%` }))}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Tool rail */}
        <div className="border-outline-variant bg-surface-container-low flex w-9 flex-none flex-col items-center gap-0.5 border-r py-1">
          {TOOLS.map((t) => {
            const Icon = t.icon
            return (
              <Tooltip key={t.id} content={t.label}>
                <Button
                  size="sm"
                  variant={tool === t.id ? 'primary' : 'ghost'}
                  className="h-7 w-7 p-0"
                  aria-label={t.label}
                  aria-pressed={tool === t.id}
                  onClick={() => {
                    setTool(t.id)
                    if (t.id !== 'select') {
                      setSelection(null)
                      clearOverlay()
                    }
                  }}
                >
                  <Icon size={14} />
                </Button>
              </Tooltip>
            )
          })}
        </div>

        {/* Canvas viewport */}
        <div className="bg-surface-container relative min-h-0 flex-1 overflow-auto p-3">
          <div
            className="relative inline-block"
            style={{ width: dims.width * zoom, height: dims.height * zoom }}
          >
            <canvas
              ref={canvasRef}
              className="border-outline-variant absolute top-0 left-0 border bg-white"
              style={{
                width: dims.width * zoom,
                height: dims.height * zoom,
                imageRendering: zoom > 1 ? 'pixelated' : 'auto',
              }}
            />
            <canvas
              ref={overlayRef}
              width={dims.width}
              height={dims.height}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className="absolute top-0 left-0 cursor-crosshair touch-none"
              style={{ width: dims.width * zoom, height: dims.height * zoom }}
            />
            {textAt && (
              <input
                autoFocus
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitText()
                  else if (e.key === 'Escape') {
                    setTextAt(null)
                    setTextValue('')
                  }
                }}
                onBlur={commitText}
                placeholder="Type, Enter commits"
                className="border-primary font-ui absolute border bg-white/90 px-1 text-[12px] text-black outline-none"
                style={{ left: textAt.x * zoom, top: textAt.y * zoom, minWidth: 120 }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="border-outline-variant bg-surface-container-low text-on-surface-variant flex h-5 flex-none items-center gap-2 border-t px-2 text-[10px]">
        <span>
          {dims.width}×{dims.height}
          {doc ? ` · ${fileName(doc.path)}` : ' · untitled'}
          {dirty ? ' •' : ''}
        </span>
        <div className="flex-1" />
        {formatFor(doc?.path ?? '.png').mime === 'image/jpeg' && (
          <span>JPEG re-encodes on save (quality 92)</span>
        )}
      </div>
      {fileDialog}
      {confirmDialog}
    </div>
  )
}
