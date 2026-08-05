/**
 * Countdown timers as pure transitions over `(timer, now)`.
 *
 * The rule the whole model exists to protect: **remaining time is always derived
 * from a timestamp**, never accumulated by counting interval ticks. A running
 * timer stores the instant it reaches zero (`endAt`) and a paused one stores the
 * remaining span, so pausing, resuming, a throttled background tab, or a slow
 * render can never make the countdown drift. Brief 71 calls this out as the
 * regression surface for the multiple-timers change, which is exactly the kind
 * of rewrite that reintroduces tick-counting — so the transitions live here,
 * take `now` as an argument, and are unit-tested.
 */

export type TimerEntry = {
  id: string
  /** Optional name — "Tea", "Pasta". Empty is fine and common. */
  label: string
  /** Configured length, restored by Reset. */
  durationMs: number
  /** Instant the countdown reaches zero. Non-null only while running. */
  endAt: number | null
  /** Remaining span while paused (and before the first start). */
  pausedRemainingMs: number
  running: boolean
  /** True once it has notified for this run — stops it firing twice. */
  fired: boolean
}

export const DEFAULT_TIMER_MS = 5 * 60 * 1000

export function createTimer(id: string, label: string, durationMs: number): TimerEntry {
  return {
    id,
    label,
    durationMs,
    endAt: null,
    pausedRemainingMs: durationMs,
    running: false,
    fired: false,
  }
}

/**
 * Remaining ms. The single source of the displayed value.
 *
 * Clamped at both ends. Zero is obvious; the upper clamp is there because a
 * countdown can never have more time left than its own length, and a caller
 * holding a `now` from before `start()` would otherwise compute one that does —
 * which is exactly what put `00:08` on a 6-second timer for a moment.
 */
export function remainingMs(timer: TimerEntry, now: number): number {
  if (timer.running && timer.endAt !== null) {
    return Math.min(timer.durationMs, Math.max(0, timer.endAt - now))
  }
  return timer.pausedRemainingMs
}

export function isDue(timer: TimerEntry, now: number): boolean {
  return timer.running && timer.endAt !== null && !timer.fired && now >= timer.endAt
}

/** Start (or resume): the remaining span becomes an end instant. */
export function start(timer: TimerEntry, now: number): TimerEntry {
  if (timer.running) return timer
  const remaining = timer.pausedRemainingMs > 0 ? timer.pausedRemainingMs : timer.durationMs
  return {
    ...timer,
    running: true,
    fired: false,
    endAt: now + remaining,
    pausedRemainingMs: remaining,
  }
}

/** Pause: the end instant becomes a remaining span. The inverse of `start`. */
export function pause(timer: TimerEntry, now: number): TimerEntry {
  if (!timer.running || timer.endAt === null) return timer
  return {
    ...timer,
    running: false,
    endAt: null,
    pausedRemainingMs: Math.max(0, timer.endAt - now),
  }
}

export function reset(timer: TimerEntry): TimerEntry {
  return {
    ...timer,
    running: false,
    endAt: null,
    pausedRemainingMs: timer.durationMs,
    fired: false,
  }
}

/** Change the configured length. Refused while running — that is a Reset first. */
export function setDuration(timer: TimerEntry, durationMs: number): TimerEntry {
  if (timer.running) return timer
  return { ...timer, durationMs, pausedRemainingMs: durationMs, fired: false }
}

export function complete(timer: TimerEntry): TimerEntry {
  return { ...timer, running: false, endAt: null, pausedRemainingMs: 0, fired: true }
}

/** Nothing sensible asks for a countdown longer than a day. */
export const MAX_TIMER_MS = 24 * 60 * 60 * 1000

/**
 * Parse what the user typed into the custom-duration box.
 *
 * A bare number stays **minutes**, which is what the box has always meant (and
 * what the presets next to it are). Anything with a colon is read as clock parts:
 * `0:30` is thirty seconds, `1:30` is ninety, `1:02:03` is an hour and change.
 * That colon form is the point of this function — before it, the shortest timer
 * you could set was one minute, which made even "check this in 30 seconds"
 * impossible to express.
 *
 * Returns null for anything unusable, so the caller can simply refuse.
 */
export function parseDurationInput(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null

  if (trimmed.includes(':')) {
    const parts = trimmed.split(':')
    if (parts.length > 3) return null
    if (!parts.every((p) => /^\d{1,3}$/.test(p.trim()))) return null
    const numbers = parts.map((p) => Number(p.trim()))
    // The last two fields are minutes and seconds, so they are base-60; only the
    // leading field may exceed 59 ("90:00" is a legitimate ninety minutes).
    const [h, m, s] = parts.length === 3 ? numbers : [0, ...numbers]
    if (parts.length === 3 && (m > 59 || s > 59)) return null
    if (parts.length === 2 && s > 59) return null
    const ms = (h * 3600 + m * 60 + s) * 1000
    if (ms <= 0 || ms > MAX_TIMER_MS) return null
    return ms
  }

  const minutes = Number(trimmed)
  if (!Number.isFinite(minutes) || minutes <= 0) return null
  const ms = Math.round(minutes * 60_000)
  if (ms <= 0 || ms > MAX_TIMER_MS) return null
  return ms
}

/** Notification body — names the timer when it has a name. */
export function completionBody(timer: TimerEntry, formatted: string): string {
  return timer.label
    ? `“${timer.label}” (${formatted}) reached zero.`
    : `Your ${formatted} countdown reached zero.`
}
