import { motion } from 'framer-motion'
import { cn } from '../../../lib/cn'
import type { AppConfig } from '../../registry/registry'

type DesktopIconProps = {
  app: AppConfig
  onOpen: () => void
  position: { x: number; y: number }
  onPositionChange: (pos: { x: number; y: number }) => void
  dragConstraints: React.RefObject<HTMLDivElement | null>
  /**
   * Selection is owned by Desktop (brief 106) — it is a set across icons now
   * (marquee, Ctrl+click), which no per-icon `useState` can express. It is also
   * deliberately ephemeral: the desktop store persists to a dotfile, and a
   * selection surviving a reload would be a bug, not a feature.
   */
  selected: boolean
  onSelect: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
}

// Icon footprint, used to keep a dropped icon fully inside the desktop. Width is
// the fixed `w-[64px]`; height is the icon box + gap + a two-line label.
const ICON_WIDTH = 64
const ICON_HEIGHT = 80

export function DesktopIcon({
  app,
  onOpen,
  position,
  onPositionChange,
  dragConstraints,
  selected,
  onSelect,
  onContextMenu,
}: DesktopIconProps) {
  const Icon = app.icon

  return (
    <motion.div
      drag
      dragConstraints={dragConstraints}
      dragMomentum={false}
      dragElastic={0}
      onDragEnd={(_, info) => {
        // Persist the CLAMPED point, not the raw pointer delta. `dragConstraints`
        // only limits what is drawn during the drag; `info.offset` is the full
        // pointer movement, so a flick past the edge would otherwise be stored
        // (and pinned) out of bounds and redraw off-screen, unrecoverable.
        const el = dragConstraints.current
        let x = position.x + info.offset.x
        let y = position.y + info.offset.y
        if (el) {
          x = Math.max(0, Math.min(x, el.clientWidth - ICON_WIDTH))
          y = Math.max(0, Math.min(y, el.clientHeight - ICON_HEIGHT))
        }
        onPositionChange({ x, y })
      }}
      initial={false}
      animate={{ x: position.x, y: position.y }}
      whileDrag={{ scale: 1.05, zIndex: 10 }}
      className={cn(
        'absolute top-0 left-0 flex w-[64px] cursor-default flex-col items-center gap-1 select-none',
        'focus-visible:ring-primary outline-none focus-visible:ring-2'
      )}
      role="button"
      aria-label={app.name}
      aria-pressed={selected}
      tabIndex={0}
      // Stop the bubble in both directions: a press on an icon must never
      // start the desktop's marquee, and a right-click here opens the ICON
      // menu, not the background one.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(e)
      }}
      onDoubleClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(e)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      {/* Icon box */}
      <div
        className={cn(
          'flex h-12 w-12 items-center justify-center border transition-colors',
          selected
            ? 'border-primary bg-primary text-on-primary'
            : 'border-outline-variant bg-surface-container-low/80 text-on-surface backdrop-blur-sm'
        )}
      >
        <Icon size={22} strokeWidth={1.5} className="text-current" />
      </div>

      {/* Label */}
      <span
        className={cn(
          'font-ui text-center leading-tight',
          'w-full overflow-hidden px-1 py-0.5 text-[11px]',
          'line-clamp-2 break-words',
          selected
            ? 'bg-primary text-on-primary'
            : 'text-on-surface [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]'
        )}
      >
        {app.name}
      </span>
    </motion.div>
  )
}
