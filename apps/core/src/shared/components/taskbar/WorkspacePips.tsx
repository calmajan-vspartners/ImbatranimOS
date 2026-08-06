import {
  WORKSPACE_IDS,
  useWindowStore,
  workspaceOccupancy,
  type WorkspaceId,
} from '../../store/windowStore'
import { cn } from '../../../lib/cn'

/**
 * Four workspace pips, beside the Tray (brief 85).
 *
 * **Empty workspaces stay visible.** Hiding them until they hold something would
 * make the whole feature undiscoverable to anyone who does not already know it
 * exists — which is everyone, the first time.
 *
 * The occupancy dot is the other half of that: a pip that looks identical
 * whether or not it holds windows makes "where did my editor go?" a matter of
 * clicking through all four.
 */
export function WorkspacePips() {
  const windows = useWindowStore((s) => s.windows)
  const activeWorkspace = useWindowStore((s) => s.activeWorkspace)
  const setActiveWorkspace = useWindowStore((s) => s.setActiveWorkspace)

  const occupancy = workspaceOccupancy(windows)

  return (
    <div
      className="border-outline-variant flex items-center gap-1 border-l px-2"
      role="group"
      aria-label="Workspaces"
    >
      {WORKSPACE_IDS.map((id: WorkspaceId) => {
        const active = id === activeWorkspace
        const count = occupancy[id]
        return (
          <button
            key={id}
            onClick={() => setActiveWorkspace(id)}
            aria-pressed={active}
            aria-label={
              count === 0
                ? `Workspace ${id}, empty`
                : `Workspace ${id}, ${count} window${count === 1 ? '' : 's'}`
            }
            title={`Workspace ${id} (Ctrl+Alt+${id})`}
            className={cn(
              'relative flex h-[22px] w-[22px] items-center justify-center border text-[10px] tabular-nums transition-colors',
              active
                ? 'border-primary bg-primary text-on-primary'
                : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-high'
            )}
          >
            {id}
            {count > 0 && !active && (
              <span className="bg-primary absolute right-[2px] bottom-[2px] h-[3px] w-[3px]" />
            )}
          </button>
        )
      })}
    </div>
  )
}
