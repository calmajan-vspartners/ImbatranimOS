import type { SystemHandle } from '@imbatranim/ui'
import { importEvents } from './api/calendarApi'
import { LEGACY_KEY, describeMigration, readLegacyCalendarState } from './legacyCalendarState'

/**
 * One-time hand-over of the pre-brief-72 `localStorage` calendar.
 *
 * The same shape Clock's migration uses (brief 71): exactly-once is enforced on the
 * **server** — the import refuses a non-empty table — rather than by a flag here,
 * because two tabs opening at the same moment would both find the same key.
 *
 * The key is removed only after a successful adoption. If the container already had
 * events, this browser's copy is left alone rather than thrown away: it may be the
 * only copy of a calendar built on a different machine.
 */

/** Guard so the hand-over is attempted once per page load, not once per mount. */
let attempted = false

export async function migrateLegacyCalendar(system: SystemHandle): Promise<boolean> {
  if (attempted) return false
  attempted = true

  let raw: string | null
  try {
    raw = localStorage.getItem(LEGACY_KEY)
  } catch {
    // A browser with storage disabled has nothing to hand over.
    return false
  }
  if (raw === null) return false

  const legacy = readLegacyCalendarState(raw)
  if (legacy === null || legacy.events.length === 0) {
    forgetLegacyKey()
    return false
  }

  try {
    const result = await importEvents(system.http, legacy.events, true)
    if (result.imported === 0) return false

    forgetLegacyKey()
    system.notify({
      title: 'Calendar moved into your computer',
      body: describeMigration(result.imported),
      level: 'success',
    })
    if (legacy.skipped > 0) {
      system.notify({
        title: 'Some old events were skipped',
        body: `${legacy.skipped} entr${legacy.skipped === 1 ? 'y was' : 'ies were'} unreadable and could not be moved.`,
        level: 'warning',
      })
    }
    return true
  } catch {
    // Offline, or a payload the server rejected: leave the key alone and let the
    // next load try again.
    attempted = false
    return false
  }
}

function forgetLegacyKey(): void {
  try {
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    // Harmless: the server refuses a second onlyIfEmpty import anyway.
  }
}
