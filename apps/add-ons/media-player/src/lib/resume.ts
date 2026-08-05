/**
 * Resume-position rules.
 *
 * Two thresholds, both there to stop the feature becoming noise:
 *
 * - Nothing under a minute is remembered. A folder of 30-second clips would otherwise
 *   accumulate 30 entries nobody wants, and "resume at 0:09" is not a feature.
 * - A position within the last 15 seconds is treated as finished. Sitting on the last
 *   frame of a film and reopening it should start it again, not drop you back on the
 *   credits with a "resume" offer.
 */

/** Below this, a position is not worth remembering. */
export const RESUME_MIN_SECONDS = 60

/** Within this of the end, the item counts as watched through. */
export const RESUME_TAIL_SECONDS = 15

/** How many positions to keep. Old entries are dropped oldest-first. */
export const RESUME_MAX_ENTRIES = 200

/** Stable key for a file, since the same path exists in more than one FS root. */
export function resumeKey(root: string, path: string): string {
  return `${root}:${path}`
}

/** Should this position be written down at all? */
export function shouldRemember(position: number, duration: number): boolean {
  if (!Number.isFinite(position) || !Number.isFinite(duration)) return false
  if (position < RESUME_MIN_SECONDS) return false
  return position <= duration - RESUME_TAIL_SECONDS
}

/**
 * Should a stored position be offered, now that the duration is known?
 *
 * Duration is checked because a file can be replaced on disk between sessions: a stored
 * position past the end of the file it now names would seek nowhere useful.
 */
export function shouldResume(stored: number | undefined, duration: number): boolean {
  if (stored === undefined) return false
  if (!Number.isFinite(duration) || duration <= 0) return false
  return stored >= RESUME_MIN_SECONDS && stored <= duration - RESUME_TAIL_SECONDS
}

/**
 * The resume map with `key` updated, trimmed to the cap.
 *
 * A new object rather than a mutation: this value lives in React state, and mutating it
 * would skip the re-render that draws the new position — and trip the immutability lint
 * rule that exists for exactly that reason.
 */
export function rememberPosition(
  map: Readonly<Record<string, number>>,
  key: string,
  position: number,
  cap = RESUME_MAX_ENTRIES
): Record<string, number> {
  // Re-inserting moves the key to the end of the insertion order, which is what makes the
  // trim below drop genuinely stale entries rather than recently-played ones.
  const next: Record<string, number> = {}
  for (const [k, v] of Object.entries(map)) {
    if (k !== key) next[k] = v
  }
  next[key] = position
  const keys = Object.keys(next)
  if (keys.length <= cap) return next
  const trimmed: Record<string, number> = {}
  for (const k of keys.slice(keys.length - cap)) trimmed[k] = next[k]
  return trimmed
}

/** The resume map with `key` removed (used by "start over"). */
export function forgetPosition(
  map: Readonly<Record<string, number>>,
  key: string
): Record<string, number> {
  const next: Record<string, number> = {}
  for (const [k, v] of Object.entries(map)) {
    if (k !== key) next[k] = v
  }
  return next
}
