import { useEffect, useRef } from 'react'
import { Taskbar } from './shared/components/taskbar'
import { Desktop } from './shared/components/desktop'
import { useWallpaperStore } from './shared/store/wallpaperStore'
import { useWindowStore } from './shared/store/windowStore'
import { usePaletteStore } from './shared/store/paletteStore'
import { useAppearanceStore, applyAppearance } from './shared/store/appearanceStore'
import { CommandPalette } from './shared/components/CommandPalette'
import { ToastHost } from './shared/components/notifications'
import { useDocumentedShortcuts, useRegisteredHotkeys } from './shared/hooks/useRegisteredHotkeys'
import { ShortcutsOverlay } from './shared/components/shortcuts/ShortcutsOverlay'
import { useWindowHotkeys } from './shared/hooks/useWindowHotkeys'

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

  // Restore persisted layout on first mount
  useEffect(() => {
    restoreLayout()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
  // ── /SWARM:S4 layout restore boot ──────────────────────────────────────────

  return (
    <div className="bg-surface relative h-screen w-screen overflow-hidden">
      <Desktop wallpaper={wallpaper} />
      <Taskbar />
      {/* Notification toasts (bottom-right, above the taskbar) */}
      <ToastHost />
      <ShortcutsOverlay />
      {/* SWARM:S3 command palette mount */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      {/* SWARM:S4 layout restore boot */}
    </div>
  )
}
