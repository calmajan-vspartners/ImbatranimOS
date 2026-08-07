// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  computeSnapGeometry,
  nextSnapState,
  setMinSizeResolver,
  TASKBAR_HEIGHT,
  TITLEBAR_MIN_VISIBLE,
  useWindowStore,
} from './windowStore'
import { useIntentStore } from './intentStore'

const DEFAULT = { width: 800, height: 600 }
const MIN = { width: 320, height: 200 }

function resetStores() {
  useWindowStore.setState({
    windows: [],
    activeWorkspace: 1,
    preMaximizeStates: {},
    preSnapStates: {},
    closeGuards: {},
    pendingCloses: new Set(),
    showDesktopStash: {},
    nextZIndex: 1,
  })
  useIntentStore.setState({ intents: new Map() })
  setMinSizeResolver(() => ({ width: 240, height: 180 }))
}

beforeEach(resetStores)

describe('focusWindow', () => {
  it('does not churn zIndex when the target is already the top-most window', () => {
    const { openWindow, focusWindow } = useWindowStore.getState()
    const a = openWindow('files', 'A', DEFAULT, MIN)
    const b = openWindow('files', 'B', DEFAULT, MIN)

    const before = useWindowStore.getState().nextZIndex
    focusWindow(b) // b is already top — must be a no-op
    expect(useWindowStore.getState().nextZIndex).toBe(before)

    focusWindow(a) // a is behind — must promote it
    expect(useWindowStore.getState().nextZIndex).toBe(before + 1)
    const win = useWindowStore.getState().windows.find((w) => w.id === a)!
    expect(win.zIndex).toBe(before)
  })
})

describe('restoreWindow', () => {
  it('restores the exact pre-maximize geometry when it exists', () => {
    const { openWindow, maximizeWindow, restoreWindow } = useWindowStore.getState()
    const id = openWindow('files', 'A', DEFAULT, MIN)
    const original = useWindowStore.getState().windows.find((w) => w.id === id)!
    const pos = original.position
    const size = original.size

    maximizeWindow(id)
    restoreWindow(id)

    const win = useWindowStore.getState().windows.find((w) => w.id === id)!
    expect(win.isMaximized).toBe(false)
    expect(win.position).toEqual(pos)
    expect(win.size).toEqual(size)
  })

  it('falls back to a centered floating size when the pre-maximize state is gone', () => {
    const { openWindow, maximizeWindow, restoreWindow } = useWindowStore.getState()
    const id = openWindow('files', 'A', DEFAULT, MIN)

    maximizeWindow(id)
    // Simulate restoreLayout(): the layout is loaded while maximized, and it wipes
    // the pre-maximize map — the case that used to make restore a silent no-op.
    useWindowStore.setState({ preMaximizeStates: {} })

    restoreWindow(id)

    const win = useWindowStore.getState().windows.find((w) => w.id === id)!
    expect(win.isMaximized).toBe(false)
    // Floating, not still filling the desktop.
    expect(win.size.width).toBeLessThan(window.innerWidth)
    expect(win.size.width).toBeGreaterThanOrEqual(360)
    expect(win.size.height).toBeGreaterThanOrEqual(240)
  })
})

describe('closeWindow cleanup', () => {
  it('clears the pending intent for the closed window', () => {
    // The opened-file latch moved into the SDK with brief 48 and is private to
    // it, so the compositor's cleanup covers exactly what the compositor owns:
    // the intent map. The SDK's latch is keyed by uuid window ids that never
    // recur, so a closed window's record is inert.
    const { openWindow, closeWindow } = useWindowStore.getState()
    const id = openWindow('files', 'A', DEFAULT, MIN)

    useIntentStore.getState().setIntent(id, { openPath: 'a.txt', root: 'home' })
    expect(useIntentStore.getState().intents.has(id)).toBe(true)

    closeWindow(id)

    expect(useIntentStore.getState().intents.has(id)).toBe(false)
    expect(useWindowStore.getState().windows.find((w) => w.id === id)).toBeUndefined()
  })
})

