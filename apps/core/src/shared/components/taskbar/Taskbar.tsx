import { useState, useRef, useMemo } from 'react'
import { Search } from 'lucide-react'
import { cn } from '../../../lib/cn'
import { useWindowStore } from '../../store/windowStore'
import { usePaletteStore } from '../../store/paletteStore'
import { APP_REGISTRY } from '../../registry/registry'
import { Logo } from '../brand/Logo'
import { StartMenu } from './StartMenu'
import { Tray } from './Tray'

export const TASKBAR_HEIGHT = 44

export function Taskbar() {
  const windows = useWindowStore((s) => s.windows)
  const openWindow = useWindowStore((s) => s.openWindow)
  const showWindow = useWindowStore((s) => s.showWindow)
  const hideWindow = useWindowStore((s) => s.hideWindow)
  const focusWindow = useWindowStore((s) => s.focusWindow)
  const openPalette = usePaletteStore((s) => s.openPalette)

  const [startOpen, setStartOpen] = useState(false)
  const startBtnRef = useRef<HTMLButtonElement>(null)

  // The focused window is the topmost visible one.
  const focusedId = useMemo(() => {
    const visible = windows.filter((w) => w.isVisible)
    if (visible.length === 0) return null
    return visible.reduce((top, w) => (w.zIndex > top.zIndex ? w : top)).id
  }, [windows])

  function openApp(appId: string) {
    const app = APP_REGISTRY.find((a) => a.id === appId)
    if (!app) return
    openWindow(app.id, app.name, app.defaultSize, app.minSize)
  }

  function handleTaskClick(id: string) {
    const win = windows.find((w) => w.id === id)
    if (!win) return
    if (!win.isVisible) {
      showWindow(id)
      focusWindow(id)
    } else if (win.id === focusedId) {
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
          onOpenApp={openApp}
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
        {windows.map((win) => {
          const app = APP_REGISTRY.find((a) => a.id === win.appId)
          const Icon = app?.icon
          const isFocused = win.id === focusedId
          const minimized = !win.isVisible
          return (
            <button
              key={win.id}
              onClick={() => handleTaskClick(win.id)}
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

      {/* System tray */}
      <div className="border-outline-variant flex items-stretch border-l">
        <Tray />
      </div>
    </div>
  )
}
