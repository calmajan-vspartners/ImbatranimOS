import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DesktopIcon } from './DesktopIcon'
import { useEnabledApps } from '../../registry/enabledApps'
import { TASKBAR_HEIGHT } from '../../store/windowStore'
import { useDesktopStore } from '../../store/desktopStore'
import { openApp } from '../../intents/openApp'
import { layoutIcons } from './layoutIcons'
import { iconsInRect, isDrag, normalizeRect, type DragRect } from './marquee'
import { isTextEntry } from '../../hooks/shortcutRegistry'
import type { Wallpaper } from '../../store/wallpaperStore'
import { WindowContainer } from '../window/WindowContainer'
import { WidgetLayer } from './WidgetLayer'
import { WindowlessSystemProvider } from '../../../system/WindowlessSystemProvider'
import { DesktopContextMenu, DesktopIconContextMenu } from './DesktopContextMenu'
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
  const enabledApps = useEnabledApps()
  const iconPositions = useDesktopStore((s) => s.iconPositions)
  const updateIconPosition = useDesktopStore((s) => s.updateIconPosition)
  const setAutoPositions = useDesktopStore((s) => s.setAutoPositions)
  const clearPins = useDesktopStore((s) => s.clearPins)
  const containerRef = useRef<HTMLDivElement>(null)
  const iconLayerRef = useRef<HTMLDivElement>(null)
  // Widgets clamp against the live desktop bounds (brief 96).
  const [desktopSize, sizeRef] = useElementSize()
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const [iconMenuAt, setIconMenuAt] = useState<{ x: number; y: number } | null>(null)
  // Selection is ephemeral component state, never persisted (brief 106).
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  // The live rubber band, in icon-layer coordinates. Null when not dragging.
  const [band, setBand] = useState<DragRect | null>(null)
  const dragRef = useRef<DragRect | null>(null)
  const additiveRef = useRef(false)
  const baseSelectionRef = useRef<Set<string>>(new Set())

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
  // Hoisted out of the effect so Auto-arrange (brief 106) can re-run the exact
  // same placement after clearing pins, instead of duplicating the maths.
  const place = useCallback(() => {
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
  }, [appIdsKey, setAutoPositions])

  useEffect(() => {
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
  }, [place])

  /**
   * Launch through the shared `openApp`, not `openWindow` directly.
   *
   * This called `openWindow` unconditionally, which skipped the single-instance
   * rule that `openApp` exists to enforce — double-clicking Calculator twice
   * gave you two Calculators. Merely untidy before workspaces; with them the
   * duplicate opens on whichever desktop you happen to be on while the original
   * sits invisible on another, so the app looks lost. Found by brief 85's probe.
   */
  function handleOpen(appId: string) {
    openApp(appId)
  }

  /** Open every selected icon (or just this one), the single-instance path. */
  const openSelection = useCallback(
    (fallbackId?: string) => {
      const ids = selected.size > 0 ? [...selected] : fallbackId ? [fallbackId] : []
      for (const id of ids) openApp(id)
      setSelected(new Set())
    },
    [selected]
  )

  const handleAutoArrange = useCallback(() => {
    clearPins()
    place()
  }, [clearPins, place])

  const desktopAppIds = useMemo(() => desktopApps.map((a) => a.id), [desktopApps])

  /**
   * Escape clears the selection, Enter opens it. A window listener, not a
   * handler on the container: after a marquee drag nothing inside the desktop
   * holds focus, so a bubbling handler would never fire. Skipped while typing,
   * and while a focused icon is handling its own Enter.
   */
  useEffect(() => {
    if (selected.size === 0) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (isTextEntry(el)) return
      if (e.key === 'Escape') {
        setSelected(new Set())
      } else if (e.key === 'Enter' && !el?.closest('[role="button"][aria-pressed]')) {
        e.preventDefault()
        openSelection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, openSelection])

  // ── Marquee (the user-filed drag-selection todo) ────────────────────────────
  // Only a press on TRUE background starts one: icons stop their own pointer
  // events, and widgets/notes/windows target other elements entirely.
  const onLayerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    if (e.target !== e.currentTarget) return
    const rect = e.currentTarget.getBoundingClientRect()
    const start = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    dragRef.current = { x1: start.x, y1: start.y, x2: start.x, y2: start.y }
    // Ctrl-drag ADDS to the selection; a plain drag replaces it.
    additiveRef.current = e.ctrlKey || e.metaKey
    baseSelectionRef.current = additiveRef.current ? new Set(selected) : new Set()
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onLayerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const rect = e.currentTarget.getBoundingClientRect()
    const next: DragRect = { ...drag, x2: e.clientX - rect.left, y2: e.clientY - rect.top }
    dragRef.current = next
    if (!isDrag(next)) return
    setBand(next)
    // Live feedback: the hit set is recomputed every move, so icons highlight
    // as the band crosses them.
    const hits = iconsInRect(iconPositions, normalizeRect(next), desktopAppIds)
    setSelected(new Set([...baseSelectionRef.current, ...hits]))
  }

  const endMarquee = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    setBand(null)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    // A press that never became a drag is a plain background click: clear.
    if (drag && !isDrag(drag) && !additiveRef.current) setSelected(new Set())
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
      className="absolute top-0 right-0 left-0 w-full overflow-hidden"
      style={{ ...WALLPAPER_STYLES[wallpaper], bottom: TASKBAR_HEIGHT }}
      onContextMenu={(e) => {
        // Windows are DOM children of this container, so an app that calls
        // preventDefault without stopPropagation (the Terminal's paste,
        // Minesweeper's flag) used to ALSO open this menu on top of its own
        // (brief 106). The old `[data-desktop-icon], [data-widget]` guard
        // could never have caught that — nothing in the repo sets either
        // attribute. `data-window-id` is real (Window.tsx), so window
        // interiors keep whatever their app decided; everything else on the
        // desktop always gets the background menu.
        if ((e.target as HTMLElement).closest('[data-window-id]')) return
        e.preventDefault()
        setIconMenuAt(null)
        // Raw viewport coordinates: the kit menu portals to body and positions
        // in viewport space (brief 105) — the old container-relative math died
        // with the absolutely-positioned local menu.
        setMenuAt({ x: e.clientX, y: e.clientY })
      }}
    >
      {/* Desktop icon container - using absolute positioning for children.
          Also the marquee surface: a press that targets THIS div (not an icon,
          widget, note or window) rubber-band-selects. */}
      <div
        ref={iconLayerRef}
        className="absolute inset-0 p-4"
        onPointerDown={onLayerPointerDown}
        onPointerMove={onLayerPointerMove}
        onPointerUp={endMarquee}
        onPointerCancel={endMarquee}
      >
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
              selected={selected.has(app.id)}
              onSelect={(e) => {
                // Ctrl/⌘+click toggles membership; a plain click selects one.
                setSelected((prev) => {
                  if (!(e.ctrlKey || e.metaKey)) return new Set([app.id])
                  const next = new Set(prev)
                  if (next.has(app.id)) next.delete(app.id)
                  else next.add(app.id)
                  return next
                })
              }}
              onContextMenu={(e) => {
                // Right-click selects the icon it opened on unless it is
                // already part of a multi-selection — the file manager's rule.
                setSelected((prev) => (prev.has(app.id) ? prev : new Set([app.id])))
                setMenuAt(null)
                setIconMenuAt({ x: e.clientX, y: e.clientY })
              }}
            />
          )
        })}

        {band && isDrag(band) && (
          <div
            data-testid="desktop-marquee"
            className="border-primary bg-primary/10 pointer-events-none absolute border"
            style={{
              left: normalizeRect(band).left,
              top: normalizeRect(band).top,
              width: normalizeRect(band).right - normalizeRect(band).left,
              height: normalizeRect(band).bottom - normalizeRect(band).top,
            }}
          />
        )}
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
            // Windowless handle (brief 48): a desktop layer belongs to its app
            // but to no window, exactly like a background service.
            <WindowlessSystemProvider key={id} appId={id}>
              <Layer />
            </WindowlessSystemProvider>
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

      {iconMenuAt && (
        <DesktopIconContextMenu
          x={iconMenuAt.x}
          y={iconMenuAt.y}
          selection={[...selected]}
          onOpen={() => openSelection()}
          onAutoArrange={handleAutoArrange}
          onClose={() => setIconMenuAt(null)}
        />
      )}

      <WindowContainer />
    </div>
  )
}
