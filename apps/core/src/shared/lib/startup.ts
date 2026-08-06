import { APP_REGISTRY } from '../registry/registry'
import { NON_DISABLEABLE } from '../registry/enabledApps'
import { useAddonStore } from '../store/addonStore'
import { useStartupStore } from '../store/startupStore'
import { useWindowStore } from '../store/windowStore'
import { openApp } from '../intents/openApp'

/**
 * Startup apps (brief 82) — opening the set, exactly once, without fighting the
 * layout restore.
 *
 * ## The brief's premise was out of date, and it matters
 *
 * Brief 82 says brief 49 "deliberately deletes" the layout restore, so every load
 * lands on a bare desktop. That is not what 49 shipped: it moved the layout to
 * **`sessionStorage`**, so a *reload of the same tab* still restores its windows
 * and only a *new tab* starts bare. Written to the brief's premise, this feature
 * would re-open the startup set on every reload **on top of** the windows that
 * just came back — doubling every multi-instance app and stealing focus from
 * whatever the user had in front. So the rule has to be sharper than "once per
 * session":
 *
 * 1. **Never when a layout was restored.** Those windows *are* the session's
 *    arrangement; the startup set already ran when it was created.
 * 2. **Never twice in one tab**, even when the desktop is empty — closing all
 *    your windows and reloading must not resurrect them. The marker lives in
 *    `sessionStorage`, so it shares its lifetime with the layout it guards, and a
 *    duplicated tab (which copies `sessionStorage`) inherits both together.
 *
 * The `sessionStorage`/dotfile split is exactly the brief's own model, applied one
 * level further in than the brief could see.
 */
const RAN_KEY = 'imbatranimos:startup-ran'

function sessionFlag(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function startupHasRun(): boolean {
  try {
    return sessionFlag()?.getItem(RAN_KEY) === '1'
  } catch {
    return false
  }
}

export function markStartupRan(): void {
  try {
    sessionFlag()?.setItem(RAN_KEY, '1')
  } catch {
    // Private mode or quota. Worst case the set opens again on the next reload,
    // which is a mild annoyance — not a reason to skip the feature.
  }
}

/** Test seam: forget that this tab has booted. */
export function resetStartupForTest(): void {
  try {
    sessionFlag()?.removeItem(RAN_KEY)
  } catch {
    /* nothing to do */
  }
}

/**
 * Which of the configured apps would actually open right now.
 *
 * Skips ids the registry no longer has (an app removed from the tree must not
 * leave a permanently broken boot) and apps the user has disabled (brief 46) —
 * a disabled app in the startup list is *skipped*, never resurrected. Settings
 * shows the same computation, so what the list says is what boot does.
 */
export function startupCandidates(ids: string[] = useStartupStore.getState().apps): string[] {
  const disabled = useAddonStore.getState()
  return ids.filter((id) => {
    if (!APP_REGISTRY.some((app) => app.id === id)) return false
    return !disabled.isDisabled(id) || NON_DISABLEABLE.has(id)
  })
}

/**
 * Open the startup set, or do nothing if this tab has already booted or has a
 * restored arrangement.
 *
 * Returns the ids it opened, which is what the tests assert on. Each open is
 * wrapped: one app that throws must not take the rest of the list — or the
 * desktop — with it.
 */
export function runStartupApps(): string[] {
  if (startupHasRun()) return []
  // Whatever happens below, this tab has now had its one chance. Marked *before*
  // opening so a throw cannot leave the marker unset and re-run on every reload.
  markStartupRan()

  if (useWindowStore.getState().windows.length > 0) return []

  const opened: string[] = []
  for (const id of startupCandidates()) {
    try {
      // Plain `openApp`, no special-case placement: `openWindow` already scatters
      // new windows by ±100px around centre and clamps each against the viewport
      // (brief 52), so a set of three lands visibly apart and none of them can
      // hang off a short screen. A hand-rolled stagger here would fight that.
      const win = openApp(id)
      if (win !== '') opened.push(id)
    } catch {
      // A registry entry whose lazy import fails, say. Skip it and keep going.
    }
  }
  return opened
}
