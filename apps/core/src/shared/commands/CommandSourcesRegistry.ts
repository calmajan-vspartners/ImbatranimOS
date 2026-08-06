import type { SystemHttp } from '@imbatranim/ui'
import { api } from '../../lib/axios'

/**
 * CommandSourcesRegistry
 *
 * Each source contributes a group of results to the command palette.
 * To add a new source: push an entry into COMMAND_SOURCES at module init time,
 * or import and call registerCommandSource().
 */

export type CommandItem = {
  /** Unique identifier for the item (stable across re-renders). */
  id: string
  /** Display label shown in the palette. */
  label: string
  /** Optional secondary text (e.g. file path, URL). */
  subtitle?: string
  /** Group name shown as a section header. */
  group: string
}

/**
 * Capabilities a source may use while searching (brief 48). Sources are
 * registered statically from the manifest and run with no mount, so they can
 * never call `useSystem()` — the palette hands them this context instead.
 * Grow it deliberately; it is protocol surface like everything apps touch.
 */
export type CommandSourceContext = { http: SystemHttp }

export type CommandSource = {
  /** Section header shown in the palette. */
  group: string
  /**
   * Returns matching items for the given query string.
   * May be async — returns a Promise so network sources work the same way.
   * `ctx` carries the capabilities a headless source is allowed; sources that
   * need nothing simply declare `search(query)` and ignore it.
   */
  search(query: string, ctx: CommandSourceContext): Promise<CommandItem[]>
  /** Called when the user activates an item from this source. */
  activate(item: CommandItem): void
}

const COMMAND_SOURCES: CommandSource[] = []

export function registerCommandSource(source: CommandSource): void {
  COMMAND_SOURCES.push(source)
}

/**
 * Run all sources in parallel and return combined results.
 * Sources that error are silently skipped.
 */
export async function searchAllSources(query: string): Promise<CommandItem[]> {
  // The one context every source shares: the authed client, same object the
  // handle exposes as system.http. Built here, not imported by sources.
  const ctx: CommandSourceContext = { http: api as unknown as SystemHttp }
  const results = await Promise.allSettled(COMMAND_SOURCES.map((s) => s.search(query, ctx)))

  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}

/**
 * Find the source that owns a given item (by group) and call activate.
 */
export function activateItem(item: CommandItem): void {
  const source = COMMAND_SOURCES.find((s) => s.group === item.group)
  source?.activate(item)
}

export { COMMAND_SOURCES }
