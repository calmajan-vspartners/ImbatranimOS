import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { DesktopIcon } from './DesktopIcon'
import { APP_REGISTRY } from '../../registry/registry'
import { useEnabledApps } from '../../registry/enabledApps'
import { TASKBAR_HEIGHT, useWindowStore } from '../../store/windowStore'
import { useDesktopStore } from '../../store/desktopStore'
import { layoutIcons } from './layoutIcons'
import type { Wallpaper } from '../../store/wallpaperStore'
import { WindowContainer } from '../window/WindowContainer'
import { WidgetLayer } from './WidgetLayer'
import { DesktopContextMenu } from './DesktopContextMenu'
import { useElementSize } from '../../hooks/useElementSize'

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
  // Widgets clamp against the live desktop bounds (brief 96).
  const [desktopSize, sizeRef] = useElementSize()
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)

  // The icons actually drawn — `settings` lives in the Start menu, not on the
  // desktop, so it must not consume a grid cell (it used to, leaving a hole).
  const desktopApps = useMemo(
    () => enabledApps.filter((app) => app.id !== 'settings'),
    [enabledApps]
  )

  // Every enabled app that contributes a desktop layer. Keyed by app id so a
  // roster change cannot remount an unrelated layer.
  const desktopLayers = useMemo(
    () =>
      enabledApps
        .filter((app) => app.desktopLayer !== undefined)
        .map((app) => ({ id: app.id, Layer: app.desktopLayer! })),
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

  const bounds = {
    width: desktopSize.width || window.innerWidth,
    height: desktopSize.height || window.innerHeight - TASKBAR_HEIGHT,
  }

  return (
    <div
      ref={(el) => {
        containerRef.current = el
        sizeRef(el)
      }}
      className="absolute top-0 right-0 bottom-[44px] left-0 w-full overflow-hidden"
      style={WALLPAPER_STYLES[wallpaper]}
      onContextMenu={(e) => {
        // The desktop's own menu (widgets). Only for the background — an icon
        // or a layer element keeps the browser/default behaviour it had.
        if (
          e.target !== e.currentTarget &&
          (e.target as HTMLElement).closest('[data-desktop-icon], [data-widget]')
        )
          return
        e.preventDefault()
        const rect = e.currentTarget.getBoundingClientRect()
        setMenuAt({ x: e.clientX - rect.left, y: e.clientY - rect.top })
      }}
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

      {/*
        Add-on desktop layers (brief 74's sticky notes, and anything later).

        Above the icon grid on purpose: that grid is an `inset-0` div, so anything
        below it would never receive a click. The wrapper is `pointer-events-none`
        so the layer cannot swallow clicks meant for the wallpaper or an icon —
        each layer opts back in on its own elements. Wrapped in Suspense because a
        layer may be lazy, and mounted for every enabled app whether or not its
        window is open, which is the whole point of a desktop surface.
      */}
      <div className="pointer-events-none absolute inset-0">
        <Suspense fallback={null}>
          {desktopLayers.map(({ id, Layer }) => (
            <Layer key={id} />
          ))}
        </Suspense>
      </div>

      {/* Hosted widgets (brief 96) — same stacking slot as the add-on layers:
          above the icon grid, below every window. */}
      <div className="pointer-events-none absolute inset-0">
        <WidgetLayer bounds={bounds} />
      </div>

      {menuAt && (
        <DesktopContextMenu
          x={menuAt.x}
          y={menuAt.y}
          bounds={bounds}
          onClose={() => setMenuAt(null)}
        />
      )}

      <WindowContainer />
    </div>
  )
}
