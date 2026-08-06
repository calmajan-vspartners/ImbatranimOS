import { useEffect } from 'react'
import { createIdleLock } from './idleLock'
import { useSecurityStore } from '../store/securityStore'
import { useAuthStore } from '../../modules/auth/store/authStore'

/**
 * Auto-lock after idle (brief 97). Mounted by the shell, which only exists
 * while authenticated — locking unmounts the desktop and this hook with it,
 * so there is nothing to disarm while the lock screen is up.
 *
 * Locking uses the exact Start-menu path (`setAuthenticated(false)`): one lock
 * implementation, no parallel state. The session cookie stays valid; the lock
 * screen re-proves the password (+TOTP when enrolled) as it always has.
 */
export function useIdleLock(): void {
  const minutes = useSecurityStore((s) => s.idleLockMinutes)
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)

  useEffect(() => {
    if (minutes === 0) return

    const ctl = createIdleLock({
      timeoutMs: minutes * 60_000,
      onLock: () => setAuthenticated(false),
      // A playing <audio>/<video> anywhere on the desktop holds the lock, the
      // way real OSes inhibit the screensaver during a movie.
      isMediaPlaying: () =>
        Array.from(document.querySelectorAll<HTMLMediaElement>('audio, video')).some(
          (m) => !m.paused && !m.ended
        ),
    })

    // Activity only stamps a timestamp (no timer churn), so a raw pointermove
    // listener is already cheap — but throttle anyway so the stamp is not
    // written 60×/sec during a drag.
    let lastStamp = 0
    const onActivity = () => {
      const t = Date.now()
      if (t - lastStamp < 1000) return
      lastStamp = t
      ctl.markActivity()
    }
    // Background tabs throttle timers; re-check the deadline when the tab
    // becomes visible again so a due lock lands immediately.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') ctl.checkNow()
    }

    const events: (keyof WindowEventMap)[] = ['pointerdown', 'pointermove', 'keydown', 'wheel']
    for (const e of events) window.addEventListener(e, onActivity, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      for (const e of events) window.removeEventListener(e, onActivity)
      document.removeEventListener('visibilitychange', onVisibility)
      ctl.dispose()
    }
  }, [minutes, setAuthenticated])
}
