// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createSystemHandle } from './createSystemHandle'
import { useWindowStore } from '../shared/store/windowStore'
import { useIntentStore } from '../shared/store/intentStore'
import { useNotificationStore } from '../shared/store/notificationStore'
import { useShortcutStore } from '../shared/hooks/shortcutRegistry'

/**
 * Brief 48 — the in-process transport of the protocol.
 *
 * The assertions that matter are the SCOPING ones: a handle is minted for one
 * app in one window, and nothing on it may reach further. That is the security
 * model of the seam, so it gets pinned harder than the plumbing.
 */

function openTestWindow(appId: string): string {
  return useWindowStore
    .getState()
    .openWindow(appId, appId, { width: 400, height: 300 }, { width: 200, height: 150 })
}

beforeEach(() => {
  useWindowStore.setState({ windows: [], nextZIndex: 1, closeGuards: {} })
  useIntentStore.setState({ intents: new Map() })
  useNotificationStore.setState({ notifications: [] })
  useShortcutStore.setState({ shortcuts: {} })
})

describe('window scoping', () => {
  it('window.* acts on the OWN window, never another', () => {
    const mine = openTestWindow('notepad')
    const theirs = openTestWindow('calculator')
    const system = createSystemHandle('notepad', mine)

    system.window.setTitle('mine.txt')
    const wins = useWindowStore.getState().windows
    expect(wins.find((w) => w.id === mine)?.title).toBe('mine.txt')
    expect(wins.find((w) => w.id === theirs)?.title).toBe('calculator')

    system.window.hide()
    expect(useWindowStore.getState().windows.find((w) => w.id === mine)?.isVisible).toBe(false)
    expect(useWindowStore.getState().windows.find((w) => w.id === theirs)?.isVisible).toBe(true)
  })

  it('isFocused tracks the compositor, not a cached snapshot', () => {
    const a = openTestWindow('notepad')
    const b = openTestWindow('calculator')
    const sysA = createSystemHandle('notepad', a)
    expect(sysA.window.isFocused()).toBe(false)
    useWindowStore.getState().focusWindow(a)
    expect(sysA.window.isFocused()).toBe(true)
    useWindowStore.getState().focusWindow(b)
    expect(sysA.window.isFocused()).toBe(false)
  })

  it('requestClose consults the close guard, same as the title-bar X', () => {
    const id = openTestWindow('notepad')
    const system = createSystemHandle('notepad', id)
    let allow = false
    system.window.onCloseRequest(() => allow)

    system.window.requestClose()
    expect(useWindowStore.getState().windows).toHaveLength(1)

    allow = true
    system.window.requestClose()
    expect(useWindowStore.getState().windows).toHaveLength(0)
  })

  it('a windowless handle degrades instead of crashing', () => {
    const system = createSystemHandle('clock', null)
    expect(system.windowId).toBeNull()
    expect(() => system.window.setTitle('x')).not.toThrow()
    expect(system.window.isFocused()).toBe(false)
    expect(system.window.isVisible()).toBe(false)
    expect(() => system.window.onCloseRequest(() => true)()).not.toThrow()
  })
})

describe('notify is stamped', () => {
  it('carries the handle app id — an app cannot toast in another name', () => {
    const system = createSystemHandle('sticky-notes', null)
    system.notify({ title: 'saved', level: 'success' })
    const items = useNotificationStore.getState().notifications
    expect(items).toHaveLength(1)
    expect(items[0].appId).toBe('sticky-notes')
  })
})

describe('intents', () => {
  it('onIntent delivers a pending payload immediately, then re-deliveries', () => {
    const id = openTestWindow('archive-manager')
    const system = createSystemHandle('archive-manager', id)
    useIntentStore.getState().setIntent(id, { openPath: 'a.zip', root: 'home' })

    const seen: unknown[] = []
    const off = system.intents.onIntent((p) => seen.push(p))
    expect(seen).toEqual([{ openPath: 'a.zip', root: 'home' }])

    // Re-delivery to the already-open window (single-instance focus path).
    useIntentStore.getState().setIntent(id, { openPath: 'b.zip', root: 'home' })
    expect(seen).toHaveLength(2)

    off()
    useIntentStore.getState().setIntent(id, { openPath: 'c.zip', root: 'home' })
    expect(seen).toHaveLength(2)
  })

  it('consume drains once and only for the own window', () => {
    const mine = openTestWindow('notepad')
    const theirs = openTestWindow('paint')
    useIntentStore.getState().setIntent(mine, { openPath: 'x.txt', root: 'home' })
    useIntentStore.getState().setIntent(theirs, { openPath: 'y.png', root: 'home' })

    const system = createSystemHandle('notepad', mine)
    expect(system.intents.consume()).toEqual({ openPath: 'x.txt', root: 'home' })
    expect(system.intents.consume()).toBeUndefined()
    // The other window's intent is untouched.
    expect(useIntentStore.getState().intents.get(theirs)).toEqual({
      openPath: 'y.png',
      root: 'home',
    })
  })
})

describe('shortcuts', () => {
  it('register binds AND documents; unregister removes both', () => {
    const system = createSystemHandle('games', null)
    let fired = 0
    const off = system.shortcuts.register([
      {
        id: 'games.test',
        keys: 'mod+9',
        description: 'test',
        scope: 'Global',
        handler: () => fired++,
      },
    ])
    expect(useShortcutStore.getState().shortcuts['games.test']).toBeDefined()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '9', ctrlKey: true }))
    expect(fired).toBe(1)

    off()
    expect(useShortcutStore.getState().shortcuts['games.test']).toBeUndefined()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '9', ctrlKey: true }))
    expect(fired).toBe(1)
  })
})

describe('events', () => {
  it('visibility fires on minimise and restore, with the new value', () => {
    const id = openTestWindow('media-player')
    const system = createSystemHandle('media-player', id)
    const seen: boolean[] = []
    const off = system.on('visibility', (v) => seen.push(v))

    useWindowStore.getState().hideWindow(id)
    useWindowStore.getState().showWindow(id)
    expect(seen).toEqual([false, true])
    off()
  })

  it('focus/blur fire on transitions only', () => {
    const a = openTestWindow('notepad')
    const b = openTestWindow('calculator')
    const system = createSystemHandle('notepad', a)
    let focus = 0
    let blur = 0
    system.on('focus', () => focus++)
    system.on('blur', () => blur++)

    useWindowStore.getState().focusWindow(a)
    useWindowStore.getState().focusWindow(b)
    useWindowStore.getState().focusWindow(a)
    expect(focus).toBe(2)
    expect(blur).toBe(1)
  })
})
