/**
 * Queue order and advance rules for shuffle + repeat.
 *
 * The folder order is never mutated. Shuffle produces a *derived* order from a seed, so
 * the underlying listing (name-sorted, the order the Playlist draws) stays intact and
 * turning shuffle off restores it exactly — rather than leaving the user in a folder
 * whose order has been permanently scrambled.
 *
 * Pure and tested because the interesting cases are all off-by-one or wrap-around: the
 * last track with repeat-all, repeat-one on the Next *button* (which must still move),
 * and a queue whose current track has vanished because the folder changed underneath.
 */

export type RepeatMode = 'off' | 'one' | 'all'

/** Why the queue is advancing: the track finished, or the user pressed a button. */
export type AdvanceReason = 'ended' | 'manual'

export const REPEAT_MODES: RepeatMode[] = ['off', 'all', 'one']

/** The next repeat mode in the cycle the button walks through. */
export function nextRepeatMode(mode: RepeatMode): RepeatMode {
  return REPEAT_MODES[(REPEAT_MODES.indexOf(mode) + 1) % REPEAT_MODES.length]
}

/**
 * A small deterministic PRNG (mulberry32), so a shuffle is stable for a given seed.
 *
 * Stability is the point: the order is recomputed on every render, and `Math.random()`
 * inside it would reshuffle the queue continuously — "next track" would mean a different
 * track each time it was read.
 */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A shuffled copy of `paths`.
 *
 * Depends on nothing but the paths and the seed, and that is the whole point. An earlier
 * version pinned the *currently playing* track to the front, so that turning shuffle on
 * would not "jump away" from it — which sounds right and is wrong: the order was then
 * re-derived on every track change, so walking Next re-permuted the queue each time and
 * revisited tracks it had already played. Measured in a browser: a three-track folder
 * played b, c, b.
 *
 * Turning shuffle on does not need a pin, because it does not change what is playing at
 * all — only what `advance` picks next.
 */
export function shuffledOrder(paths: string[], seed: number): string[] {
  const rest = [...paths]
  const random = seeded(seed)
  // Fisher–Yates, back to front.
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return rest
}

/**
 * The path to play next, or `null` to stop.
 *
 * `repeat: 'one'` returns the current track when it *ended* and still moves when the user
 * presses Next — a repeat mode that disables the Next button is a bug, not a feature. The
 * replay itself is done by the media element (see `TrackStage`), because re-selecting the
 * same path changes no state and so would remount nothing.
 */
export function advance(
  order: string[],
  current: string | null,
  direction: 1 | -1,
  repeat: RepeatMode,
  reason: AdvanceReason = 'manual'
): string | null {
  if (order.length === 0) return null
  if (repeat === 'one' && reason === 'ended') return current
  const at = current === null ? -1 : order.indexOf(current)
  // The current track is not in the queue (folder changed, or nothing selected yet):
  // start from whichever end the direction implies rather than returning nothing.
  if (at === -1) return direction === 1 ? order[0] : order[order.length - 1]
  const next = at + direction
  if (next >= 0 && next < order.length) return order[next]
  // Repeat-one wraps too, for *manual* navigation only: it means "this queue does not
  // end", so pressing Next on the last track should reach the first rather than find a
  // dead button. Only `reason: 'ended'` gets the replay behaviour.
  if (repeat === 'all' || repeat === 'one')
    return direction === 1 ? order[0] : order[order.length - 1]
  return null
}

/** Whether a Prev/Next button should be enabled, given the same rules. */
export function canAdvance(
  order: string[],
  current: string | null,
  direction: 1 | -1,
  repeat: RepeatMode
): boolean {
  return advance(order, current, direction, repeat, 'manual') !== null
}
