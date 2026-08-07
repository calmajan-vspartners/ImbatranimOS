import { useState, useRef } from 'react'
import { useShallow } from 'zustand/shallow'
import { Search } from 'lucide-react'
import { cn } from '../../../lib/cn'
import {
  TASKBAR_HEIGHT,
  topVisibleWindowId,
  useWindowStore,
  type WorkspaceId,
} from '../../store/windowStore'
import { usePaletteStore } from '../../store/paletteStore'
import { APP_REGISTRY } from '../../registry/registry'
import { openApp } from '../../intents/openApp'
import { Logo } from '../brand/Logo'
import { StartMenu } from './StartMenu'
import { Tray } from './Tray'
import { WorkspacePips } from './WorkspacePips'
import { TaskbarContextMenu } from './TaskbarContextMenu'

// Field separator for the task-button projection; cannot occur in a uuid, slug,
// or realistic window title. Title goes last and is rejoined so a stray one is harmless.
const SEP = '␟'

export function Taskbar() {
  const showWindow = useWindowStore((s) => s.showWindow)
  const hideWindow = useWindowStore((s) => s.hideWindow)
  const maximizeWindow = useWindowStore((s) => s.maximizeWindow)
  const restoreWindow = useWindowStore((s) => s.restoreWindow)
  const focusWindow = useWindowStore((s) => s.focusWindow)
  const closeWindow = useWindowStore((s) => s.closeWindow)
  const moveWindowToWorkspace = useWindowStore((s) => s.moveWindowToWorkspace)
  const activeWorkspace = useWindowStore((s) => s.activeWorkspace)
  const openPalette = usePaletteStore((s) => s.openPalette)

  const [startOpen, setStartOpen] = useState(false)
  const startBtnRef = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)

  // Project only what a task button renders (id/appId/visibility/workspace/title)
  // — NOT position or size — so a drag/resize does not re-render the whole
  // taskbar every frame. `useShallow` caches the array while those strings are
  // unchanged; projecting to objects would defeat it (never shallow-equal).
  const allTasks = useWindowStore(
    useShallow((s) =>
      s.windows.map(
        (w) =>
          `${w.id}${SEP}${w.appId}${SEP}${w.isVisible ? 1 : 0}${SEP}${w.isMaximized ? 1 : 0}${SEP}${w.workspaceId}${SEP}${w.title}`
      )
    )
  ).map((k) => {
    const [id, appId, isVisible, isMaximized, workspaceId, ...titleParts] = k.split(SEP)
    return {
      id,
      appId,
      isVisible: isVisible === '1',
      isMaximized: isMaximized === '1',
      workspaceId: Number(workspaceId) as WorkspaceId,
      title: titleParts.join(SEP),
    }
  })

  // Only the current workspace's windows get a button — that is what a taskbar
  // per virtual desktop means (brief 85). The others are reachable via their pip.
  const visibleWindows = allTasks.filter((w) => w.workspaceId === activeWorkspace)

  // Focus from the shared, workspace-scoped helper (topmost visible window on the
  // active desktop). Selecting the derived id keeps this re-rendering only when
  // focus changes, not on every drag frame.
  const focusedId = useWindowStore(() => topVisibleWindowId())

  const menuWindow = menu ? allTasks.find((w) => w.id === menu.id) : undefined

  /**
   * Start-menu launch, through the shared `openApp`.
   *
   * Was `openWindow` directly, which bypassed the single-instance check — see
   * the same fix in `Desktop.tsx`. Two launchers had each grown their own
   * three-line version of "open an app", and both were missing the rule.
   */
  function launchApp(appId: string) {
    openApp(appId)
  }

  function handleTaskClick(id: string) {
    const win = useWindowStore.getState().windows.find((w) => w.id === id)
    if (!win) return
    if (!win.isVisible) {
      showWindow(id)
      focusWindow(id)
    } else if (win.id === topVisibleWindowId()) {
      hideWindow(id) // minimize the focused window
    } else {
      focusWindow(id)
    }
  }

  return (
    <div
      data-testid="taskbar"
      className="border-outline-variant bg-surface-container-low font-ui fixed inset-x-0 bottom-0 z-[9000] flex items-stretch border-t"
      style={{ height: TASKBAR_HEIGHT }}
    >
      {/* Start button */}
      <button
        ref={startBtnRef}
        onClick={() => setStartOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={startOpen}
        aria-label="Start"
        className={cn(
          'group relative flex items-center gap-2 px-4 outline-none',
          'border-outline-variant border-r',
          'hover:bg-surface-container-high',
          'focus-visible:ring-primary focus-visible:ring-2 focus-visible:ring-inset',
          startOpen && 'bg-surface-container-high'
        )}
      >
        {/* accent edge when open */}
        <span
          className={cn(
            'bg-primary absolute inset-x-0 top-0 h-[2px] transition-opacity',
            startOpen ? 'opacity-100' : 'opacity-0'
          )}
        />
        <Logo size={22} className="text-on-surface" />
        <span className="text-on-surface text-[13px] font-bold tracking-tight">
          Imbatranim<span className="text-primary">OS</span>
        </span>
      </button>

      {startOpen && (
        <StartMenu
          anchorRef={startBtnRef}
          onClose={() => setStartOpen(false)}
          onOpenApp={launchApp}
        />
      )}

      {/* Search launcher — opens the command palette (also Mod+K) */}
      <button
        onClick={openPalette}
        aria-label="Search"
        title="Search (Ctrl+K)"
        className={cn(
          'group relative flex items-center gap-2 px-3 outline-none',
          'border-outline-variant border-r',
          'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high',
          'focus-visible:ring-primary focus-visible:ring-2 focus-visible:ring-inset'
        )}
      >
        <Search size={16} strokeWidth={1.75} className="shrink-0" />
      </button>

      {/* Running-window buttons */}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1.5">
        {visibleWindows.map((win) => {
          const app = APP_REGISTRY.find((a) => a.id === win.appId)
          const Icon = app?.icon
          const isFocused = win.id === focusedId
          const minimized = !win.isVisible
          return (
            <button
              key={win.id}
              onClick={() => handleTaskClick(win.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ id: win.id, x: e.clientX, y: e.clientY })
              }}
              title={win.title}
              className={cn(
                'relative flex h-[34px] max-w-[168px] min-w-[44px] shrink-0 items-center gap-2 px-2.5 outline-none',
                'border border-transparent text-[12px]',
                'focus-visible:ring-primary focus-visible:ring-2 focus-visible:ring-inset',
                isFocused
                  ? 'border-outline-variant bg-surface-container-high text-on-surface'
                  : minimized
                    ? 'text-on-surface-variant hover:bg-surface-container'
                    : 'text-on-surface hover:bg-surface-container'
              )}
            >
              {/* focus indicator — accent bar along the bottom */}
              <span
                className={cn(
                  'bg-primary absolute inset-x-0 bottom-0 h-[2px] transition-opacity',
                  isFocused ? 'opacity-100' : 'opacity-0'
                )}
              />
              {Icon && (
                <Icon
                  size={15}
                  strokeWidth={1.75}
                  className={cn('shrink-0', minimized && 'opacity-60')}
                />
              )}
              <span className={cn('truncate', minimized && 'opacity-60')}>{win.title}</span>
            </button>
          )
        })}
      </div>

      <WorkspacePips />

      {/* System tray */}
      <div className="border-outline-variant flex items-stretch border-l">
        <Tray />
      </div>

      {menu && menuWindow && (
        <TaskbarContextMenu
          x={menu.x}
          y={menu.y}
          windowTitle={menuWindow.title}
          currentWorkspace={menuWindow.workspaceId}
          isMaximized={menuWindow.isMaximized}
          onMoveToWorkspace={(id: WorkspaceId) => {
            moveWindowToWorkspace(menu.id, id)
            setMenu(null)
          }}
          onToggleMaximize={() => {
            if (menuWindow.isMaximized) {
              restoreWindow(menu.id)
            } else {
              maximizeWindow(menu.id)
            }
            setMenu(null)
          }}
          onMinimize={() => {
            hideWindow(menu.id)
            setMenu(null)
          }}
          onClose={() => {
            closeWindow(menu.id)
            setMenu(null)
          }}
          onDismiss={() => setMenu(null)}
        />
      )}
    </div>
  )
}
