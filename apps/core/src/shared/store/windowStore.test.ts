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
