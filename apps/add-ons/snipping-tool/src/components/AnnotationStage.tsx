import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Copy,
  Download,
  Grid2x2,
  Palette,
  Pencil,
  Save,
  Square,
  SquareSlash,
  Type,
  Undo2,
  X,
} from 'lucide-react'
import { cn, openApp } from '@imbatranim/core'
import type { Annotation, Point, Tool } from '../types'
import { saveScreenshot, screenshotFilename } from '../api/screenshotApi'
import { isWorthKeeping, normalizeRect, pixelateBlockSize } from '../lib/annotationGeometry'

type Props = {
  /** The cropped base image, at device-pixel resolution. */
  image: HTMLCanvasElement
  /** What the capture may have missed, or null when the region was clean. */
  notice: string | null
  /** Back to the launcher, keeping the app open. */
  onBack: () => void
  onClose: () => void
}

const COLORS = ['#c0263a', '#111111', '#ffffff', '#f5c518', '#2e7d32', '#1565c0']

const TOOLS: { id: Tool; label: string; Icon: typeof Square }[] = [
  { id: 'arrow', label: 'Arrow', Icon: ArrowUpRight },
  { id: 'rect', label: 'Rectangle', Icon: Square },
  { id: 'text', label: 'Text', Icon: Type },
  // Two redaction tools, in the order you should reach for them. Black out destroys the
  // pixels; pixelate only scrambles them, and a fine mosaic of *text* is recoverable.
  {
    id: 'blackout',
    label: 'Black out (destroys the pixels — use this for secrets)',
    Icon: SquareSlash,
  },
  { id: 'pixelate', label: 'Pixelate (scrambles; recoverable on small text)', Icon: Grid2x2 },
  { id: 'freehand', label: 'Freehand', Icon: Pencil },
]

/** The one fixed colour in the app: a redaction is not a styling choice. */
const BLACKOUT_FILL = '#0b0b0d'

const canCopy =
  typeof window !== 'undefined' &&
  window.isSecureContext &&
  !!navigator.clipboard &&
  typeof window.ClipboardItem !== 'undefined'

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))), 'image/png')
  })
}

