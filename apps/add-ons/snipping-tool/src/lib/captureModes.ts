/** The delays the launcher offers, in seconds. */
export const DELAYS = [3, 5] as const

/** What arming a capture means. */
export type LaunchMode =
  | { kind: 'region' }
  | { kind: 'fullscreen' }
  | { kind: 'delayed'; seconds: number }
