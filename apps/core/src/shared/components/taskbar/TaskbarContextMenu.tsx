import { useEffect, useRef } from 'react'
import { WORKSPACE_IDS, type WorkspaceId } from '../../store/windowStore'
import { cn } from '../../../lib/cn'

/**
 * Right-click menu on a taskbar button (brief 85).
 *
 * Deliberately local rather than a promoted core component. File Manager has the
 * only other context menu in the OS, and this is a different shape — a short
 * fixed list with a workspace group, not a data-driven entry menu. Per the
 * repo's own rule, duplication gets promoted on the **third** use; this is the
 * second, and inventing a general menu API for two callers would be the wrong
 * abstraction picked early.
 */
export function TaskbarContextMenu({
  x,
  y,
  windowTitle,
  currentWorkspace,
  onMoveToWorkspace,
  onMinimize,
  onClose,
  onDismiss,
}: {
  x: number
  y: number
  windowTitle: string
  currentWorkspace: WorkspaceId
  onMoveToWorkspace: (id: WorkspaceId) => void
  onMinimize: () => void
  onClose: () => void
  onDismiss: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onDismiss()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    // `pointerdown` rather than `click`: a menu that survives until mouseup can
    // be dismissed by the same press that opens something behind it.
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onDismiss])

  const MENU_WIDTH = 190
  const MENU_HEIGHT = 210
  // Kept on screen: the taskbar is at the bottom, so a menu placed at the
  // pointer would otherwise open straight off the edge.
  const left = Math.min(Math.max(4, x), window.innerWidth - MENU_WIDTH - 4)
  const top = Math.max(4, y - MENU_HEIGHT)

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Actions for ${windowTitle}`}
      style={{ position: 'fixed', left, top, width: MENU_WIDTH, zIndex: 10000 }}
      className="border-outline-variant bg-surface-container text-on-surface border shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
    >
      <div className="border-outline-variant text-on-surface-variant truncate border-b px-2.5 py-1.5 text-[11px] font-semibold">
        {windowTitle}
      </div>
      <div className="text-on-surface-variant px-2.5 pt-1.5 text-[10px] font-semibold tracking-widest uppercase">
        Move to workspace
      </div>
      <div className="flex gap-1 px-2.5 py-1.5">
        {WORKSPACE_IDS.map((id: WorkspaceId) => (
          <button
            key={id}
            role="menuitem"
            disabled={id === currentWorkspace}
            onClick={() => onMoveToWorkspace(id)}
            aria-label={`Move to workspace ${id}`}
            className={cn(
              'border-outline-variant flex h-[24px] flex-1 items-center justify-center border text-[11px] tabular-nums',
              id === currentWorkspace
                ? 'bg-surface-container-high text-on-surface-variant cursor-default'
                : 'hover:bg-primary hover:text-on-primary hover:border-primary'
            )}
          >
            {id}
          </button>
        ))}
      </div>
      <div className="border-outline-variant border-t">
        <MenuRow label="Minimize" onClick={onMinimize} />
        <MenuRow label="Close" onClick={onClose} destructive />
      </div>
    </div>
  )
}

function MenuRow({
  label,
  onClick,
  destructive = false,
}: {
  label: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={cn(
        'block w-full px-2.5 py-1.5 text-left text-[12px]',
        destructive ? 'hover:bg-error hover:text-on-error' : 'hover:bg-surface-container-high'
      )}
    >
      {label}
    </button>
  )
}
