// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Brief 49 — the dotfile adapter.
 *
 * The two things worth pinning down are the two the brief did not anticipate:
 * that the mirror has to answer **synchronously** (an async storage makes every
 * persisted store flash its default first), and that a value the server has
 * never seen is a **migration**, not an absence.
 */

const get = vi.fn()
const put = vi.fn()
const del = vi.fn()

vi.mock('./axios', () => ({
  api: {
    get: (...args: unknown[]) => get(...args) as unknown,
    put: (...args: unknown[]) => put(...args) as unknown,
    delete: (...args: unknown[]) => del(...args) as unknown,
  },
}))

async function freshModule() {
  vi.resetModules()
  return import('./prefs')
}

beforeEach(() => {
  localStorage.clear()
  get.mockReset()
  put.mockReset()
  del.mockReset()
  get.mockResolvedValue({ data: {} })
  put.mockResolvedValue({ data: { written: 0 } })
  del.mockResolvedValue({ data: null })
  vi.useRealTimers()
})

describe('the first-paint mirror', () => {
  it('answers synchronously from localStorage, before any network call', async () => {
    localStorage.setItem('imbatranimos:appearance', '{"state":{"theme":"light"}}')
    const { prefsStorage } = await freshModule()
    // No await anywhere: this is what lets main.tsx brand the very first paint.
    expect(prefsStorage.getItem('imbatranimos:appearance')).toBe('{"state":{"theme":"light"}}')
    expect(get).not.toHaveBeenCalled()
  })

  it('returns null for a key it has never seen', async () => {
    const { prefsStorage } = await freshModule()
    expect(prefsStorage.getItem('wallpaper-storage')).toBeNull()
  })

  it('does not touch the network until hydration is asked for', async () => {
    const { prefsStorage } = await freshModule()
    prefsStorage.setItem('imbatranimos:appearance', '{"a":1}')
    expect(get).not.toHaveBeenCalled()
  })
})

