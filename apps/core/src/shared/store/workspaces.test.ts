// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  WORKSPACE_COUNT,
  clampWorkspace,
  nextWorkspace,
  useWindowStore,
  workspaceOccupancy,
  type WorkspaceId,
} from './windowStore'

/**
 * Brief 85 — virtual desktops.
 *
 * The invariant these exist to hold is the brief's hardest one: **no window can
 * become unreachable.** Everything else — filtering, pips, shortcuts — is a view
 * over state, and a view can be wrong without losing anything. A window with no
 * reachable workspace is data loss with a UI.
 */

// The store touches `window.innerWidth` and sessionStorage; jsdom provides both.
const open = (appId: string): string =>
  useWindowStore
    .getState()
    .openWindow(appId, appId, { width: 400, height: 300 }, { width: 200, height: 150 })

const state = () => useWindowStore.getState()
const winsOn = (id: WorkspaceId) => state().windows.filter((w) => w.workspaceId === id)

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  useWindowStore.setState({
    windows: [],
    activeWorkspace: 1,
    preMaximizeStates: {},
    preSnapStates: {},
    closeGuards: {},
    nextZIndex: 1,
  })
})

describe('pure workspace helpers', () => {
  it('clamps anything into a real workspace', () => {
    expect(clampWorkspace(1)).toBe(1)
    expect(clampWorkspace(4)).toBe(4)
    expect(clampWorkspace(0)).toBe(1)
    expect(clampWorkspace(-3)).toBe(1)
    expect(clampWorkspace(99)).toBe(WORKSPACE_COUNT)
    expect(clampWorkspace(undefined)).toBe(1)
    expect(clampWorkspace('3')).toBe(3)
    expect(clampWorkspace('nonsense')).toBe(1)
    expect(clampWorkspace(NaN)).toBe(1)
    expect(clampWorkspace(2.4)).toBe(2)
  })

  it('wraps at both ends, so the four are a ring', () => {
    expect(nextWorkspace(1, 1)).toBe(2)
    expect(nextWorkspace(4, 1)).toBe(1)
    expect(nextWorkspace(1, -1)).toBe(4)
    expect(nextWorkspace(3, -1)).toBe(2)
  })

  it('counts occupancy per workspace, including the empty ones', () => {
    const counts = workspaceOccupancy([{ workspaceId: 1 }, { workspaceId: 1 }, { workspaceId: 3 }])
    expect(counts).toEqual({ 1: 2, 2: 0, 3: 1, 4: 0 })
  })
})

describe('opening windows', () => {
  it('puts a new window on the workspace you are looking at', () => {
    open('a')
    state().setActiveWorkspace(3)
    open('b')
    expect(winsOn(1).map((w) => w.appId)).toEqual(['a'])
    expect(winsOn(3).map((w) => w.appId)).toEqual(['b'])
  })

  it('never leaves a window without a workspace', () => {
    open('a')
    state().setActiveWorkspace(2)
    open('b')
    expect(state().windows.every((w) => w.workspaceId >= 1 && w.workspaceId <= 4)).toBe(true)
  })
})

describe('switching', () => {
  it('filters the workspace window list without touching the full one', () => {
    open('a')
    state().setActiveWorkspace(2)
    open('b')
    open('c')

    expect(
      state()
        .getWorkspaceWindows()
        .map((w) => w.appId)
    ).toEqual(['b', 'c'])
    expect(
      state()
        .getWorkspaceWindows(1)
        .map((w) => w.appId)
    ).toEqual(['a'])
    // getOrderedWindows still means EVERY window — the palette and the add-on
    // manager depend on that meaning.
    expect(state().getOrderedWindows()).toHaveLength(3)
  })

  it('clamps a switch to a workspace that does not exist', () => {
    state().setActiveWorkspace(99 as WorkspaceId)
    expect(state().activeWorkspace).toBe(WORKSPACE_COUNT)
  })

  it('does not disturb geometry, maximization or z-order', () => {
    const id = open('a')
    state().maximizeWindow(id)
    state().updatePosition(id, { x: 12, y: 34 })
    const before = state().windows.find((w) => w.id === id)

    state().setActiveWorkspace(4)
    state().setActiveWorkspace(1)

    const after = state().windows.find((w) => w.id === id)
    expect(after?.isMaximized).toBe(true)
    expect(after?.position).toEqual(before?.position)
    expect(after?.size).toEqual(before?.size)
    expect(after?.zIndex).toBe(before?.zIndex)
  })

  it('leaves a usable empty desktop when the last window closes', () => {
    const id = open('a')
    state().closeWindow(id)
    expect(state().getWorkspaceWindows()).toEqual([])
    expect(state().activeWorkspace).toBe(1)
  })
})

