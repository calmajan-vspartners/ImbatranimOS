/**
 * Parsing of the pre-brief-71 `localStorage` clock state.
 *
 * Split out from `migrateLegacyClock.ts` (which does the IO and the notifying) so
 * the awkward inputs — truncated JSON, a hand-edited key, the bare pre-zustand
 * shape, an alarm with a nonsense time — can be unit-tested without a browser.
 */

/** The key zustand's persist middleware wrote to. */
export const LEGACY_KEY = 'imbatranimos:clock'

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/

/** Matches the backend's label cap, so nothing is rejected at the door. */
const MAX_LABEL = 120

export type LegacyState = {
  worldClocks: { label: string; timeZone: string }[]
  alarms: { label: string; time: string; enabled: boolean }[]
  /** Entries that were present but unusable — reported, never silently dropped. */
  skipped: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Parse the legacy blob defensively.
 *
 * Returns `null` when there is nothing to migrate at all, so the caller can tell
 * "no legacy data" from "legacy data that was all junk".
 */
export function readLegacyClockState(raw: string | null): LegacyState | null {
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null

  // zustand's persist wraps state as { state, version }; the bare shape is
  // accepted too, in case a key was ever written by hand.
  const state = isRecord(parsed.state) ? parsed.state : parsed

  const worldClocks: LegacyState['worldClocks'] = []
  const alarms: LegacyState['alarms'] = []
  let skipped = 0

  if (Array.isArray(state.worldClocks)) {
    for (const entry of state.worldClocks) {
      if (
        isRecord(entry) &&
        typeof entry.timeZone === 'string' &&
        entry.timeZone.length > 0 &&
        entry.timeZone.length <= 100
      ) {
        const label = typeof entry.label === 'string' && entry.label ? entry.label : entry.timeZone
        worldClocks.push({ label: label.slice(0, MAX_LABEL), timeZone: entry.timeZone })
      } else {
        skipped++
      }
    }
  }

  if (Array.isArray(state.alarms)) {
    for (const entry of state.alarms) {
      if (isRecord(entry) && typeof entry.time === 'string' && HH_MM.test(entry.time)) {
        alarms.push({
          label: typeof entry.label === 'string' ? entry.label.slice(0, MAX_LABEL) : '',
          // Anything other than an explicit `false` stays armed: losing an alarm
          // is the failure that matters here.
          time: entry.time,
          enabled: entry.enabled !== false,
        })
      } else {
        skipped++
      }
    }
  }

  if (worldClocks.length === 0 && alarms.length === 0 && skipped === 0) return null
  return { worldClocks, alarms, skipped }
}

/** What the user is told once their data has moved. */
export function describeMigration(worldClocks: number, alarms: number): string {
  const parts: string[] = []
  if (alarms > 0) parts.push(`${alarms} alarm${alarms === 1 ? '' : 's'}`)
  if (worldClocks > 0) parts.push(`${worldClocks} world clock${worldClocks === 1 ? '' : 's'}`)
  return `${parts.join(' and ')} moved out of this browser and into your computer, so they are the same from anywhere you open it.`
}
