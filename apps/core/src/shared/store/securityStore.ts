import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Security preferences (brief 97). User config, not session state — a
 * brief-49-shaped pref persisted under the house key style so the eventual
 * dotfiles migration can sweep it.
 */
export type IdleLockMinutes = 0 | 5 | 15 | 30

/**
 * 15 minutes by default: the deployment story is "exposable to the internet
 * behind Caddy", and the cost of a surprise lock is one password entry.
 */
export const DEFAULT_IDLE_LOCK_MINUTES: IdleLockMinutes = 15

type SecurityStore = {
  /** 0 = never auto-lock. */
  idleLockMinutes: IdleLockMinutes
  setIdleLockMinutes: (m: IdleLockMinutes) => void
}

export const useSecurityStore = create<SecurityStore>()(
  persist(
    (set) => ({
      idleLockMinutes: DEFAULT_IDLE_LOCK_MINUTES,
      setIdleLockMinutes: (idleLockMinutes) => set({ idleLockMinutes }),
    }),
    { name: 'imbatranimos:security' }
  )
)
