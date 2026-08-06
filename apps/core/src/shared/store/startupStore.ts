import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { prefsStorage } from '../../lib/prefs'

/**
 * Startup apps — what opens when you sit down at the machine (brief 82).
 *
 * An **ordered** list of app ids, because order decides which window ends up on
 * top: the last one opened is the focused one, so "Terminal, then Files" and
 * "Files, then Terminal" are different arrangements and a user who bothers to set
 * this has an opinion about which they get.
 *
 * A dotfile, not session state (brief 49): it belongs to the account, so a new
 * tab or a different browser boots the same way. The *window layout* is
 * deliberately the opposite — per tab, and not restored across tabs — and keeping
 * those two on opposite sides of that line is the whole point of this feature.
 * See `runStartupApps` for how they cooperate rather than fight.
 */
type StartupStore = {
  /** App ids, in the order they should open. */
  apps: string[]
  /** Add or remove one app, keeping the rest of the order intact. */
  toggle: (id: string) => void
  /** Move an entry one place earlier or later. A no-op at either end. */
  move: (id: string, delta: -1 | 1) => void
  /** Replace the list wholesale — used by "Use my current windows". */
  setApps: (ids: string[]) => void
  clear: () => void
}

/** De-duplicate while keeping first-seen order. */
function unique(ids: string[]): string[] {
  return [...new Set(ids)]
}

export const useStartupStore = create<StartupStore>()(
  persist(
    (set) => ({
      apps: [],
      toggle: (id) =>
        set((s) => ({
          apps: s.apps.includes(id) ? s.apps.filter((a) => a !== id) : [...s.apps, id],
        })),
      move: (id, delta) =>
        set((s) => {
          const from = s.apps.indexOf(id)
          const to = from + delta
          if (from === -1 || to < 0 || to >= s.apps.length) return s
          const next = [...s.apps]
          // Swap rather than splice-and-insert: for a single-step move they are
          // the same result, and the swap cannot silently drop an entry.
          ;[next[from], next[to]] = [next[to], next[from]]
          return { apps: next }
        }),
      setApps: (ids) => set({ apps: unique(ids) }),
      clear: () => set({ apps: [] }),
    }),
    {
      name: 'imbatranimos:startup',
      // Registered in DOTFILE_KEYS — without that entry `writePref` drops it and
      // the list never leaves this browser (brief 81 learned that the hard way).
      storage: createJSONStorage(() => prefsStorage),
    }
  )
)