describe('hydration', () => {
  it('takes the server as the source of truth over the local mirror', async () => {
    localStorage.setItem('wallpaper-storage', '{"state":{"wallpaper":"stale"}}')
    get.mockResolvedValue({ data: { 'wallpaper-storage': '{"state":{"wallpaper":"real"}}' } })
    const { hydratePrefs, readPref } = await freshModule()

    await hydratePrefs()
    expect(readPref('wallpaper-storage')).toBe('{"state":{"wallpaper":"real"}}')
    // …and refreshes the cache, so the next first paint is already right.
    expect(localStorage.getItem('wallpaper-storage')).toBe('{"state":{"wallpaper":"real"}}')
  })

  it('SEEDS the server from a local value it has never seen — the migration', async () => {
    localStorage.setItem('imbatranimos:appearance', '{"state":{"accent":"emerald"}}')
    get.mockResolvedValue({ data: {} })
    const { hydratePrefs } = await freshModule()

    await hydratePrefs()
    expect(put).toHaveBeenCalledWith('/prefs', {
      entries: [{ key: 'imbatranimos:appearance', value: '{"state":{"accent":"emerald"}}' }],
    })
  })

  it('does not seed a key that has no local value either', async () => {
    const { hydratePrefs } = await freshModule()
    await hydratePrefs()
    expect(put).not.toHaveBeenCalled()
  })

  it('runs once, however many callers race at startup', async () => {
    const { hydratePrefs } = await freshModule()
    await Promise.all([hydratePrefs(), hydratePrefs(), hydratePrefs()])
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('keeps running on the local mirror when the server is unreachable', async () => {
    localStorage.setItem('wallpaper-storage', '{"state":{"wallpaper":"grid"}}')
    get.mockRejectedValue(new Error('offline'))
    const { hydratePrefs, readPref, prefsHydrated } = await freshModule()

    await expect(hydratePrefs()).resolves.toBeUndefined()
    // A desktop that refused to render because it could not read a wallpaper
    // would be a far worse failure than a wrong wallpaper.
    expect(readPref('wallpaper-storage')).toBe('{"state":{"wallpaper":"grid"}}')
    expect(prefsHydrated()).toBe(false)
  })
})

describe('writing through', () => {
  it('updates the mirror immediately and the server on a debounce', async () => {
    vi.useFakeTimers()
    const { prefsStorage, readPref } = await freshModule()

    prefsStorage.setItem('wallpaper-storage', '{"w":1}')
    expect(readPref('wallpaper-storage')).toBe('{"w":1}')
    expect(localStorage.getItem('wallpaper-storage')).toBe('{"w":1}')
    expect(put).not.toHaveBeenCalled()

    vi.advanceTimersByTime(500)
    expect(put).toHaveBeenCalledTimes(1)
  })

  it('COALESCES a burst into one request — dragging an icon must not be a write per pixel', async () => {
    vi.useFakeTimers()
    const { prefsStorage } = await freshModule()

    for (let i = 0; i < 50; i++) prefsStorage.setItem('desktop-storage', `{"x":${i}}`)
    vi.advanceTimersByTime(500)

    expect(put).toHaveBeenCalledTimes(1)
    expect(put).toHaveBeenCalledWith('/prefs', {
      entries: [{ key: 'desktop-storage', value: '{"x":49}' }],
    })
  })

  it('sends every changed key in the batch, not just the last one', async () => {
    vi.useFakeTimers()
    const { prefsStorage } = await freshModule()

    prefsStorage.setItem('wallpaper-storage', '{"w":1}')
    prefsStorage.setItem('imbatranimos:appearance', '{"a":1}')
    vi.advanceTimersByTime(500)

    const entries = (put.mock.calls[0][1] as { entries: { key: string }[] }).entries
    expect(entries.map((e) => e.key).sort()).toEqual([
      'imbatranimos:appearance',
      'wallpaper-storage',
    ])
  })

  it('flushes on demand, so a change made just before the tab closes still lands', async () => {
    vi.useFakeTimers()
    const { prefsStorage, flushPrefs } = await freshModule()

    prefsStorage.setItem('wallpaper-storage', '{"w":1}')
    flushPrefs()
    expect(put).toHaveBeenCalledTimes(1)

    // …and the pending set is cleared, so the debounce cannot send it twice.
    vi.advanceTimersByTime(500)
    expect(put).toHaveBeenCalledTimes(1)
  })

  it('flushing with nothing pending sends nothing', async () => {
    const { flushPrefs } = await freshModule()
    flushPrefs()
    expect(put).not.toHaveBeenCalled()
  })

  it('refuses to push a key that is NOT a dotfile', async () => {
    vi.useFakeTimers()
    const { prefsStorage, readPref } = await freshModule()

    // Window layout is per-tab session state; it must never reach the server.
    prefsStorage.setItem('imbatranimos:window-layout', '[{"appId":"clock"}]')
    vi.advanceTimersByTime(500)

    expect(put).not.toHaveBeenCalled()
    expect(readPref('imbatranimos:window-layout')).toBe('[{"appId":"clock"}]')
  })

  it('a removal clears both copies and tells the server', async () => {
    const { prefsStorage, readPref } = await freshModule()
    prefsStorage.setItem('wallpaper-storage', '{"w":1}')
    prefsStorage.removeItem('wallpaper-storage')

    expect(readPref('wallpaper-storage')).toBeNull()
    expect(localStorage.getItem('wallpaper-storage')).toBeNull()
    expect(del).toHaveBeenCalledWith('/prefs/wallpaper-storage')
  })
})

/**
 * Brief 109 — durability. The old flush cleared the batch BEFORE the request
 * and swallowed the rejection, so one blip lost the write forever while the
 * localStorage mirror went on showing it as applied.
 */
describe('a flush that fails', () => {
  const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0))

  it('keeps the entries queued, and a later flush delivers them', async () => {
    const { prefsStorage, flushPrefs, pendingPrefsForTest } = await freshModule()
    put.mockRejectedValueOnce({ response: { status: 503 } })

    prefsStorage.setItem('wallpaper-storage', '{"w":1}')
    flushPrefs()
    await flushMicrotasks()
    expect(put).toHaveBeenCalledTimes(1)
    // Still ours: the server never confirmed it.
    expect(pendingPrefsForTest()).toEqual({ 'wallpaper-storage': '{"w":1}' })

    put.mockResolvedValueOnce({ data: { written: 1, updatedAt: {} } })
    flushPrefs()
    await flushMicrotasks()
    expect(put).toHaveBeenCalledTimes(2)
    expect(pendingPrefsForTest()).toEqual({})
  })

  it('a newer write during the failed flight wins over the re-queue', async () => {
    const { prefsStorage, flushPrefs, pendingPrefsForTest } = await freshModule()
    let reject!: (e: unknown) => void
    put.mockReturnValueOnce(
      new Promise((_res, rej) => {
        reject = rej
      })
    )

    prefsStorage.setItem('wallpaper-storage', '{"w":1}')
    flushPrefs()
    // The user changes it again while the first PUT is still in the air.
    prefsStorage.setItem('wallpaper-storage', '{"w":2}')
    reject({ response: { status: 500 } })
    await flushMicrotasks()

    expect(pendingPrefsForTest()).toEqual({ 'wallpaper-storage': '{"w":2}' })
  })

  it('a definitive 4xx drops the batch instead of looping', async () => {
    const { prefsStorage, flushPrefs, pendingPrefsForTest } = await freshModule()
    put.mockRejectedValueOnce({ response: { status: 400 } })

    prefsStorage.setItem('wallpaper-storage', '{"w":1}')
    flushPrefs()
    await flushMicrotasks()

    expect(pendingPrefsForTest()).toEqual({})
  })

  it('a 401 HOLDS the batch — the write is fine, the session is not', async () => {
    const { prefsStorage, flushPrefs, pendingPrefsForTest, prefsWaitingForAuth } =
      await freshModule()
    put.mockRejectedValueOnce({ response: { status: 401 } })

    prefsStorage.setItem('wallpaper-storage', '{"w":1}')
    flushPrefs()
    await flushMicrotasks()
    expect(pendingPrefsForTest()).toEqual({ 'wallpaper-storage': '{"w":1}' })
    expect(prefsWaitingForAuth()).toBe(true)

    // Re-auth: AuthGate calls flushPrefs on the authenticated transition.
    put.mockResolvedValueOnce({ data: { written: 1, updatedAt: {} } })
    flushPrefs()
    await flushMicrotasks()
    expect(pendingPrefsForTest()).toEqual({})
    expect(prefsWaitingForAuth()).toBe(false)
  })

  it('two overlapping flushes never double-send', async () => {
    const { prefsStorage, flushPrefs } = await freshModule()
    let resolve!: (v: unknown) => void
    put.mockReturnValueOnce(
      new Promise((res) => {
        resolve = res
      })
    )

    prefsStorage.setItem('wallpaper-storage', '{"w":1}')
    flushPrefs()
    flushPrefs() // while the first is still in flight
    expect(put).toHaveBeenCalledTimes(1)

    resolve({ data: { written: 1, updatedAt: {} } })
    await flushMicrotasks()
    // Nothing left to send, so the queued follow-up is a no-op.
    expect(put).toHaveBeenCalledTimes(1)
  })
})
