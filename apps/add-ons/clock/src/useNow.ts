import { useEffect, useState } from 'react'

/**
 * Ticks a `Date.now()` timestamp on an interval so a component re-renders to
 * show a live clock/countdown. The returned number is ONLY a render trigger —
 * callers should always recompute elapsed/remaining time from their own
 * stored timestamps (Date.now() - startedAt, etc.) rather than trusting tick
 * counts, so drift/throttling never accumulates.
 *
 * Pass `active = false` to stop ticking (e.g. a paused stopwatch) without
 * unmounting the component.
 *
 * The zero-delay catch-up matters: while inactive, this value is frozen at
 * whenever it was last read, so the first render after `active` flips true would
 * otherwise use a stale `now`. Measured on a 6-second timer, that showed `00:08`
 * for 263ms after pressing Start (the timer's `endAt` was in the future, `now` was
 * from before the click). One task-queue turn instead of one interval closes it.
 */
export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    const tick = () => setNow(Date.now())
    const catchUp = setTimeout(tick, 0)
    const id = setInterval(tick, intervalMs)
    return () => {
      clearTimeout(catchUp)
      clearInterval(id)
    }
  }, [intervalMs, active])

  return now
}
