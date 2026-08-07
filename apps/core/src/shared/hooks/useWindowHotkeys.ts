import { useMemo } from 'react'
import {
  nextSnapState,
  nextWorkspace,
  topVisibleWindowId,
  useWindowStore,
  WORKSPACE_IDS,
  type SnapKeyDirection,
  type WorkspaceId,
} from '../store/windowStore'
import { useDocumentedShortcuts, useRegisteredHotkeys } from './useRegisteredHotkeys'
import { useGlobalHotkeys } from './useGlobalHotkeys'

/**
 * Keyboard window management (4c; extended by briefs 85 and 103).
 *
 * Shortcut map (chosen to avoid browser conflicts):
 *   Alt+Tab              — the visual switcher, owned by AltTabSwitcher (104)
 *   Mod+W                — close focused window
 *   Mod+M                — hide (minimise) focused window
 *   Mod+Enter            — toggle maximize / restore focused window
 *   Ctrl+Alt+←/→         — previous / next workspace (brief 85)
 *   Ctrl+Alt+1…4         — jump to workspace N (what the pips always promised)
 *   Ctrl+Alt+Shift+1…4   — carry the focused window to workspace N and follow
 *   Mod+Alt+Shift+arrows — keyboard snapping (Windows semantics by sequence).
 *                          NOT mod+alt+arrows: off a mac `mod` IS ctrl, which
 *                          collides with the shipped workspace arrows above.
 *   Ctrl+Alt+D           — show desktop (toggle)
 *
 * All actions dispatch through existing windowStore methods.
 */
export function useWindowHotkeys(): void {
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
      // Alt+Tab moved to the AltTabSwitcher component (brief 104): hold-Alt
      // semantics need a keyup, which this keydown-only plumbing cannot
      // express — and two owners of alt+tab would both fire.

      close: () => {
        const focusedId = topVisibleWindowId()
        if (focusedId) closeWindow(focusedId)
      },

      minimise: () => {
        const focusedId = topVisibleWindowId()
        if (focusedId) hideWindow(focusedId)
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
        const focusedId = topVisibleWindowId()
        if (!focusedId) return
        const focused = getCandidates().find((w) => w.id === focusedId)
        if (!focused) return
        if (focused.isMaximized) {
          restoreWindow(focused.id)
        } else {
          maximizeWindow(focused.id)
        }
      },

      // Keyboard snapping (brief 103): the pure transition table decides, the
      // existing store methods act — no second snap implementation.
      snapKey: (dir: SnapKeyDirection) => {
        const focusedId = topVisibleWindowId()
        if (!focusedId) return
        const focused = getCandidates().find((w) => w.id === focusedId)
        if (!focused) return
        const action = nextSnapState(focused, dir)
        const store = useWindowStore.getState()
        switch (action.type) {
          case 'snap':
            store.snapWindow(focusedId, action.region)
            break
          case 'maximize':
            store.maximizeWindow(focusedId)
            break
          case 'restore':
            store.restoreWindow(focusedId)
            break
          case 'unsnap':
            store.unsnap(focusedId)
            break
          case 'minimize':
            store.hideWindow(focusedId)
            break
          case 'none':
            break
        }
      },

      showDesktop: () => {
        useWindowStore.getState().toggleShowDesktop()
      },

      jumpToWorkspace: (id: WorkspaceId) => {
        useWindowStore.getState().setActiveWorkspace(id)
      },

      carryToWorkspace: (id: WorkspaceId) => {
        const focusedId = topVisibleWindowId()
        if (!focusedId) return
        // moveWindowToWorkspace follows and focuses by design.
        useWindowStore.getState().moveWindowToWorkspace(focusedId, id)
      },
    }),
    [closeWindow, hideWindow, maximizeWindow, restoreWindow]
  )

  // The eight digit bindings, bound individually (the matcher accepts e.code
  // DigitN so shift+1 producing `!` still fires) but documented as two family
  // rows below — eight literal overlay rows would bury the rest of the list.
  useGlobalHotkeys(
    useMemo(() => {
      const digits: Record<string, () => void> = {}
      for (const id of WORKSPACE_IDS) {
        digits[`ctrl+alt+${id}`] = () => bindings.jumpToWorkspace(id)
        digits[`ctrl+alt+shift+${id}`] = () => bindings.carryToWorkspace(id)
      }
      return digits
    }, [bindings])
  )

  useDocumentedShortcuts([
    {
      id: 'workspace.jump',
      keys: 'ctrl+alt+1…4',
      description: 'Jump to workspace 1–4',
      scope: 'Window management',
    },
    {
      id: 'workspace.carry',
      keys: 'ctrl+alt+shift+1…4',
      description: 'Carry the focused window to workspace 1–4 and follow it',
      scope: 'Window management',
    },
  ])

  useRegisteredHotkeys([
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
    {
      id: 'window.snap-left',
      keys: 'mod+alt+shift+left',
      description: 'Snap the focused window toward the left',
      scope: 'Window management',
      handler: () => bindings.snapKey('left'),
    },
    {
      id: 'window.snap-right',
      keys: 'mod+alt+shift+right',
      description: 'Snap the focused window toward the right',
      scope: 'Window management',
      handler: () => bindings.snapKey('right'),
    },
    {
      id: 'window.snap-up',
      keys: 'mod+alt+shift+up',
      description: 'Snap the focused window upward (half → quarter → maximized)',
      scope: 'Window management',
      handler: () => bindings.snapKey('up'),
    },
    {
      id: 'window.snap-down',
      keys: 'mod+alt+shift+down',
      description: 'Snap the focused window downward (maximized → restore → minimise)',
      scope: 'Window management',
      handler: () => bindings.snapKey('down'),
    },
    {
      id: 'window.show-desktop',
      keys: 'ctrl+alt+d',
      description: 'Show the desktop (press again to bring the windows back)',
      scope: 'Window management',
      handler: bindings.showDesktop,
    },
  ])
}
