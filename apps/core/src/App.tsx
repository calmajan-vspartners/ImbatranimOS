import { useEffect, useRef } from 'react'
import { Taskbar } from './shared/components/taskbar'
import { Desktop } from './shared/components/desktop'
import { useWallpaperStore } from './shared/store/wallpaperStore'
import { setMinSizeResolver, useWindowStore } from './shared/store/windowStore'
import { APP_REGISTRY } from './shared/registry/registry'
import { usePaletteStore } from './shared/store/paletteStore'
import { useAppearanceStore, applyAppearance } from './shared/store/appearanceStore'
import { CommandPalette } from './shared/components/CommandPalette'
import { ToastHost } from './shared/components/notifications'
import { BackgroundServices } from './shared/components/BackgroundServices'
import { useDocumentedShortcuts, useRegisteredHotkeys } from './shared/hooks/useRegisteredHotkeys'
import { ShortcutsOverlay } from './shared/components/shortcuts/ShortcutsOverlay'
import { useWindowHotkeys } from './shared/hooks/useWindowHotkeys'
import { useIdleLock } from './shared/hooks/useIdleLock'
import { runStartupApps } from './shared/lib/startup'
import { FilePortalHost } from './system/filePortal'

export default function App() {
  const wallpaper = useWallpaperStore((s) => s.wallpaper)
  const theme = useAppearanceStore((s) => s.theme)
  const accent = useAppearanceStore((s) => s.accent)
  const paletteOpen = usePaletteStore((s) => s.open)
  const setPaletteOpen = usePaletteStore((s) => s.setOpen)
  const openPalette = usePaletteStore((s) => s.openPalette)

  // Reflect the persisted theme + accent onto <html> so the CSS vars resolve.
  useEffect(() => {
    applyAppearance(theme, accent)
  }, [theme, accent])

  useRegisteredHotkeys([
    {
      id: 'global.palette',
      keys: 'mod+k',
      description: 'Open the command palette',
      scope: 'Global',
      handler: () => openPalette(),
    },
  ])

  // Bound per-editor by useSaveHotkey, documented once here — see
  // useDocumentedShortcuts for why it is not registered from the hook itself.
  useDocumentedShortcuts([
    {
      id: 'editing.save',
      keys: 'mod+s',
      description: 'Save the document in the focused editor',
      scope: 'Editing',
    },
    {
      id: 'editing.goto-line',
      keys: 'mod+g',
      description: 'Go to line, in Code Editor',
      scope: 'Editing',
      // Monaco owns this binding and only sees it while the text area has
      // focus. Documented here rather than from the add-on so the row does not
      // appear and vanish as editor windows open and close.
      note: 'Only while the code editor itself has focus',
    },
    {
      id: 'editing.markdown-format',
      keys: 'mod+b',
      description:
        'Format the selection in Markdown Editor (also mod+I, mod+K, mod+E, mod+shift+1-3/7-9)',
      scope: 'Editing',
      // Bound on the Markdown Editor's own textarea so it is focus-scoped, and it
      // deliberately shadows the global mod+K palette binding while that textarea has
      // focus — inserting a link is the more likely intent with a text cursor in a
      // document. Documented here rather than from the add-on so the row does not appear
      // and vanish as editor windows open and close.
      note: 'Only while the Markdown Editor text area has focus',
    },
    {
      id: 'files.toggle-hidden',
      keys: 'mod+h',
      description: 'Show or hide hidden files, in File Manager',
      scope: 'Editing',
      // Bound on the File Manager's own root so it is window-scoped; a global
      // binding would toggle a background window's dotfiles. Documented here so
      // the row does not appear and vanish as File Manager windows open and close.
      note: 'Only while a File Manager window has focus',
    },
  ])

  // SWARM:S4 layout restore boot ──────────────────────────────────────────────
  const restoreLayout = useWindowStore((s) => s.restoreLayout)
  const persistLayout = useWindowStore((s) => s.persistLayout)
  const windows = useWindowStore((s) => s.windows)

  // Restore this tab's layout, then open the startup set (brief 82) — in that
  // order, and in one effect, because the second decision depends on the first.
  //
  // `runStartupApps` opens nothing when the restore brought windows back: those
  // windows *are* this session's arrangement, and re-running the startup list on
  // top of them would double every multi-instance app and steal focus on every
  // reload. It also marks the tab, so closing everything and reloading does not
  // resurrect the set. App mounts behind AuthGate's `prefsReady`, so the list has
  // already been read from the server by the time this runs.
  useEffect(() => {
    // The store learns minSize through this resolver (brief 103) — importing
    // APP_REGISTRY into windowStore would couple it to the manifest graph.
    // Same fallback WindowContainer uses for unknown apps.
    setMinSizeResolver(
      (appId) => APP_REGISTRY.find((a) => a.id === appId)?.minSize ?? { width: 240, height: 180 }
    )
    restoreLayout()
    // The layout may have been saved at a different resolution — re-fit it to
    // the viewport this tab actually has before the first paint settles.
    useWindowStore.getState().reflowToViewport()
    runStartupApps()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fit windows when the browser viewport changes (brief 103) — devtools,
  // half-screen snap of the host window, a projector. Trailing debounce so
  // dragging the browser's resize handle reflows once, not per frame; the
  // 500ms persist debounce below then coalesces the writes.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onResize = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        useWindowStore.getState().reflowToViewport()
      }, 200)
    }
    window.addEventListener('resize', onResize)
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  // Persist layout whenever windows change. Drag/resize mints a new `windows`
  // array ~60x/sec, so writing synchronously on every change would run a
  // JSON.stringify + localStorage.setItem per frame and jank the drag. Debounce
  // to at most one write per 500ms (trailing). Serialization is unchanged —
  // persistLayout() still writes the exact same schema.
  const persistTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (persistTimer.current !== undefined) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => {
      persistTimer.current = undefined
      persistLayout()
    }, 500)

    return () => {
      if (persistTimer.current !== undefined) clearTimeout(persistTimer.current)
    }
  }, [windows]) // eslint-disable-line react-hooks/exhaustive-deps

  // Flush any pending debounced write when the tab is hidden or unloaded so the
  // final drag/resize position is never lost. Registered once for the app's life.
  useEffect(() => {
    const flush = () => {
      if (persistTimer.current !== undefined) {
        clearTimeout(persistTimer.current)
        persistTimer.current = undefined
      }
      persistLayout()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 4c: keyboard window management (Alt+Tab, Mod+W, Mod+M, Mod+Enter)
  useWindowHotkeys()
  // Auto-lock after idle (brief 97) — Settings → Security owns the timeout.
  useIdleLock()
  // ── /SWARM:S4 layout restore boot ──────────────────────────────────────────

  return (
    <div className="bg-surface relative h-screen w-screen overflow-hidden">
      <Desktop wallpaper={wallpaper} />
      <Taskbar />
      {/* Notification toasts (bottom-right, above the taskbar) */}
      <ToastHost />
      {/* The OS file portal (brief 48): system.fs.pick* renders here, once. */}
      <FilePortalHost />
      {/* Desktop-lifetime add-on services — alarms/reminders fire without windows */}
      <BackgroundServices />
      <ShortcutsOverlay />
      {/* SWARM:S3 command palette mount */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      {/* SWARM:S4 layout restore boot */}
    </div>
  )
}
