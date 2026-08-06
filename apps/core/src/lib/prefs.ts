import type { StateStorage } from 'zustand/middleware'
import { api } from './axios'

/**
 * Server-backed dotfiles, with a local mirror for the first paint (brief 49).
 *
 * ## Why not server-only, as the brief says
 *
 * The brief says to replace each store's `persist(localStorage)` with a
 * server-backed adapter. For three of the four stores that is exactly right. For
 * **appearance it cannot be**, and the reason is structural rather than a
 * preference: `main.tsx` applies the theme and accent *synchronously, before
 * React mounts*, so that the very first paint — the lock screen — is branded.
 * That paint happens **before the user has authenticated**, and `/api/prefs` is
 * behind the session guard, as it must be. There is no server to read at the
 * moment the value is needed.
 *
 * So the model is **server as source of truth, localStorage as a first-paint
 * cache**: paint immediately from the cache, hydrate from the server once
 * authenticated, re-apply if they differ, and keep the cache updated. A browser
 * that has never seen this machine paints the default behind the lock and picks
 * up the real values on sign-in, which is correct — your wallpaper lives behind
 * your password.
 *
 * The cache is also what makes the write path cheap: a change updates memory and
 * localStorage at once, and the server write is debounced behind it.
 */

/** Debounce for the write-through. Long enough to coalesce a drag, short enough to survive a close. */
const WRITE_DEBOUNCE_MS = 400

/**
 * Keys that live on the server. Anything not in here is not a dotfile.
 *
 * Adding a store to this list is **not optional bookkeeping** — `writePref`
 * silently drops anything absent, so a store wired to `prefsStorage` without an
 * entry here persists to localStorage only and looks like it works right up
 * until you sign in from a second browser. Brief 81's file associations shipped
 * that way for exactly as long as it took to check the server copy.
 */
export const DOTFILE_KEYS = [
  'imbatranimos:appearance',
  'wallpaper-storage',
  'desktop-storage',
  'imbatranimos:addons',
  'imbatranimos:file-associations',
  'imbatranimos:startup',
] as const

type Cache = Map<string, string>

/** The in-memory mirror. Populated from localStorage at import, server on login. */
const cache: Cache = new Map()
const pendingWrites = new Map<string, string>()
let writeTimer: ReturnType<typeof setTimeout> | undefined
let hydrated = false
let hydrating: Promise<void> | null = null

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Quota or private mode. The server copy is the real one; losing the
    // first-paint cache costs a flash on the next boot, not any data.
  }
}

// Seed the mirror from localStorage at import time, so the synchronous
// first-paint read in main.tsx has something before any network call.
for (const key of DOTFILE_KEYS) {
  const local = readLocal(key)
  if (local !== null) cache.set(key, local)
}

/** True once the server's copy has been merged in. */
export function prefsHydrated(): boolean {
  return hydrated
}

/**
 * Fetch the dotfiles and merge them over the local mirror.
 *
 * Call **after** authentication — the route is guarded, and calling it from the
 * lock screen would be a guaranteed 401 on every boot. Idempotent and
 * de-duplicated, so two callers racing at startup make one request.
 *
 * A key the server does not know keeps its local value **and is pushed up**:
 * that is the migration for anyone who configured this machine before dotfiles
 * existed, and it is a one-liner rather than a separate migration step because
 * "the server has not got it yet" and "this is a legacy local value" are the
 * same condition.
 */
export function hydratePrefs(): Promise<void> {
  if (hydrated) return Promise.resolve()
  if (hydrating) return hydrating
  hydrating = api
    .get<Record<string, string>>('/prefs')
    .then((res) => {
      const server = res.data ?? {}
      const toSeed: { key: string; value: string }[] = []
      for (const key of DOTFILE_KEYS) {
        const remote = server[key]
        if (typeof remote === 'string') {
          cache.set(key, remote)
          writeLocal(key, remote)
        } else {
          const local = cache.get(key)
          if (local !== undefined) toSeed.push({ key, value: local })
        }
      }
      hydrated = true
      if (toSeed.length > 0) {
        void api.put('/prefs', { entries: toSeed }).catch(() => undefined)
      }
    })
    .catch(() => {
      // Unreachable or unauthenticated: keep running on the local mirror. A
      // desktop that refuses to render because it could not read a wallpaper
      // would be a much worse failure than a wrong wallpaper.
      hydrated = false
    })
    .finally(() => {
      hydrating = null
    })
  return hydrating
}

/** Read a dotfile from the mirror. Synchronous by design — see the note above. */
export function readPref(key: string): string | null {
  return cache.get(key) ?? null
}

/** Write a dotfile: mirror immediately, server on a debounce. */
export function writePref(key: string, value: string): void {
  cache.set(key, value)
  writeLocal(key, value)
  // Only push what the server is the owner of. A store that is not a dotfile
  // has no business in this table.
  if (!(DOTFILE_KEYS as readonly string[]).includes(key)) return
  pendingWrites.set(key, value)
  if (writeTimer !== undefined) clearTimeout(writeTimer)
  writeTimer = setTimeout(flushPrefs, WRITE_DEBOUNCE_MS)
}

/**
 * Push any pending writes now.
 *
 * Called on a debounce, and again when the tab is hidden or unloading — a
 * wallpaper changed two hundred milliseconds before closing the tab should not
 * be the one change that does not stick.
 */
export function flushPrefs(): void {
  if (writeTimer !== undefined) {
    clearTimeout(writeTimer)
    writeTimer = undefined
  }
  if (pendingWrites.size === 0) return
  const entries = [...pendingWrites].map(([key, value]) => ({ key, value }))
  pendingWrites.clear()
  void api.put('/prefs', { entries }).catch(() => undefined)
}

/**
 * The zustand `StateStorage` the dotfile stores persist through.
 *
 * Synchronous, which matters: an async storage makes `persist` hydrate on a
 * later tick, and every store that drives a visual would flash its default
 * first. Reading the mirror is synchronous, and the server catches up
 * underneath.
 */
export const prefsStorage: StateStorage = {
  getItem: (name) => readPref(name),
  setItem: (name, value) => writePref(name, value),
  removeItem: (name) => {
    cache.delete(name)
    try {
      localStorage.removeItem(name)
    } catch {
      /* nothing to do */
    }
    void api.delete(`/prefs/${encodeURIComponent(name)}`).catch(() => undefined)
  },
}

/** Test seam: forget everything, as a fresh browser would have it. */
export function resetPrefsForTest(): void {
  cache.clear()
  pendingWrites.clear()
  hydrated = false
  hydrating = null
  if (writeTimer !== undefined) clearTimeout(writeTimer)
  writeTimer = undefined
}

/** Test seam: what the mirror currently holds. */
export function prefsCacheForTest(): Record<string, string> {
  return Object.fromEntries(cache)
}
