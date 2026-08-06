import { useEffect, useState, type ReactNode } from 'react'
import { useAuthStore } from './store/authStore'
import { flushPrefs, hydratePrefs } from '../../lib/prefs'
import { rehydrateDotfileStores } from '../../shared/store/dotfiles'
import { LockScreen } from './LockScreen'
import { FirstRunWizard, AuthShell } from './FirstRunWizard'

/**
 * Gates the entire desktop. Unauthenticated visitors see only the first-run
 * wizard (no user yet) or the lock screen; the desktop mounts only after login.
 *
 * It is also where the dotfiles are hydrated (brief 49), for a reason that is
 * not incidental: `/api/prefs` is behind the session guard, so there is exactly
 * one moment when it becomes both **necessary and possible** to read it — the
 * transition into `authenticated`. Fetching earlier is a guaranteed 401 on every
 * boot; fetching later means the desktop paints with defaults first.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const ready = useAuthStore((s) => s.ready)
  const authenticated = useAuthStore((s) => s.authenticated)
  const needsSetup = useAuthStore((s) => s.needsSetup)
  const setupTokenRequired = useAuthStore((s) => s.setupTokenRequired)
  const refresh = useAuthStore((s) => s.refresh)
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)

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

  // A 401 on any protected route (session expired/revoked) re-locks the UI.
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
  if (!authenticated) {
    return <LockScreen onUnlock={() => void refresh()} />
  }
  if (!prefsReady) {
    return (
      <AuthShell title="Starting up…" subtitle="Reading your settings.">
        {null}
      </AuthShell>
    )
  }
  return <>{children}</>
}
