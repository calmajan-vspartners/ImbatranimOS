/**
 * Pure idle-lock controller (brief 97). DOM-free so it tests under the node
 * environment: the hook wires real listeners and media detection around it.
 *
 * Timestamp-driven like the Clock (brief 71): activity only stamps
 * `lastActivity` — cheap enough to call from a throttled pointermove — and a
 * single timer fires at the computed deadline. At fire time the controller
 * re-checks the arithmetic (browsers throttle background-tab timers, and a
 * stamp may have arrived while the timer was pending) and either locks,
 * re-arms for the remainder, or — when media is playing — treats playback as
 * activity and re-arms a full period.
 */
export type IdleLockDeps = {
  /** Idle period before locking. `null` disables the controller. */
  timeoutMs: number | null
  onLock: () => void
  /** A playing <audio>/<video> holds the lock, like a screensaver inhibitor. */
  isMediaPlaying: () => boolean
  now?: () => number
}

export type IdleLockController = {
  /** Stamp user activity. Never schedules work — safe to call at pointermove rate. */
  markActivity: () => void
  /**
   * Re-evaluate immediately (visibilitychange → visible). A background tab's
   * throttled timer may fire late; this locks on time when the tab returns.
   */
  checkNow: () => void
  /** Change the period (Settings edit mid-countdown). `null` disables. */
  setTimeoutMs: (ms: number | null) => void
  dispose: () => void
}

export function createIdleLock(deps: IdleLockDeps): IdleLockController {
  const now = deps.now ?? Date.now
  let timeoutMs = deps.timeoutMs
  let lastActivity = now()
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  function clearTimer() {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  function arm(delayMs: number) {
    clearTimer()
    timer = setTimeout(fire, delayMs)
  }

  function fire() {
    timer = undefined
    if (disposed || timeoutMs === null) return
    const remaining = lastActivity + timeoutMs - now()
    if (remaining > 0) {
      // Activity arrived while the timer was pending — sleep out the remainder.
      arm(remaining)
      return
    }
    if (deps.isMediaPlaying()) {
      // Playback counts as continuous activity: stamp and start a fresh period.
      lastActivity = now()
      arm(timeoutMs)
      return
    }
    deps.onLock()
    // Locking unmounts the desktop (and this controller with it); if the caller
    // keeps it alive anyway, start a fresh period rather than lock-looping.
    lastActivity = now()
    arm(timeoutMs)
  }

  function start() {
    lastActivity = now()
    if (timeoutMs !== null) arm(timeoutMs)
  }

  start()

  return {
    markActivity: () => {
      lastActivity = now()
    },
    checkNow: () => {
      if (disposed || timeoutMs === null) return
      if (lastActivity + timeoutMs - now() <= 0) fire()
    },
    setTimeoutMs: (ms) => {
      timeoutMs = ms
      clearTimer()
      // A changed period measures from now, not from the stale stamp — changing
      // "30 min" to "5 min" after 20 idle minutes should not lock instantly.
      start()
    },
    dispose: () => {
      disposed = true
      clearTimer()
    },
  }
}
