// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { resetStartupForTest, runStartupApps, startupCandidates, startupHasRun } from './startup'
import { useStartupStore } from '../store/startupStore'
import { useAddonStore } from '../store/addonStore'
import { useWindowStore } from '../store/windowStore'
import { DOTFILE_KEYS } from '../../lib/prefs'

/**
 * Brief 82 — startup apps.
 *
 * The interesting assertions are the two "does NOT open" cases. Brief 82 was
 * written believing brief 49 had deleted the layout restore; it had not, so
 * "open the list once per session" as literally specified would re-open
 * everything on top of the windows a reload just brought back.
 */

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  resetStartupForTest()
  useStartupStore.setState({ apps: [] })
  useAddonStore.setState({ disabled: [] })
  useWindowStore.setState({ windows: [], nextZIndex: 1 })
})

describe('the list is a dotfile', () => {
  it('its persist key is registered in DOTFILE_KEYS', () => {
    // Same trap brief 81 fell into: a store wired to `prefsStorage` whose key is
    // not in this list persists to localStorage only, so "my startup apps follow
    // me" silently means "in this browser".
    expect(DOTFILE_KEYS as readonly string[]).toContain('imbatranimos:startup')
  })
})

describe('which apps are candidates', () => {
  it('keeps the configured order rather than registry order', () => {
    useStartupStore.setState({ apps: ['calculator', 'terminal'] })
    expect(startupCandidates()).toEqual(['calculator', 'terminal'])
    useStartupStore.setState({ apps: ['terminal', 'calculator'] })
    expect(startupCandidates()).toEqual(['terminal', 'calculator'])
  })

  it('skips an app the user disabled, rather than resurrecting it', () => {
    useStartupStore.setState({ apps: ['calculator', 'terminal'] })
    useAddonStore.setState({ disabled: ['calculator'] })
    expect(startupCandidates()).toEqual(['terminal'])
  })

  it('skips an id the registry no longer has', () => {
    // An app removed from the tree must not leave a boot that never completes.
    useStartupStore.setState({ apps: ['an-app-that-was-removed', 'terminal'] })
    expect(startupCandidates()).toEqual(['terminal'])
  })
})

describe('running the set', () => {
  it('opens the configured apps, in order', () => {
    useStartupStore.setState({ apps: ['terminal', 'calculator'] })
    expect(runStartupApps()).toEqual(['terminal', 'calculator'])
    expect(useWindowStore.getState().windows.map((w) => w.appId)).toEqual([
      'terminal',
      'calculator',
    ])
  })

  it('leaves the last one focused, which is why the order is a list', () => {
    useStartupStore.setState({ apps: ['terminal', 'calculator'] })
    runStartupApps()
    const wins = useWindowStore.getState().windows
    const top = wins.reduce((a, b) => (b.zIndex > a.zIndex ? b : a))
    expect(top.appId).toBe('calculator')
  })

  it('does NOT run a second time in the same tab, even with an empty desktop', () => {
    // Close everything, reload: the set must not come back. Otherwise "close it"
    // is impossible for any app on the list.
    useStartupStore.setState({ apps: ['terminal'] })
    expect(runStartupApps()).toEqual(['terminal'])
    useWindowStore.setState({ windows: [] })
    expect(runStartupApps()).toEqual([])
    expect(useWindowStore.getState().windows).toHaveLength(0)
  })

  it('does NOT run when a layout was restored — the reload case brief 82 missed', () => {
    // Brief 49 kept the restore and moved it to sessionStorage, so a reload comes
    // back with its windows. Re-running the set here would double every
    // multi-instance app and steal focus on every single reload.
    useStartupStore.setState({ apps: ['terminal', 'calculator'] })
    useWindowStore
      .getState()
      .openWindow('notepad', 'Notepad', { width: 400, height: 300 }, { width: 200, height: 150 })
    expect(runStartupApps()).toEqual([])
    expect(useWindowStore.getState().windows.map((w) => w.appId)).toEqual(['notepad'])
  })

  it('marks the tab even when the list is empty, so adding one mid-session waits for the next boot', () => {
    expect(runStartupApps()).toEqual([])
    expect(startupHasRun()).toBe(true)
  })

  it('opens nothing at all when nothing is configured', () => {
    expect(runStartupApps()).toEqual([])
    expect(useWindowStore.getState().windows).toHaveLength(0)
  })

  it('skips a disabled entry without dropping the ones after it', () => {
    useStartupStore.setState({ apps: ['calculator', 'terminal'] })
    useAddonStore.setState({ disabled: ['calculator'] })
    expect(runStartupApps()).toEqual(['terminal'])
  })
})

describe('the store', () => {
  it('toggles without disturbing the order of the rest', () => {
    const { toggle } = useStartupStore.getState()
    toggle('a')
    toggle('b')
    toggle('c')
    toggle('b')
    expect(useStartupStore.getState().apps).toEqual(['a', 'c'])
  })

  it('moves an entry one place, and refuses to fall off either end', () => {
    useStartupStore.setState({ apps: ['a', 'b', 'c'] })
    const { move } = useStartupStore.getState()
    move('c', -1)
    expect(useStartupStore.getState().apps).toEqual(['a', 'c', 'b'])
    move('a', -1)
    expect(useStartupStore.getState().apps).toEqual(['a', 'c', 'b'])
    move('b', 1)
    expect(useStartupStore.getState().apps).toEqual(['a', 'c', 'b'])
  })

  it('de-duplicates a snapshot, because two Notepads are one startup entry', () => {
    useStartupStore.getState().setApps(['notepad', 'terminal', 'notepad'])
    expect(useStartupStore.getState().apps).toEqual(['notepad', 'terminal'])
  })
})