export function AnnotationStage({ image, notice, onBack, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ratio = window.devicePixelRatio || 1
  const stroke = Math.max(2, Math.round(3 * ratio))
  const fontSize = Math.round(18 * ratio)

  const [tool, setTool] = useState<Tool>('arrow')
  const [color, setColor] = useState(COLORS[0])
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [draft, setDraft] = useState<Annotation | null>(null)
  const [textDraft, setTextDraft] = useState<{
    cx: number
    cy: number
    left: number
    top: number
    value: string
  } | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [noticeOpen, setNoticeOpen] = useState(true)

  const draggingRef = useRef(false)

  // ── drawing ────────────────────────────────────────────────────────────────
  const drawOne = useCallback(
    (ctx: CanvasRenderingContext2D, a: Annotation) => {
      ctx.save()
      switch (a.type) {
        case 'rect': {
          ctx.strokeStyle = a.color
          ctx.lineWidth = stroke
          ctx.strokeRect(a.x, a.y, a.w, a.h)
          break
        }
        case 'arrow': {
          const { x1, y1, x2, y2 } = a
          ctx.strokeStyle = a.color
          ctx.fillStyle = a.color
          ctx.lineWidth = stroke
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.lineTo(x2, y2)
          ctx.stroke()
          const angle = Math.atan2(y2 - y1, x2 - x1)
          const head = Math.max(10, stroke * 4)
          ctx.beginPath()
          ctx.moveTo(x2, y2)
          ctx.lineTo(
            x2 - head * Math.cos(angle - Math.PI / 6),
            y2 - head * Math.sin(angle - Math.PI / 6)
          )
          ctx.lineTo(
            x2 - head * Math.cos(angle + Math.PI / 6),
            y2 - head * Math.sin(angle + Math.PI / 6)
          )
          ctx.closePath()
          ctx.fill()
          break
        }
        case 'text': {
          ctx.fillStyle = a.color
          ctx.font = `600 ${a.size}px 'Space Grotesk', sans-serif`
          ctx.textBaseline = 'top'
          a.text.split('\n').forEach((line, i) => {
            ctx.fillText(line, a.x, a.y + i * a.size * 1.25)
          })
          break
        }
        case 'freehand': {
          if (a.points.length < 2) break
          ctx.strokeStyle = a.color
          ctx.lineWidth = stroke
          ctx.lineJoin = 'round'
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(a.points[0].x, a.points[0].y)
          for (const p of a.points.slice(1)) ctx.lineTo(p.x, p.y)
          ctx.stroke()
          break
        }
        case 'blackout': {
          // A flat fill on the same canvas the export reads, so the pixels underneath are
          // gone from the moment it is drawn — there is no layer to peel off in the PNG.
          ctx.fillStyle = BLACKOUT_FILL
          ctx.fillRect(
            Math.min(a.x, a.x + a.w),
            Math.min(a.y, a.y + a.h),
            Math.abs(a.w),
            Math.abs(a.h)
          )
          break
        }
        case 'pixelate': {
          const x = Math.round(Math.min(a.x, a.x + a.w))
          const y = Math.round(Math.min(a.y, a.y + a.h))
          const w = Math.max(1, Math.round(Math.abs(a.w)))
          const h = Math.max(1, Math.round(Math.abs(a.h)))
          const bs = pixelateBlockSize(ratio)
          const tmp = document.createElement('canvas')
          tmp.width = Math.max(1, Math.floor(w / bs))
          tmp.height = Math.max(1, Math.floor(h / bs))
          const tctx = tmp.getContext('2d')
          if (!tctx) break
          tctx.imageSmoothingEnabled = false
          // Sample from the pristine base image so redaction is irreversible.
          tctx.drawImage(image, x, y, w, h, 0, 0, tmp.width, tmp.height)
          ctx.imageSmoothingEnabled = false
          ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, w, h)
          ctx.imageSmoothingEnabled = true
          break
        }
      }
      ctx.restore()
    },
    [stroke, ratio, image]
  )

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0)
    for (const a of annotations) drawOne(ctx, a)
    if (draft) drawOne(ctx, draft)
  }, [image, annotations, draft, drawOne])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = image.width
    canvas.height = image.height
  }, [image])

  useEffect(() => {
    redraw()
  }, [redraw])

  // ── pointer → canvas coordinate mapping ──────────────────────────────────────
  function toCanvasCoords(e: React.PointerEvent): Point {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || textDraft) return
    const { x, y } = toCanvasCoords(e)
    if (tool === 'text') {
      setTextDraft({ cx: x, cy: y, left: e.clientX, top: e.clientY, value: '' })
      return
    }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    draggingRef.current = true
    if (tool === 'rect') setDraft({ type: 'rect', x, y, w: 0, h: 0, color })
    else if (tool === 'pixelate') setDraft({ type: 'pixelate', x, y, w: 0, h: 0 })
    else if (tool === 'blackout') setDraft({ type: 'blackout', x, y, w: 0, h: 0 })
    else if (tool === 'arrow') setDraft({ type: 'arrow', x1: x, y1: y, x2: x, y2: y, color })
    else if (tool === 'freehand') setDraft({ type: 'freehand', points: [{ x, y }], color })
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return
    const { x, y } = toCanvasCoords(e)
    setDraft((d) => {
      if (!d) return d
      if (d.type === 'rect' || d.type === 'pixelate' || d.type === 'blackout') {
        return { ...d, w: x - d.x, h: y - d.y }
      }
      if (d.type === 'arrow') return { ...d, x2: x, y2: y }
      if (d.type === 'freehand') return { ...d, points: [...d.points, { x, y }] }
      return d
    })
  }

  function commitDraft() {
    draggingRef.current = false
    setDraft((d) => {
      if (!d) return null
      if (isWorthKeeping(d)) setAnnotations((prev) => [...prev, normalizeRect(d)])
      return null
    })
  }

  function commitText() {
    setTextDraft((t) => {
      if (t && t.value.trim()) {
        const value = t.value
        setAnnotations((prev) => [
          ...prev,
          { type: 'text', x: t.cx, y: t.cy, text: value, color, size: fontSize },
        ])
      }
      return null
    })
  }

  function undo() {
    setAnnotations((prev) => prev.slice(0, -1))
  }

  // ── exits ────────────────────────────────────────────────────────────────────
  async function doExit(fn: () => Promise<string>) {
    if (busy) return
    setBusy(true)
    try {
      const msg = await fn()
      setStatus(msg)
      setTimeout(onClose, 900)
    } catch (err) {
      setStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`)
      setBusy(false)
    }
  }

  const onSave = () =>
    doExit(async () => {
      const blob = await toBlob(canvasRef.current!)
      const path = await saveScreenshot(blob)
      return `Saved to ~/${path}`
    })

  const onCopy = () =>
    doExit(async () => {
      const blob = await toBlob(canvasRef.current!)
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      return 'Copied to clipboard'
    })

  // Brief 95: the two apps are a pipeline — annotate here, edit properly there.
  const onEditInPaint = () =>
    doExit(() => {
      openApp('paint', { dataUrl: canvasRef.current!.toDataURL('image/png') })
      return Promise.resolve('Opened in Paint')
    })

  const onDownload = () =>
    doExit(async () => {
      const blob = await toBlob(canvasRef.current!)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = screenshotFilename()
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
      return 'Downloaded'
    })

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (textDraft) return
      if (e.key === 'Escape') onBack()
      else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [textDraft, onBack])

  const tbBtn =
    'flex h-8 w-8 items-center justify-center border outline-none transition-colors ' +
    'border-outline-variant text-on-surface hover:bg-surface-container-high ' +
    'focus-visible:ring-primary focus-visible:ring-2 focus-visible:ring-inset'

  return (
    <div
      data-snip-overlay
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(10,10,12,0.92)',
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      {/* Win7-classic toolbar */}
      <div className="bg-surface-container-low border-outline-variant flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <span className="text-on-surface mr-1 text-[12px] font-bold tracking-tight">
          Snipping<span className="text-primary">Tool</span>
        </span>

        {/* tools */}
        <div className="flex items-center gap-1">
          {TOOLS.map(({ id, label, Icon }) => (
            <button
              key={id}
              title={label}
              onClick={() => setTool(id)}
              className={cn(tbBtn, tool === id && 'bg-surface-container-high border-primary')}
            >
              <Icon size={15} strokeWidth={1.75} />
            </button>
          ))}
        </div>

        <div className="bg-outline-variant mx-1 h-6 w-px" />

        {/* color swatch */}
        <div className="flex items-center gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              title={c}
              onClick={() => setColor(c)}
              className={cn(
                'h-6 w-6 border outline-none',
                color === c ? 'border-primary ring-primary ring-1' : 'border-outline-variant'
              )}
              style={{ background: c }}
            />
          ))}
        </div>

        <div className="bg-outline-variant mx-1 h-6 w-px" />

        <button
          title="Undo (Ctrl+Z)"
          onClick={undo}
          disabled={!annotations.length}
          className={cn(tbBtn, !annotations.length && 'cursor-not-allowed opacity-40')}
        >
          <Undo2 size={15} strokeWidth={1.75} />
        </button>

        <div className="flex-1" />

        {/* exits */}
        <div className="flex items-center gap-1">
          <button
            title="Save to ~/Pictures/Screenshots"
            onClick={onSave}
            disabled={busy}
            className={cn(tbBtn, 'w-auto gap-1.5 px-2.5 text-[12px] font-semibold')}
          >
            <Save size={14} strokeWidth={1.75} /> Save
          </button>
          <button
            title={
              canCopy ? 'Copy to clipboard' : 'Clipboard needs a secure context (HTTPS/localhost)'
            }
            onClick={onCopy}
            disabled={busy || !canCopy}
            className={cn(
              tbBtn,
              'w-auto gap-1.5 px-2.5 text-[12px] font-semibold',
              !canCopy && 'cursor-not-allowed opacity-40'
            )}
          >
            <Copy size={14} strokeWidth={1.75} /> Copy
          </button>
          <button
            title="Edit in Paint"
            onClick={onEditInPaint}
            disabled={busy}
            className={cn(tbBtn, 'w-auto gap-1.5 px-2.5 text-[12px] font-semibold')}
          >
            <Palette size={14} strokeWidth={1.75} /> Edit in Paint
          </button>
          <button
            title="Download to this device"
            onClick={onDownload}
            disabled={busy}
            className={cn(tbBtn, 'w-auto gap-1.5 px-2.5 text-[12px] font-semibold')}
          >
            <Download size={14} strokeWidth={1.75} /> Download
          </button>
          <button
            title="Back to capture modes (Esc)"
            aria-label="Back"
            onClick={onBack}
            className={cn(tbBtn)}
          >
            <ArrowLeft size={15} strokeWidth={1.75} />
          </button>
          <button
            title="Close the tool"
            aria-label="Close"
            onClick={onClose}
            className={cn(tbBtn, 'hover:bg-error hover:text-on-error')}
          >
            <X size={15} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {notice && noticeOpen && (
        <div className="border-outline-variant bg-surface-container text-on-surface flex shrink-0 items-start gap-2 border-b px-3 py-2 text-[11px]">
          <AlertTriangle size={14} className="text-primary mt-px shrink-0" strokeWidth={1.75} />
          <span className="flex-1">{notice}</span>
          <button
            type="button"
            aria-label="Dismiss warning"
            className="text-on-surface-variant hover:text-on-surface shrink-0 underline"
            onClick={() => setNoticeOpen(false)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* canvas stage */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={commitDraft}
          style={{
            // Sized against the flex parent, not the viewport. The old
            // `calc(100vh - 140px)` hardcoded the toolbar height — and this toolbar wraps,
            // so at narrow widths it is two or three rows tall and the canvas ran off the
            // bottom of its own stage.
            maxWidth: '100%',
            maxHeight: '100%',
            cursor: tool === 'text' ? 'text' : 'crosshair',
            touchAction: 'none',
            boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
            outline: '1px solid rgba(255,255,255,0.12)',
          }}
        />

        {/* inline text entry */}
        {textDraft && (
          <input
            autoFocus
            value={textDraft.value}
            onChange={(e) => setTextDraft((t) => (t ? { ...t, value: e.target.value } : t))}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitText()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setTextDraft(null)
              }
            }}
            placeholder="Type, then Enter"
            style={{
              position: 'fixed',
              left: textDraft.left,
              top: textDraft.top,
              zIndex: 100001,
              font: '600 16px "Space Grotesk", sans-serif',
              color,
              background: 'rgba(255,255,255,0.95)',
              border: '1px solid var(--accent, #c0263a)',
              padding: '2px 6px',
              outline: 'none',
              minWidth: 120,
            }}
          />
        )}

        {status && (
          <div className="bg-surface-container-high border-outline-variant text-on-surface absolute bottom-4 left-1/2 -translate-x-1/2 border px-4 py-2 text-[12px] font-semibold">
            {status}
          </div>
        )}
      </div>
    </div>
  )
}