describe('async close guards (brief 102)', () => {
  it('a guardless window still closes in the same tick', () => {
    const { openWindow, closeWindow } = useWindowStore.getState()
    const id = openWindow('files', 'A', DEFAULT, MIN)
    closeWindow(id)
    // Synchronous: no await, no microtask turn — the window is already gone.
    expect(useWindowStore.getState().windows).toHaveLength(0)
  })

  it('a sync-true guard closes in the same tick; sync-false aborts', () => {
    const { openWindow, closeWindow, registerCloseGuard } = useWindowStore.getState()
    const id = openWindow('files', 'A', DEFAULT, MIN)

    registerCloseGuard(id, () => false)
    closeWindow(id)
    expect(useWindowStore.getState().windows).toHaveLength(1)

    registerCloseGuard(id, () => true)
    closeWindow(id)
    expect(useWindowStore.getState().windows).toHaveLength(0)
  })

  it('a settled-false promise aborts the close with every store untouched', async () => {
    const { openWindow, closeWindow, registerCloseGuard } = useWindowStore.getState()
    const id = openWindow('files', 'A', DEFAULT, MIN)
    useIntentStore.getState().setIntent(id, { openPath: 'a.txt', root: 'home' })

    let settle!: (v: boolean) => void
    registerCloseGuard(
      id,
      () =>
        new Promise<boolean>((resolve) => {
          settle = resolve
        })
    )
    closeWindow(id)
    // Held open while the guard decides.
    expect(useWindowStore.getState().windows).toHaveLength(1)
    expect(useWindowStore.getState().pendingCloses.has(id)).toBe(true)

    settle(false)
    await Promise.resolve()
    expect(useWindowStore.getState().windows).toHaveLength(1)
    expect(useWindowStore.getState().pendingCloses.has(id)).toBe(false)
    // An aborted close cleans nothing: the intent and the guard both survive.
    expect(useIntentStore.getState().intents.has(id)).toBe(true)
    expect(useWindowStore.getState().closeGuards[id]).toBeDefined()
  })

  it('a settled-true promise closes, and cleanup fires exactly once', async () => {
    const { openWindow, closeWindow, registerCloseGuard } = useWindowStore.getState()
    const id = openWindow('files', 'A', DEFAULT, MIN)
    useIntentStore.getState().setIntent(id, { openPath: 'a.txt', root: 'home' })

    let calls = 0
    let settle!: (v: boolean) => void
    registerCloseGuard(id, () => {
      calls++
      return new Promise<boolean>((resolve) => {
        settle = resolve
      })
    })
    closeWindow(id)
    settle(true)
    await Promise.resolve()

    expect(useWindowStore.getState().windows).toHaveLength(0)
    expect(useWindowStore.getState().pendingCloses.has(id)).toBe(false)
    expect(useIntentStore.getState().intents.has(id)).toBe(false)
    expect(useWindowStore.getState().closeGuards[id]).toBeUndefined()
    expect(calls).toBe(1)
  })

  it('a second close request for a pending id is a no-op (no stacked dialogs)', async () => {
    const { openWindow, closeWindow, registerCloseGuard } = useWindowStore.getState()
    const id = openWindow('files', 'A', DEFAULT, MIN)

    let calls = 0
    let settle!: (v: boolean) => void
    registerCloseGuard(id, () => {
      calls++
      return new Promise<boolean>((resolve) => {
        settle = resolve
      })
    })
    closeWindow(id)
    closeWindow(id) // the dialog is up — must not ask again nor close
    expect(calls).toBe(1)
    expect(useWindowStore.getState().windows).toHaveLength(1)

    settle(true)
    await Promise.resolve()
    expect(useWindowStore.getState().windows).toHaveLength(0)
  })

  it('a rejecting guard answers nothing — the window stays open and can close later', async () => {
    const { openWindow, closeWindow, registerCloseGuard } = useWindowStore.getState()
    const id = openWindow('files', 'A', DEFAULT, MIN)

    registerCloseGuard(id, () => Promise.reject(new Error('guard exploded')))
    closeWindow(id)
    await Promise.resolve()
    await Promise.resolve()
    expect(useWindowStore.getState().windows).toHaveLength(1)
    expect(useWindowStore.getState().pendingCloses.has(id)).toBe(false)

    // Not wedged: a later close (guard now allows) proceeds.
    registerCloseGuard(id, () => true)
    closeWindow(id)
    expect(useWindowStore.getState().windows).toHaveLength(0)
  })
})

