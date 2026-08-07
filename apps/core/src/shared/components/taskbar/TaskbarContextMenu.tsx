import { ContextMenu, type ContextMenuItem } from '@imbatranim/ui'
import { WORKSPACE_IDS, type WorkspaceId } from '../../store/windowStore'
import { cn } from '../../../lib/cn'

/**
 * Right-click menu on a taskbar button (brief 85; kit-backed since brief 105 —
 * the third hand-rolled menu triggered the promote rule, so positioning,
 * dismissal and the keyboard/ARIA contract now come from the shared
 * `ContextMenu`; the old `MENU_WIDTH`/`MENU_HEIGHT` size guesses are gone, the
 * positioner measures and flips above the taskbar on its own). What stays
 * local is the content: a title header and the workspace 1–4 grid ride the
 * kit's custom-row escape hatch.
 */
export function TaskbarContextMenu({
  x,
  y,
  windowTitle,
  currentWorkspace,
  isMaximized,
  onMoveToWorkspace,
  onToggleMaximize,
  onMinimize,
  onClose,
  onDismiss,
}: {
  x: number
  y: number
  windowTitle: string
  currentWorkspace: WorkspaceId
  isMaximized: boolean
  onMoveToWorkspace: (id: WorkspaceId) => void
  onToggleMaximize: () => void
  onMinimize: () => void
  onClose: () => void
  onDismiss: () => void
}) {
  const items: ContextMenuItem[] = [
    {
      type: 'custom',
      key: 'title',
      children: (
        <div className="border-outline-variant text-on-surface-variant truncate border-b px-2.5 py-1.5 text-[11px] font-semibold">
          {windowTitle}
        </div>
      ),
    },
    {
      type: 'custom',
      key: 'workspaces',
      children: (
        <>
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
        </>
      ),
    },
    { type: 'separator' },
    { label: isMaximized ? 'Restore' : 'Maximize', onSelect: onToggleMaximize },
    { label: 'Minimize', onSelect: onMinimize },
    { label: 'Close', onSelect: onClose, danger: true },
  ]

  return (
    <ContextMenu
      x={x}
      y={y}
      items={items}
      onClose={onDismiss}
      label={`Actions for ${windowTitle}`}
    />
  )
}
