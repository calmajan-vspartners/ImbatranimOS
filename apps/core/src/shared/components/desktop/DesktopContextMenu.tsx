import { LayoutGrid } from 'lucide-react'
import { ContextMenu, type ContextMenuItem } from '@imbatranim/ui'
import { useWidgetStore } from '../../store/widgetStore'
import { staggeredPosition } from './widgetGeometry'
import { useAvailableWidgets } from './useAvailableWidgets'

/**
 * The desktop's right-click menu (brief 96; kit-backed since brief 105). Its
 * only job today is adding/removing widgets — checked entries are on the
 * desktop, and choosing one toggles it. The widget entries are real
 * `menuitemcheckbox` items now, and edge clamping comes from the kit's
 * positioner instead of the old height-estimate arithmetic. Grows other verbs
 * only when they earn a place (brief 106).
 */
export function DesktopContextMenu({
  x,
  y,
  bounds,
  onClose,
}: {
  /** Viewport coordinates — the kit menu positions in viewport space. */
  x: number
  y: number
  /** Desktop-layer bounds, still used to place a newly added widget. */
  bounds: { width: number; height: number }
  onClose: () => void
}) {
  const available = useAvailableWidgets()
  const placed = useWidgetStore((s) => s.placed)
  const add = useWidgetStore((s) => s.add)
  const remove = useWidgetStore((s) => s.remove)

  if (available.length === 0) return null

  const items: ContextMenuItem[] = [
    {
      type: 'custom',
      key: 'header',
      children: (
        <div className="text-on-surface-variant flex items-center gap-1.5 px-3 pt-1 pb-1.5 text-[9px] font-semibold tracking-widest uppercase">
          <LayoutGrid size={10} />
          Widgets
        </div>
      ),
    },
    ...available.map((w): ContextMenuItem => {
      const isPlaced = placed.some((p) => p.key === w.key)
      return {
        label: w.config.name,
        checked: isPlaced,
        onSelect: () => {
          if (isPlaced) remove(w.key)
          else add(w.key, staggeredPosition(placed.length, w.config.defaultSize, bounds))
        },
      }
    }),
  ]

  return <ContextMenu x={x} y={y} items={items} onClose={onClose} label="Desktop menu" />
}
