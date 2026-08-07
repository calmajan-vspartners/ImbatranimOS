import { useEffect, useState, type ReactNode } from 'react'
import { useAuthStore } from './store/authStore'
import { flushPrefs, hydratePrefs } from '../../lib/prefs'
import { rehydrateDotfileStores } from '../../shared/store/dotfiles'
import { LockScreen } from './LockScreen'
import { FirstRunWizard, AuthShell } from './FirstRunWizard'

/**
 * Gates the entire desktop, in two regimes (brief 101):
 *
 * **Before this tab's first login** it behaves as it always has — only the
 * first-run wizard or the full-screen lock exists; nothing desktop-shaped
 * mounts or fetches.
 *
 * **After** (`everAuthenticated`), locking and session loss become an OPAQUE
 * OVERLAY over the still-mounted desktop instead of a teardown. That is the
 * whole point: unmounting closed the Terminal's socket (the backend kills the
 * pty on close), discarded every dirty editor buffer, and reset every window's
 * state — fifteen idle minutes cost real work. The tree beneath the overlay is
 * `visibility:hidden` + `inert` + `aria-hidden`, so nothing paints, nothing
 * focuses, and a screen reader cannot walk it; the keyboard chokepoints gate on
 * `isShellSuspended()` besides. Explicit sign-out still tears everything down —
 * walking away on purpose means the screen owes you nothing.
 *
 * It is also where the dotfiles are hydrated (brief 49): `/api/prefs` is behind
 * the session guard, so the transition into `authenticated` is the one moment
 * hydration is both necessary and possible.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const ready = useAuthStore((s) => s.ready)
  const authenticated = useAuthStore((s) => s.authenticated)
  const locked = useAuthStore((s) => s.locked)
  const everAuthenticated = useAuthStore((s) => s.everAuthenticated)
  const needsSetup = useAuthStore((s) => s.needsSetup)
  const setupTokenRequired = useAuthStore((s) => s.setupTokenRequired)
  const refresh = useAuthStore((s) => s.refresh)
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)
  const unlock = useAuthStore((s) => s.unlock)

  const [prefsReady, setPrefsReady] = useState(false)

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Hydrate the dotfiles the moment there is a session to read them with, and
  // hold the desktop for that one round trip. The alternative is a visible flip
  // from the default wallpaper and accent to the real ones on every load.
  useEffect(() => {
    if (!authenticated) return
    let cancelled = false
    void hydratePrefs()
      .then(() => rehydrateDotfileStores())
      .then(() => {
        if (!cancelled) setPrefsReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [authenticated])

  // A change made just before the tab closes should still reach the server.
  useEffect(() => {
    const flush = () => flushPrefs()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // A 401 on any protected route (session expired/revoked) suspends the UI.
  // With `everAuthenticated` latched this now means "overlay", not "unmount" —
  // buffers survive; the shell process honestly does not (the pty revoke sweep
  // reaps invalid sessions server-side, which is a security behaviour).
  useEffect(() => {
    const onUnauthorized = () => setAuthenticated(false)
    window.addEventListener('auth:unauthorized', onUnauthorized)
    return () => window.removeEventListener('auth:unauthorized', onUnauthorized)
  }, [setAuthenticated])

  if (!ready) {
    return (
      <AuthShell title="Starting up…" subtitle="Waking the machine.">
        {null}
      </AuthShell>
    )
  }
  if (needsSetup) {
    return <FirstRunWizard tokenRequired={setupTokenRequired} onDone={() => void refresh()} />
  }
  // Pre-desktop: this tab has never been signed in, so there is nothing to
  // keep alive — the full-screen lock is the only thing that exists.
  if (!authenticated && !everAuthenticated) {
    return <LockScreen onUnlock={() => void refresh()} />
  }
  if (!prefsReady) {
    return (
      <AuthShell title="Starting up…" subtitle="Reading your settings.">
        {null}
      </AuthShell>
    )
  }

  const suspended = locked || !authenticated

  return (
    <>
      {/* visibility:hidden (not display:none) keeps layout untouched, so xterm,
          Monaco and canvases wake with correct geometry; inert + aria-hidden
          make the hidden tree unfocusable and invisible to assistive tech. */}
      <div
        className="h-full w-full"
        style={suspended ? { visibility: 'hidden' } : undefined}
        inert={suspended || undefined}
        aria-hidden={suspended || undefined}
      >
        {children}
      </div>
      {suspended && (
        <div className="fixed inset-0 z-[9999]">
          <LockScreen
            onUnlock={() => {
              // Unlock covers both suspensions: a plain lock (session still
              // valid — login renewed it in place) and a hard-expired session
              // (login minted a fresh one). refresh() re-syncs either way.
              unlock()
              void refresh()
            }}
          />
        </div>
      )}
    </>
  )
}