describe('moving a window', () => {
  it('moves it and FOLLOWS it, so the user is not left staring at a gap', () => {
    const id = open('a')
    state().moveWindowToWorkspace(id, 3)
    expect(state().windows.find((w) => w.id === id)?.workspaceId).toBe(3)
    expect(state().activeWorkspace).toBe(3)
  })

  it('preserves geometry and brings it to the front on arrival', () => {
    const id = open('a')
    state().updateSize(id, { width: 512, height: 256 })
    state().updatePosition(id, { x: 7, y: 9 })
    const zBefore = state().windows.find((w) => w.id === id)!.zIndex

    state().moveWindowToWorkspace(id, 2)
    const moved = state().windows.find((w) => w.id === id)!
    expect(moved.size).toEqual({ width: 512, height: 256 })
    expect(moved.position).toEqual({ x: 7, y: 9 })
    expect(moved.zIndex).toBeGreaterThan(zBefore)
  })

  it('un-minimises on arrival — a minimised window moved somewhere invisible is lost twice', () => {
    const id = open('a')
    state().hideWindow(id)
    state().moveWindowToWorkspace(id, 2)
    expect(state().windows.find((w) => w.id === id)?.isVisible).toBe(true)
  })

  it('clamps a move to a workspace that does not exist', () => {
    const id = open('a')
    state().moveWindowToWorkspace(id, 0 as WorkspaceId)
    expect(state().windows.find((w) => w.id === id)?.workspaceId).toBe(1)
  })
})

describe('focus never points at something invisible', () => {
  it('focusing a window on another workspace SWITCHES to it', () => {
    const other = open('a')
    state().setActiveWorkspace(2)
    open('b')
    expect(state().activeWorkspace).toBe(2)

    // This is the path a notification click and `openApp` both take.
    state().focusWindow(other)
    expect(state().activeWorkspace).toBe(1)
  })

  it('focusing a window on the current workspace does not switch anything', () => {
    state().setActiveWorkspace(3)
    const id = open('a')
    state().focusWindow(id)
    expect(state().activeWorkspace).toBe(3)
  })

  it('focusing an id that is gone does not move the user', () => {
    state().setActiveWorkspace(2)
    state().focusWindow('no-such-window')
    expect(state().activeWorkspace).toBe(2)
  })
})

describe('persistence', () => {
  it('carries the workspace through a save and restore', () => {
    open('a')
    state().setActiveWorkspace(3)
    open('b')
    state().persistLayout()

    useWindowStore.setState({ windows: [], activeWorkspace: 1 })
    state().restoreLayout()

    const restored = state().windows
    expect(restored.find((w) => w.appId === 'a')?.workspaceId).toBe(1)
    expect(restored.find((w) => w.appId === 'b')?.workspaceId).toBe(3)
    // …and lands you back where you were, rather than on an empty desktop that
    // reads as "everything is gone".
    expect(state().activeWorkspace).toBe(3)
  })

  it('defaults a pre-brief-85 layout to workspace 1 rather than nowhere', () => {
    sessionStorage.setItem(
      'imbatranimos:window-layout',
      JSON.stringify([
        {
          appId: 'legacy',
          title: 'Legacy',
          position: { x: 0, y: 0 },
          size: { width: 300, height: 200 },
          isMaximized: false,
          isVisible: true,
          zIndex: 1,
        },
      ])
    )
    state().restoreLayout()
    expect(state().windows[0].workspaceId).toBe(1)
    expect(state().getWorkspaceWindows()).toHaveLength(1)
  })

  it('a corrupt stored workspace cannot strand a window', () => {
    sessionStorage.setItem(
      'imbatranimos:window-layout',
      JSON.stringify([
        {
          appId: 'weird',
          title: 'Weird',
          position: { x: 0, y: 0 },
          size: { width: 300, height: 200 },
          isMaximized: false,
          isVisible: true,
          zIndex: 1,
          workspaceId: 47,
        },
      ])
    )
    sessionStorage.setItem('imbatranimos:active-workspace', '47')
    state().restoreLayout()

    const w = state().windows[0]
    expect(w.workspaceId).toBeLessThanOrEqual(WORKSPACE_COUNT)
    // Reachable: the workspace it landed on is the one now on screen.
    expect(state().getWorkspaceWindows()).toHaveLength(1)
  })
})
