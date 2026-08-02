import { useEffect, useMemo, useRef } from 'react'
import { DesktopIcon } from './DesktopIcon'
import { APP_REGISTRY } from '../../registry/registry'
import { useEnabledApps } from '../../registry/enabledApps'
import { TASKBAR_HEIGHT, useWindowStore } from '../../store/windowStore'
import { useDesktopStore } from '../../store/desktopStore'
import { layoutIcons } from './layoutIcons'
import type { Wallpaper } from '../../store/wallpaperStore'
import { WindowContainer } from '../window/WindowContainer'

type DesktopProps = {
  wallpaper: Wallpaper
}

// Theme-aware wallpapers — pattern lines use the active outline token, base uses
// the active surface token, so both light and dark read correctly.
const WALLPAPER_STYLES: Record<Wallpaper, React.CSSProperties> = {
  dots: {
    backgroundImage: 'radial-gradient(var(--k-outline-variant) 1px, transparent 1px)',
    backgroundSize: '22px 22px',
    backgroundColor: 'var(--k-surface)',
  },
  grid: {
    backgroundImage:
      'linear-gradient(var(--k-outline-variant) 1px, transparent 1px), linear-gradient(90deg, var(--k-outline-variant) 1px, transparent 1px)',
    backgroundSize: '32px 32px',
    backgroundColor: 'var(--k-surface)',
  },
  linen: {
    backgroundColor: 'var(--k-surface)',
    backgroundImage:
      'radial-gradient(var(--k-outline-variant) 0.5px, transparent 0.5px), radial-gradient(var(--k-outline-variant) 0.5px, var(--k-surface) 0.5px)',
    backgroundSize: '8px 8px',
    backgroundPosition: '0 0, 4px 4px',
  },
}

export function Desktop({ wallpaper }: DesktopProps) {
  const openWindow = useWindowStore((s) => s.openWindow)
  const enabledApps = useEnabledApps()
  const iconPositions = useDesktopStore((s) => s.iconPositions)
  const updateIconPosition = useDesktopStore((s) => s.updateIconPosition)
  const setAutoPositions = useDesktopStore((s) => s.setAutoPositions)
  const containerRef = useRef<HTMLDivElement>(null)

  // The icons actually drawn — `settings` lives in the Start menu, not on the
  // desktop, so it must not consume a grid cell (it used to, leaving a hole).
  const desktopApps = useMemo(
    () => enabledApps.filter((app) => app.id !== 'settings'),
    [enabledApps]
  )
  // A primitive, not an array: `useEnabledApps()` returns a fresh array on every
  // render, so an array dependency here re-ran the effect, which wrote to the
  // store, which re-rendered — an infinite loop.
  const appIdsKey = desktopApps.map((a) => a.id).join(',')

  // Auto-place every non-pinned icon, and re-place on viewport or roster
  // changes. Reading the store imperatively keeps `iconPositions` out of the
  // dependency list, so writing positions cannot re-trigger this effect.
  useEffect(() => {
    const place = () => {
      const el = containerRef.current
      const current = useDesktopStore.getState().iconPositions
      const pinned: Record<string, { x: number; y: number }> = {}
      for (const [id, pos] of Object.entries(current)) {
        if (pos.pinned) pinned[id] = { x: pos.x, y: pos.y }
      }
      setAutoPositions(
        layoutIcons(appIdsKey ? appIdsKey.split(',') : [], pinned, {
          width: el?.clientWidth ?? window.innerWidth,
          height: el?.clientHeight ?? window.innerHeight - TASKBAR_HEIGHT,
        })
      )
    }

    place()
    let frame = 0
    const onResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(place)
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [appIdsKey, setAutoPositions])

  function handleOpen(appId: string) {
    const app = APP_REGISTRY.find((a) => a.id === appId)
    if (!app) return
    openWindow(app.id, app.name, app.defaultSize, app.minSize)
  }

  return (
    <div
      ref={containerRef}
      className="absolute top-0 right-0 bottom-[44px] left-0 w-full overflow-hidden"
      style={WALLPAPER_STYLES[wallpaper]}
    >
      {/* Desktop icon container - using absolute positioning for children */}
      <div className="absolute inset-0 p-4">
        {desktopApps.map((app) => {
          const pos = iconPositions[app.id]
          if (!pos) return null
          return (
            <DesktopIcon
              key={app.id}
              app={app}
              onOpen={() => handleOpen(app.id)}
              position={pos}
              onPositionChange={(newPos) => updateIconPosition(app.id, newPos)}
              dragConstraints={containerRef}
            />
          )
        })}
      </div>

      <WindowContainer />
    </div>
  )
}
