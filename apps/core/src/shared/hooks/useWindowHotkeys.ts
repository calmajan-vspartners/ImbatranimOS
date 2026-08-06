import { useMemo } from 'react'
import { topVisibleWindowId, useWindowStore } from '../store/windowStore'
import { useRegisteredHotkeys } from './useRegisteredHotkeys'

/**
 * Keyboard window management (4c).
 *
 * Shortcut map (chosen to avoid browser conflicts):
 *   Alt+Tab        — cycle focus through visible windows
 *   Mod+W          — close focused window
 *   Mod+M          — hide (minimise) focused window
 *   Mod+Enter      — toggle maximize / restore focused window
 *
 * All actions dispatch through existing windowStore methods.
 */
export function useWindowHotkeys(): void {
  const focusWindow = useWindowStore((s) => s.focusWindow)
  const closeWindow = useWindowStore((s) => s.closeWindow)
  const hideWindow = useWindowStore((s) => s.hideWindow)
  const maximizeWindow = useWindowStore((s) => s.maximizeWindow)
  const restoreWindow = useWindowStore((s) => s.restoreWindow)
  const getWindows = () => useWindowStore.getState().windows

  const bindings = useMemo(
    () => ({
      cycle: () => {
        const visible = getWindows().filter((w) => w.isVisible)
        if (visible.length === 0) return
        const focusedId = topVisibleWindowId()
        const sorted = [...visible].sort((a, b) => a.zIndex - b.zIndex)
        if (!focusedId) {
          focusWindow(sorted[sorted.length - 1].id)
          return
        }
        const idx = sorted.findIndex((w) => w.id === focusedId)
        const next = sorted[(idx + 1) % sorted.length]
        focusWindow(next.id)
      },

      close: () => {
        const focusedId = topVisibleWindowId()
        if (focusedId) closeWindow(focusedId)
      },

      minimise: () => {
        const focusedId = topVisibleWindowId()
        if (focusedId) hideWindow(focusedId)
      },

      maximise: () => {
        const focusedId = topVisibleWindowId()
        if (!focusedId) return
        const focused = getWindows().find((w) => w.id === focusedId)
        if (!focused) return
        if (focused.isMaximized) {
          restoreWindow(focused.id)
        } else {
          maximizeWindow(focused.id)
        }
      },
    }),
    [focusWindow, closeWindow, hideWindow, maximizeWindow, restoreWindow]
  )

  useRegisteredHotkeys([
    {
      id: 'window.cycle',
      keys: 'alt+tab',
      description: 'Cycle focus through open windows',
      scope: 'Window management',
      handler: bindings.cycle,
    },
    {
      id: 'window.close',
      keys: 'mod+w',
      description: 'Close the focused window',
      scope: 'Window management',
      // The browser owns Ctrl/Cmd+W for closing the tab; whether the page sees
      // it first is not something the OS can guarantee.
      note: 'The browser may intercept this before the desktop does',
      handler: bindings.close,
    },
    {
      id: 'window.minimise',
      keys: 'mod+m',
      description: 'Minimise the focused window',
      scope: 'Window management',
      handler: bindings.minimise,
    },
    {
      id: 'window.maximise',
      keys: 'mod+enter',
      description: 'Maximise or restore the focused window',
      scope: 'Window management',
      handler: bindings.maximise,
    },
  ])
}
