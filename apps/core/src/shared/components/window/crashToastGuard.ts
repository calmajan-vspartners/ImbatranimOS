/**
 * Rate limit for "this app crashed" notifications (brief 47).
 *
 * Its own module for two reasons. The lint rule that forced it out of
 * `AppErrorBoundary.tsx` is right — a file mixing components and helpers breaks
 * fast refresh — and separating it makes the policy testable on its own, without
 * mounting anything.
 *
 * The policy: **one toast per app per window of time.** A render loop can throw
 * dozens of times a second, and without this the notification centre becomes a
 * denial of service against itself — the one message the user needs buried under
 * ninety copies of itself. Keyed per app so a second app crashing is still
 * reported; the crash of *another* window is new information.
 */
const TOAST_DEDUPE_MS = 5_000

/** Module-scoped, so a remount cannot reset the guard and re-open the flood. */
const lastToastAt = new Map<string, number>()

/** True when this app's crash should raise a notification. Records the decision. */
export function shouldReportCrash(appId: string, now = Date.now()): boolean {
  const previous = lastToastAt.get(appId) ?? 0
  if (now - previous < TOAST_DEDUPE_MS) return false
  lastToastAt.set(appId, now)
  return true
}

/** Forget the history. For tests, and for nothing else. */
export function resetCrashToastHistory(): void {
  lastToastAt.clear()
}
