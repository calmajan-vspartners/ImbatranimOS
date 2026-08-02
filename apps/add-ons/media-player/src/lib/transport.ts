/** The skip the user asked for, on the dedicated buttons. */
export const SKIP_SECONDS = 5

/** Arrow-key skip, and the shifted (coarse) variant — VLC's own tiering. */
export const ARROW_SKIP_SECONDS = 10
export const COARSE_SKIP_SECONDS = 60

export const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4] as const

/**
 * Clamp a seek target into the playable range.
 *
 * `duration` is NaN until metadata loads and Infinity for a live stream; both
 * must be treated as "cannot seek" rather than producing a NaN currentTime,
 * which silently wedges the element.
 */
export function clampSeek(target: number, duration: number): number | null {
  if (!Number.isFinite(duration) || duration <= 0) return null
  if (!Number.isFinite(target)) return null
  return Math.min(duration, Math.max(0, target))
}

/** Read a media element's buffered ranges as plain pairs. */
export function bufferedRanges(el: { buffered: TimeRanges }): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < el.buffered.length; i++) {
    out.push([el.buffered.start(i), el.buffered.end(i)])
  }
  return out
}
