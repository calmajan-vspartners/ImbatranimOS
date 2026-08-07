import { LayoutGrid } from 'lucide-react'
import { ContextMenu, type ContextMenuItem } from '@imbatranim/ui'
import { useWidgetStore } from '../../store/widgetStore'
import { openApp } from '../../intents/openApp'
import { staggeredPosition } from './widgetGeometry'
import { useAvailableWidgets } from './useAvailableWidgets'

/**
 * The desktop's background right-click menu (brief 96; kit-backed and always
 * populated since briefs 105/106).
 *
 * It used to render `null` when no widget app was enabled — but the handler
 * had already `preventDefault`-ed, so the click was silently swallowed. There
 * is always at least Change wallpaper now: `settings` is NON_DISABLEABLE, so
 * that item can never dead-end, and Appearance is its first section.
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
  /** Desktop-layer bounds, used to place a newly added widget. */
  bounds: { width: number; height: number }
  onClose: () => void
}) {
  const available = useAvailableWidgets()
  const placed = useWidgetStore((s) => s.placed)
  const add = useWidgetStore((s) => s.add)
  const remove = useWidgetStore((s) => s.remove)

  const items: ContextMenuItem[] = []

  if (available.length > 0) {
    items.push({
      type: 'custom',
      key: 'header',
      children: (
        <div className="text-on-surface-variant flex items-center gap-1.5 px-3 pt-1 pb-1.5 text-[9px] font-semibold tracking-widest uppercase">
          <LayoutGrid size={10} />
          Widgets
        </div>
      ),
    })
    for (const w of available) {
      const isPlaced = placed.some((p) => p.key === w.key)
      items.push({
        label: w.config.name,
        checked: isPlaced,
        onSelect: () => {
          if (isPlaced) remove(w.key)
          else add(w.key, staggeredPosition(placed.length, w.config.defaultSize, bounds))
        },
      })
    }
    items.push({ type: 'separator' })
  }

  items.push({ label: 'Change wallpaper', onSelect: () => openApp('settings') })

  return <ContextMenu x={x} y={y} items={items} onClose={onClose} label="Desktop menu" />
}

/**
 * The icon right-click menu (brief 106). The desktop had no Open verb at all
 * before this — right-clicking an icon opened the *widgets* menu, because the
 * background handler's `[data-desktop-icon]` guard matched nothing.
 */
export function DesktopIconContextMenu({
  x,
  y,
  selection,
  onOpen,
  onAutoArrange,
  onClose,
}: {
  x: number
  y: number
  /** Every selected icon — Open acts on the whole set, as a real desktop does. */
  selection: string[]
  onOpen: () => void
  onAutoArrange: () => void
  onClose: () => void
}) {
  const items: ContextMenuItem[] = [
    { label: selection.length > 1 ? `Open ${selection.length} items` : 'Open', onSelect: onOpen },
    { type: 'separator' },
    { label: 'Auto-arrange icons', onSelect: onAutoArrange },
  ]
  return <ContextMenu x={x} y={y} items={items} onClose={onClose} label="Icon menu" />
}
