/**
 * Signature capture — a small modal with a draw pad (freehand → vector strokes)
 * and a Type tab (name → rasterised PNG). Produces a {@link SignatureMark} which
 * the editor applies: for the Sign tool the user then drags a rectangle on the
 * page to place it (PageAnnotateLayer → `doc.sign.place`); for a form signature
 * field it fills that field directly.
 *
 * Capture space: strokes are recorded in pad pixels but stored y-UP (flipped),
 * so the engine's bounding-box fit onto the target PDF rect keeps them upright.
 *
 * Rebuilt in the OS design language on the core `Dialog` shell. The pad body is
 * an inner component mounted only while the dialog is open, so each open starts
 * from a clean slate with no render-phase state resets.
 */
import { useRef, useState } from 'react'
import type { JSX } from 'react'
import type { Point, SignatureMark } from '@pdfcore/engine'
import { Button, Dialog, Input } from '@imbatranim/ui'
import { useEditor } from './context'

const PAD_W = 460
const PAD_H = 180

type Tab = 'draw' | 'type'

export function SignatureDialog(): JSX.Element {
  const { signDialogOpen, closeSignDialog, applySignatureMark } = useEditor()

  return (
    <Dialog
      open={signDialogOpen}
      onOpenChange={(o) => {
        if (!o) closeSignDialog()
      }}
      title="Add your signature"
      className="w-[min(520px,92vw)]"
    >
      {signDialogOpen && <SignaturePad onCancel={closeSignDialog} onApply={applySignatureMark} />}
    </Dialog>
  )
}

function SignaturePad({
  onCancel,
  onApply,
}: {
  onCancel: () => void
  onApply: (mark: SignatureMark) => void
}): JSX.Element {
  const [tab, setTab] = useState<Tab>('draw')
  const [typed, setTyped] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const strokes = useRef<Point[][]>([])
  const drawing = useRef(false)

  const clear = () => {
    strokes.current = []
    const c = canvasRef.current
    if (c) {
      const ctx = c.getContext('2d')
      ctx?.clearRect(0, 0, c.width, c.height)
    }
  }

  const padPoint = (e: React.PointerEvent): Point => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const onDown = (e: React.PointerEvent) => {
    drawing.current = true
    try {
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
    } catch {
      /* ignore synthetic/no-pointer */
    }
    strokes.current.push([padPoint(e)])
  }
  const onMove = (e: React.PointerEvent) => {
    if (!drawing.current) return
    const p = padPoint(e)
    const cur = strokes.current[strokes.current.length - 1]
    cur?.push(p)
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx && cur && cur.length >= 2) {
      const a = cur[cur.length - 2]!
      ctx.strokeStyle = '#1c1712'
      ctx.lineWidth = 2.2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
    }
  }
  const onUp = () => {
    drawing.current = false
  }

  const applyDrawn = () => {
    const raw = strokes.current.filter((s) => s.length >= 2)
    if (!raw.length) return
    // Flip y so the fit onto the PDF rect (y-up) stays upright.
    const paths: Point[][] = raw.map((s) => s.map((p) => ({ x: p.x, y: PAD_H - p.y })))
    onApply({ kind: 'vector', paths, width: 2 })
  }

  const applyTyped = async () => {
    const text = typed.trim()
    if (!text) return
    const scale = 2
    const c = document.createElement('canvas')
    c.width = PAD_W * scale
    c.height = PAD_H * scale
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.scale(scale, scale)
    ctx.clearRect(0, 0, PAD_W, PAD_H)
    ctx.fillStyle = '#1c1712'
    ctx.font = '600 64px "Iowan Old Style", Palatino, Georgia, serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillText(text, PAD_W / 2, PAD_H / 2)
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'))
    if (!blob) return
    const bytes = new Uint8Array(await blob.arrayBuffer())
    onApply({ kind: 'image', image: bytes })
  }

  const tabClass = (on: boolean) =>
    'font-ui px-3 py-1.5 text-[12px] font-medium border-b-2 -mb-px ' +
    (on
      ? 'text-on-surface border-primary'
      : 'text-on-surface-variant border-transparent hover:text-on-surface')

  return (
    <div className="flex flex-col gap-3">
      {/* Tabs */}
      <div className="border-outline-variant flex gap-1 border-b" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'draw'}
          className={tabClass(tab === 'draw')}
          onClick={() => setTab('draw')}
        >
          Draw
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'type'}
          className={tabClass(tab === 'type')}
          onClick={() => setTab('type')}
        >
          Type
        </button>
      </div>

      {tab === 'draw' ? (
        <div className="flex flex-col items-center gap-2">
          <canvas
            ref={canvasRef}
            className="border-outline-variant w-full cursor-crosshair touch-none border border-dashed bg-white"
            width={PAD_W}
            height={PAD_H}
            style={{ width: '100%', aspectRatio: `${PAD_W} / ${PAD_H}` }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
          />
          <p className="text-on-surface-variant font-ui text-[11px]">
            Draw your signature, then place it on the page.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Input
            value={typed}
            placeholder="Type your name"
            autoFocus
            onChange={(e) => setTyped(e.target.value)}
          />
          <div
            // Deliberately literal, not a semantic token: this is a preview of
            // ink on paper, and it has to look the same in dark mode as the mark
            // that will land in the PDF. A theme-aware colour here would show
            // the user white ink for a signature that saves as black.
            className="border-outline-variant grid min-h-[90px] place-items-center border border-dashed bg-white text-[2.2rem] font-semibold text-black"
            style={{ fontFamily: '"Iowan Old Style", Palatino, Georgia, serif' }}
            aria-hidden="true"
          >
            {typed || 'Signature'}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-2 pt-1">
        {tab === 'draw' && (
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear
          </Button>
        )}
        <div className="flex-1" />
        <Button variant="default" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void (tab === 'draw' ? applyDrawn() : applyTyped())}
        >
          Use signature
        </Button>
      </div>
    </div>
  )
}
