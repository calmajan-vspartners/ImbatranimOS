import { useEffect, useRef } from 'react'
import { Check, LayoutGrid } from 'lucide-react'
import { cn } from '../../../lib/cn'
import { useWidgetStore } from '../../store/widgetStore'
import { staggeredPosition } from './widgetGeometry'
import { useAvailableWidgets } from './useAvailableWidgets'

/**
 * The desktop's right-click menu (brief 96). Deliberately tiny: its only job
 * today is adding/removing widgets — checked entries are on the desktop, and
 * choosing one toggles it. Grows other verbs only when they earn a place.
 */
export function DesktopContextMenu({
  x,
  y,
  bounds,
  onClose,
}: {
  x: number
  y: number
  bounds: { width: number; height: number }
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const available = useAvailableWidgets()
  const placed = useWidgetStore((s) => s.placed)
  const add = useWidgetStore((s) => s.add)
  const remove = useWidgetStore((s) => s.remove)

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  if (available.length === 0) return null

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Desktop menu"
      className={cn(
        'border-outline-variant bg-surface-container-low absolute z-[9000] w-52 border py-1',
        'shadow-[0_8px_24px_rgba(0,0,0,0.35)]'
      )}
      // Flip away from the edges so the menu never opens clipped.
      style={{
        left: Math.min(x, Math.max(0, bounds.width - 210)),
        top: Math.min(y, Math.max(0, bounds.height - (available.length + 1) * 28 - 16)),
      }}
    >
      <div className="text-on-surface-variant flex items-center gap-1.5 px-3 pt-1 pb-1.5 text-[9px] font-semibold tracking-widest uppercase">
        <LayoutGrid size={10} />
        Widgets
      </div>
      {available.map((w) => {
        const isPlaced = placed.some((p) => p.key === w.key)
        return (
          <button
            key={w.key}
            role="menuitemcheckbox"
            aria-checked={isPlaced}
            onClick={() => {
              if (isPlaced) remove(w.key)
              else add(w.key, staggeredPosition(placed.length, w.config.defaultSize, bounds))
              onClose()
            }}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] outline-none',
              'text-on-surface hover:bg-primary hover:text-on-primary',
              'focus-visible:bg-primary focus-visible:text-on-primary'
            )}
          >
            <span className="flex h-3.5 w-3.5 items-center justify-center">
              {isPlaced && <Check size={12} strokeWidth={2.5} />}
            </span>
            {w.config.name}
          </button>
        )
      })}
    </div>
  )
}