describe('reflowToViewport (brief 103)', () => {
  it('re-fits a maximized window to the new usable desktop', () => {
    const { openWindow, maximizeWindow } = useWindowStore.getState()
    const id = openWindow('files', 'A', DEFAULT, MIN)
    maximizeWindow(id)

    // Simulate a viewport change after the fact: the stored size is stale now.
    useWindowStore.setState((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, size: { width: 5000, height: 5000 } } : w
      ),
    }))
    useWindowStore.getState().reflowToViewport()

    const win = useWindowStore.getState().windows.find((w) => w.id === id)!
    expect(win.size).toEqual({
      width: window.innerWidth,
      height: window.innerHeight - TASKBAR_HEIGHT,
    })
    expect(win.position).toEqual({ x: 0, y: 0 })
  })

  it('retiles a snapped window to the current snap geometry', () => {
    const { openWindow, snapWindow } = useWindowStore.getState()
    const id = openWindow('files', 'A', DEFAULT, MIN)
    snapWindow(id, 'left')
    useWindowStore.setState((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, size: { width: 1, height: 1 } } : w)),
    }))

    useWindowStore.getState().reflowToViewport()

    const win = useWindowStore.getState().windows.find((w) => w.id === id)!
    expect({ position: win.position, size: win.size }).toEqual(computeSnapGeometry('left'))
    // The pre-snap entry survives the reflow — unsnap must still round-trip.
    expect(useWindowStore.getState().preSnapStates[id]).toBeDefined()
  })

  it('shrinks a floater only when it overflows, and keeps the title bar reachable', () => {
    const { openWindow } = useWindowStore.getState()
    const id = openWindow('files', 'A', { width: 300, height: 200 }, MIN)
    const before = useWindowStore.getState().windows.find((w) => w.id === id)!
    const keptSize = before.size

    // A window parked beyond the desktop's bottom-right, oversized for it.
    useWindowStore.setState((s) => ({
      windows: s.windows.map((w) =>
        w.id === id
          ? {
              ...w,
              position: { x: window.innerWidth + 500, y: window.innerHeight + 500 },
              size: { width: window.innerWidth + 400, height: window.innerHeight + 400 },
            }
          : w
      ),
    }))
    useWindowStore.getState().reflowToViewport()
    let win = useWindowStore.getState().windows.find((w) => w.id === id)!
    expect(win.size.width).toBeLessThanOrEqual(window.innerWidth)
    expect(win.size.height).toBeLessThanOrEqual(window.innerHeight - TASKBAR_HEIGHT)
    expect(win.position.y).toBeLessThanOrEqual(
      window.innerHeight - TASKBAR_HEIGHT - TITLEBAR_MIN_VISIBLE
    )
    expect(win.position.x).toBeGreaterThanOrEqual(0)

    // A second reflow with nothing overflowing changes nothing (no churn).
    const arr = useWindowStore.getState().windows
    useWindowStore.getState().reflowToViewport()
    expect(useWindowStore.getState().windows).toBe(arr)

    // And a window that already fits is not shrunk.
    useWindowStore.setState((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, size: keptSize } : w)),
    }))
    useWindowStore.getState().reflowToViewport()
    win = useWindowStore.getState().windows.find((w) => w.id === id)!
    expect(win.size).toEqual(keptSize)
  })

  it('minSize wins over the viewport: the window overflows but its position clamps', () => {
    setMinSizeResolver(() => ({
      width: window.innerWidth + 200,
      height: window.innerHeight + 200,
    }))
    const { openWindow } = useWindowStore.getState()
    const id = openWindow('files', 'A', DEFAULT, MIN)
    useWindowStore.setState((s) => ({
      windows: s.windows.map((w) =>
        w.id === id
          ? {
              ...w,
              position: { x: 300, y: window.innerHeight * 2 },
              size: { width: window.innerWidth + 200, height: window.innerHeight + 200 },
            }
          : w
      ),
    }))

    useWindowStore.getState().reflowToViewport()

    const win = useWindowStore.getState().windows.find((w) => w.id === id)!
    // Honest minimum: still overflowing…
    expect(win.size.width).toBe(window.innerWidth + 200)
    // …but pinned so the title-bar row is on screen.
    expect(win.position.x).toBe(0)
    expect(win.position.y).toBeLessThanOrEqual(
      window.innerHeight - TASKBAR_HEIGHT - TITLEBAR_MIN_VISIBLE
    )
  })
})

describe('nextSnapState (brief 103)', () => {
  it('floating: left/right snap halves, up maximizes, down minimizes', () => {
    const w = { isMaximized: false }
    expect(nextSnapState(w, 'left')).toEqual({ type: 'snap', region: 'left' })
    expect(nextSnapState(w, 'right')).toEqual({ type: 'snap', region: 'right' })
    expect(nextSnapState(w, 'up')).toEqual({ type: 'maximize' })
    expect(nextSnapState(w, 'down')).toEqual({ type: 'minimize' })
  })

  it('halves: up/down reach quarters, opposite arrow unsnaps', () => {
    const left = { snapState: 'left' as const, isMaximized: false }
    expect(nextSnapState(left, 'up')).toEqual({ type: 'snap', region: 'tl' })
    expect(nextSnapState(left, 'down')).toEqual({ type: 'snap', region: 'bl' })
    expect(nextSnapState(left, 'right')).toEqual({ type: 'unsnap' })
    expect(nextSnapState(left, 'left')).toEqual({ type: 'none' })

    const right = { snapState: 'right' as const, isMaximized: false }
    expect(nextSnapState(right, 'up')).toEqual({ type: 'snap', region: 'tr' })
    expect(nextSnapState(right, 'down')).toEqual({ type: 'snap', region: 'br' })
    expect(nextSnapState(right, 'left')).toEqual({ type: 'unsnap' })
  })

  it('quarters: vertical arrows walk the column, horizontal arrows cross', () => {
    expect(nextSnapState({ snapState: 'tl', isMaximized: false }, 'down')).toEqual({
      type: 'snap',
      region: 'left',
    })
    expect(nextSnapState({ snapState: 'tl', isMaximized: false }, 'up')).toEqual({
      type: 'maximize',
    })
    expect(nextSnapState({ snapState: 'bl', isMaximized: false }, 'up')).toEqual({
      type: 'snap',
      region: 'left',
    })
    expect(nextSnapState({ snapState: 'bl', isMaximized: false }, 'down')).toEqual({
      type: 'minimize',
    })
    expect(nextSnapState({ snapState: 'tr', isMaximized: false }, 'left')).toEqual({
      type: 'snap',
      region: 'tl',
    })
    expect(nextSnapState({ snapState: 'bl', isMaximized: false }, 'right')).toEqual({
      type: 'snap',
      region: 'br',
    })
  })

  it('maximized: down restores, sideways goes to a half, up is a no-op', () => {
    const max = { isMaximized: true }
    expect(nextSnapState(max, 'down')).toEqual({ type: 'restore' })
    expect(nextSnapState(max, 'left')).toEqual({ type: 'snap', region: 'left' })
    expect(nextSnapState(max, 'right')).toEqual({ type: 'snap', region: 'right' })
    expect(nextSnapState(max, 'up')).toEqual({ type: 'none' })
  })
})

