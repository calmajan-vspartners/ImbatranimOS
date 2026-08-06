import type { OpenerResolution, SystemIntents } from '@imbatranim/ui'

/** The association slice of the handle — what this adapter resolves against. */
export type Associations = SystemIntents['associations']

/**
 * File routing, now a thin adapter over core's association registry (brief 81).
 *
 * The 100-line `EXTENSION_APP_MAP` that used to live here is gone. It was the
 * single source of truth for what opens what, which meant **adding an app
 * required editing this file** — the coupling `manifest.ts` exists to avoid, and
 * the reason brief 65's PDF mismatch went unnoticed for so long. Apps now declare
 * `opens` in their own manifests and core derives the table, so this file only
 * translates the result into the labels the menu shows.
 *
 * The `onlyRoots` gate is gone too, and its absence is deliberate: it existed for
 * the pre-brief-59 Notepad, which could read only the notes root. Every app that
 * declares `opens` today is root-aware and receives `{ root }` in the payload.
 */
export type Resolution = OpenerResolution

/** Which app should open this file, and why. Never a silent nothing for text. */
export function resolveOpen(assoc: Associations, fileName: string): Resolution {
  return assoc.resolveOpener(fileName)
}

/**
 * The app id that should open `fileName`, or null when even the fallback declines.
 *
 * `root` is accepted and ignored: it was only ever used by the `onlyRoots` gate
 * above. Kept in the signature so the call sites read the same.
 */
export function resolveOpenApp(
  assoc: Associations,
  _root: string,
  fileName: string
): string | null {
  const { appId } = assoc.resolveOpener(fileName)
  return appId === '' ? null : appId
}

/** Human label for the "Open" context-menu item, from the registry's own names. */
export function openAppLabel(assoc: Associations, appId: string | null): string {
  if (!appId) return 'Open'
  const name = assoc.openerName(appId)
  return name ? `Open in ${name}` : 'Open'
}
