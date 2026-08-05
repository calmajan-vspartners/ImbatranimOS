import { notify } from '@imbatranim/core'
import { importClockState } from './api/clockApi'
import { LEGACY_KEY, describeMigration, readLegacyClockState } from './legacyClockState'

/**
 * One-time hand-over of the pre-brief-71 `localStorage` state.
 *
 * Until brief 71 the clock persisted through zustand to `imbatranimos:clock`,
 * which meant world clocks and alarms lived in whichever browser opened the OS.
 * Now they live in the container. A silent switch would read as data loss to
 * anyone who has been using it, so on first load the old state is handed over —
 * and the user is told it happened.
 *
 * Exactly-once is enforced on the server (it refuses to import into a non-empty
 * table), not by a flag here: two tabs opening at the same moment would both find
 * the same key.
 */

/** Guard so the hand-over is attempted once per page load, not once per mount. */
let attempted = false

/**
 * Hand the legacy state over, if any is still sitting in this browser.
 *
 * Resolves to true when something was actually imported, so the caller can
 * refetch. The key is removed only on a successful adoption — if the container
 * already had clock data, this browser's copy is left alone rather than thrown
 * away, because it may be the only copy of alarms set on a *different* machine.
 */
export async function migrateLegacyClockState(): Promise<boolean> {
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

  const legacy = readLegacyClockState(raw)
  if (legacy === null || legacy.worldClocks.length + legacy.alarms.length === 0) {
    // Nothing usable in there; the key is dead weight.
    forgetLegacyKey()
    return false
  }

  try {
    const result = await importClockState({
      worldClocks: legacy.worldClocks,
      alarms: legacy.alarms,
    })
    if (!result.imported) return false

    forgetLegacyKey()
    notify({
      title: 'Clock data moved into your computer',
      body: describeMigration(result.worldClocks, result.alarms),
      appId: 'clock',
      level: 'success',
    })
    if (legacy.skipped > 0) {
      notify({
        title: 'Some old clock entries were skipped',
        body: `${legacy.skipped} entr${legacy.skipped === 1 ? 'y was' : 'ies were'} unreadable and could not be moved.`,
        appId: 'clock',
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
    // A browser that refuses to remove it will simply be asked again; the server
    // refuses a second import either way.
  }
}