describe('toggleShowDesktop (brief 103)', () => {
  it('hides everything visible, then brings the same stack back in order', () => {
    const { openWindow, toggleShowDesktop } = useWindowStore.getState()
    const a = openWindow('files', 'A', DEFAULT, MIN)
    const b = openWindow('notepad', 'B', DEFAULT, MIN)
    const c = openWindow('terminal', 'C', DEFAULT, MIN)

    toggleShowDesktop()
    expect(useWindowStore.getState().windows.every((w) => !w.isVisible)).toBe(true)

    useWindowStore.getState().toggleShowDesktop()
    const wins = useWindowStore.getState().windows
    expect(wins.every((w) => w.isVisible)).toBe(true)
    // Stacking survived the round trip: a < b < c in z, as opened.
    const z = (id: string) => wins.find((w) => w.id === id)!.zIndex
    expect(z(a)).toBeLessThan(z(b))
    expect(z(b)).toBeLessThan(z(c))
  })

  it('a window opened between the presses makes the second press hide again', () => {
    const { openWindow, toggleShowDesktop } = useWindowStore.getState()
    openWindow('files', 'A', DEFAULT, MIN)
    toggleShowDesktop()
    // Something new appears on the cleared desktop…
    const late = useWindowStore.getState().openWindow('notepad', 'B', DEFAULT, MIN)
    // …so the next press hides (Windows' behaviour), not restores.
    useWindowStore.getState().toggleShowDesktop()
    const wins = useWindowStore.getState().windows
    expect(wins.every((w) => !w.isVisible)).toBe(true)
    // And the third press brings back what the second hid.
    useWindowStore.getState().toggleShowDesktop()
    expect(useWindowStore.getState().windows.find((w) => w.id === late)!.isVisible).toBe(true)
  })

  it('ids closed while stashed are skipped on restore', () => {
    const { openWindow, toggleShowDesktop } = useWindowStore.getState()
    const a = openWindow('files', 'A', DEFAULT, MIN)
    const b = openWindow('notepad', 'B', DEFAULT, MIN)
    toggleShowDesktop()
    useWindowStore.getState().closeWindow(a)
    useWindowStore.getState().toggleShowDesktop()
    const wins = useWindowStore.getState().windows
    expect(wins.find((w) => w.id === a)).toBeUndefined()
    expect(wins.find((w) => w.id === b)!.isVisible).toBe(true)
  })
})

describe('intent re-delivery', () => {
  it('overwrites a pending payload so a later delivery to an open window wins', () => {
    const { setIntent, consumeIntent } = useIntentStore.getState()
    const id = 'win-1'

    setIntent(id, { openPath: 'a.txt', root: 'home' })
    setIntent(id, { openPath: 'b.txt', root: 'home' })
    // The latest payload is what a reactive subscriber reads.
    expect(useIntentStore.getState().intents.get(id)).toEqual({ openPath: 'b.txt', root: 'home' })

    expect(consumeIntent(id)).toEqual({ openPath: 'b.txt', root: 'home' })
    expect(useIntentStore.getState().intents.has(id)).toBe(false)

    // A fresh delivery after a consume is seen again (the dead-letter fix).
    setIntent(id, { openPath: 'c.txt', root: 'home' })
    expect(useIntentStore.getState().intents.get(id)).toEqual({ openPath: 'c.txt', root: 'home' })
  })
})
