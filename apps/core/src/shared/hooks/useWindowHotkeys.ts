import { useMemo } from 'react'
import { nextWorkspace, useWindowStore } from '../store/windowStore'
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
  /**
   * The windows these hotkeys may act on: visible, and **on the workspace you
   * are looking at** (brief 85).
   *
   * The workspace half applies to all four bindings, not just Alt+Tab. Without
   * it `Ctrl+W` would close, and `Ctrl+M` would minimise, whatever happens to
   * hold the highest z-index anywhere — quite possibly a window on another
   * desktop that the user cannot see and did not mean.
   */
  const getCandidates = () => {
    const { windows, activeWorkspace } = useWindowStore.getState()
    return windows.filter((w) => w.isVisible && w.workspaceId === activeWorkspace)
  }

  const bindings = useMemo(
    () => ({
      cycle: () => {
        const visible = getCandidates()
        if (visible.length === 0) return
        const maxZ = Math.max(...visible.map((w) => w.zIndex))
        const focused = visible.find((w) => w.zIndex === maxZ)
        const sorted = [...visible].sort((a, b) => a.zIndex - b.zIndex)
        if (!focused) {
          focusWindow(sorted[sorted.length - 1].id)
          return
        }
        const idx = sorted.findIndex((w) => w.id === focused.id)
        const next = sorted[(idx + 1) % sorted.length]
        focusWindow(next.id)
      },

      close: () => {
        const visible = getCandidates()
        if (visible.length === 0) return
        const maxZ = Math.max(...visible.map((w) => w.zIndex))
        const focused = visible.find((w) => w.zIndex === maxZ)
        if (focused) closeWindow(focused.id)
      },

      minimise: () => {
        const visible = getCandidates()
        if (visible.length === 0) return
        const maxZ = Math.max(...visible.map((w) => w.zIndex))
        const focused = visible.find((w) => w.zIndex === maxZ)
        if (focused) hideWindow(focused.id)
      },

      // Workspace switching, wrapping at both ends — ← from 1 lands on 4, which
      // is what makes two adjacent workspaces one keypress apart in either
      // direction rather than three.
      prevWorkspace: () => {
        const { activeWorkspace, setActiveWorkspace } = useWindowStore.getState()
        setActiveWorkspace(nextWorkspace(activeWorkspace, -1))
      },

      nextWorkspace: () => {
        const { activeWorkspace, setActiveWorkspace } = useWindowStore.getState()
        setActiveWorkspace(nextWorkspace(activeWorkspace, 1))
      },

      maximise: () => {
        const visible = getCandidates()
        if (visible.length === 0) return
        const maxZ = Math.max(...visible.map((w) => w.zIndex))
        const focused = visible.find((w) => w.zIndex === maxZ)
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
    {
      id: 'workspace.prev',
      keys: 'ctrl+alt+left',
      description: 'Go to the previous workspace',
      scope: 'Window management',
      handler: bindings.prevWorkspace,
    },
    {
      id: 'workspace.next',
      keys: 'ctrl+alt+right',
      description: 'Go to the next workspace',
      scope: 'Window management',
      handler: bindings.nextWorkspace,
    },
  ])
}
