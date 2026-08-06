import { Suspense, useMemo, useRef } from 'react'
import { WindowlessSystemProvider } from '../../../system/WindowlessSystemProvider'
import { X } from 'lucide-react'
import { useWidgetStore, type PlacedWidget } from '../../store/widgetStore'
import { clampWidget } from './widgetGeometry'
import { useAvailableWidgets, type ResolvedWidget } from './useAvailableWidgets'
import { cn } from '../../../lib/cn'

function WidgetFrame({
  placed,
  widget,
  bounds,
}: {
  placed: PlacedWidget
  widget: ResolvedWidget
  bounds: { width: number; height: number }
}) {
  const move = useWidgetStore((s) => s.move)
  const remove = useWidgetStore((s) => s.remove)
  const frameRef = useRef<HTMLDivElement>(null)
  const origin = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  const clamped = clampWidget(placed, widget.config.defaultSize, bounds)

  // The sticky-notes drag discipline: pointer capture, live preview via
  // style writes, ONE store commit on release.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    // A control inside the widget (a button, a link) owns its own clicks.
    if ((e.target as HTMLElement).closest('button, a, input, select')) return
    e.preventDefault()
    origin.current = { x: clamped.x, y: clamped.y, px: e.clientX, py: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const o = origin.current
    if (!o || !frameRef.current) return
    const next = clampWidget(
      { x: o.x + e.clientX - o.px, y: o.y + e.clientY - o.py },
      widget.config.defaultSize,
      bounds
    )
    frameRef.current.style.left = `${next.x}px`
    frameRef.current.style.top = `${next.y}px`
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const o = origin.current
    if (!o) return
    origin.current = null
    const next = clampWidget(
      { x: o.x + e.clientX - o.px, y: o.y + e.clientY - o.py },
      widget.config.defaultSize,
      bounds
    )
    move(placed.key, next.x, next.y)
  }

  const Component = widget.config.component
  return (
    <div
      ref={frameRef}
      className={cn(
        'group border-outline-variant bg-surface-container-low/90 pointer-events-auto absolute border shadow-sm',
        'cursor-grab select-none active:cursor-grabbing'
      )}
      style={{
        left: clamped.x,
        top: clamped.y,
        width: widget.config.defaultSize.width,
        height: widget.config.defaultSize.height,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <button
        type="button"
        aria-label={`Remove the ${widget.config.name} widget`}
        title="Remove widget"
        onClick={() => remove(placed.key)}
        className={cn(
          'text-on-surface-variant hover:text-on-surface absolute top-0.5 right-0.5 z-10 p-0.5',
          'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
          'focus-visible:ring-primary outline-none focus-visible:ring-2'
        )}
      >
        <X size={12} strokeWidth={2} />
      </button>
      <Suspense fallback={null}>
        <div className="h-full w-full overflow-hidden">
          {/* Windowless handle (brief 48): a widget belongs to its app, not a window. */}
          <WindowlessSystemProvider appId={widget.appId}>
            <Component />
          </WindowlessSystemProvider>
        </div>
      </Suspense>
    </div>
  )
}

/**
 * The hosted-widget layer (brief 96): the second consumer of the desktop
 * surface after sticky notes. Core owns the frame — placement, drag, clamp,
 * persistence, removal — so every widget behaves identically; the add-on owns
 * only the content.
 *
 * Sits with the other desktop layers: above the icon grid (which spans the
 * whole desktop), below every window, inside a `pointer-events-none` wrapper
 * so empty space stays the wallpaper's.
 */
export function WidgetLayer({ bounds }: { bounds: { width: number; height: number } }) {
  const placed = useWidgetStore((s) => s.placed)
  const available = useAvailableWidgets()
  const byKey = useMemo(() => new Map(available.map((w) => [w.key, w])), [available])

  return (
    <>
      {placed.map((p) => {
        const widget = byKey.get(p.key)
        // A disabled add-on's widgets keep their row but do not render.
        if (!widget) return null
        return <WidgetFrame key={p.key} placed={p} widget={widget} bounds={bounds} />
      })}
    </>
  )
}
