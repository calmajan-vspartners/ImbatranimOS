// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { useWindowStore } from './windowStore'
import { useIntentStore } from './intentStore'

const DEFAULT = { width: 800, height: 600 }
const MIN = { width: 320, height: 200 }

function resetStores() {
  useWindowStore.setState({
    windows: [],
    preMaximizeStates: {},
    preSnapStates: {},
    closeGuards: {},
    pendingCloses: new Set(),
    nextZIndex: 1,
  })
  useIntentStore.setState({ intents: new Map() })
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
