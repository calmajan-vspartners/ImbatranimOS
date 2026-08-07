import { create } from 'zustand'
import { getStatus } from '../api/authApi'

interface AuthState {
  /** True once the initial status probe has completed (avoids flash of lock). */
  ready: boolean
  authenticated: boolean
  needsSetup: boolean
  totpEnabled: boolean
  /** True when first-run setup must present the operator's SETUP_TOKEN. */
  setupTokenRequired: boolean
  /**
   * Locked = the session is still valid but the screen is covered (brief 101).
   * Distinct from !authenticated on purpose: locking must not end anything —
   * the desktop stays mounted, PTY sockets stay open, dirty buffers survive.
   */
  locked: boolean
  /**
   * True once THIS TAB has shown the desktop. It is what lets a later 401 be
   * an overlay over still-mounted windows instead of a full teardown — and it
   * never leaks anything, because everything beneath the overlay was already
   * on this screen before the session ended.
   */
  everAuthenticated: boolean
  /** Re-fetch auth status from the backend (source of truth). */
  refresh: () => Promise<void>
  /** Optimistically flip authentication (e.g. on a 401 => back to lock). */
  setAuthenticated: (value: boolean) => void
  /** Cover the screen. The session stays valid; unlock re-proves the password. */
  lock: () => void
  unlock: () => void
  /** Explicit sign-out: back to the full pre-desktop experience. */
  resetToLoggedOut: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  ready: false,
  authenticated: false,
  needsSetup: false,
  totpEnabled: false,
  setupTokenRequired: false,
  locked: false,
  everAuthenticated: false,
  refresh: async () => {
    try {
      const status = await getStatus()
      set((prev) => ({
        ready: true,
        authenticated: status.authenticated,
        needsSetup: status.needsSetup,
        totpEnabled: status.totpEnabled,
        setupTokenRequired: status.setupTokenRequired,
        // Latches: once this tab has seen the desktop, it keeps the overlay
        // model until an explicit sign-out. refresh() leaves `locked` alone —
        // a status poll must never unlock the screen.
        everAuthenticated: prev.everAuthenticated || status.authenticated,
      }))
    } catch {
      // Backend unreachable: cover the screen rather than show the desktop.
      set({ ready: true, authenticated: false })
    }
  },
  setAuthenticated: (value) =>
    set((prev) => ({
      authenticated: value,
      everAuthenticated: prev.everAuthenticated || value,
    })),
  lock: () => set({ locked: true }),
  unlock: () => set({ locked: false }),
  resetToLoggedOut: () => set({ authenticated: false, locked: false, everAuthenticated: false }),
}))

/**
 * True while the shell is visually suspended behind the lock overlay — the one
 * question every keyboard chokepoint asks (brief 101). A hidden desktop must
 * eat no keys: typing a password may not Ctrl+S an editor or Delete a file.
 */
export function isShellSuspended(): boolean {
  const s = useAuthStore.getState()
  return s.locked || (s.everAuthenticated && !s.authenticated)
}
