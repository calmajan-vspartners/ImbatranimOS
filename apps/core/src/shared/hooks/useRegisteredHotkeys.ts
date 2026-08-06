import { useEffect } from 'react'
import { useGlobalHotkeys } from './useGlobalHotkeys'
import { useShortcutStore, type Shortcut } from './shortcutRegistry'

export type RegisteredHotkey = Shortcut & { handler: () => void }

/**
 * Bind global hotkeys *and* publish them to the shortcut registry in one call.
 *
 * This is the point of the registry: a binding that is not documented, and a
 * documented shortcut that is not bound, are both impossible to create through
 * this hook. Use it instead of `useGlobalHotkeys` for anything the user should
 * be able to discover.
 *
 * `useGlobalHotkeys` remains available for genuinely transient bindings (a key
 * that only exists while a particular dialog is open, for example), which do
 * not belong in a permanent shortcut list.
 */
/**
 * Publish shortcuts that are bound somewhere else.
 *
 * `useSaveHotkey` binds Ctrl/⌘+S per editor window, scoped to the top-most
 * one. Registering from there would add and remove the row as editors open and
 * close, and unmounting one editor would delete a row another still needs — so
 * the shell documents it once instead. Use this only for bindings that genuinely
 * exist but are owned elsewhere; prefer `useRegisteredHotkeys`, which cannot
 * drift.
 */
export function useDocumentedShortcuts(list: Shortcut[]): void {
  const register = useShortcutStore((s) => s.register)
  const unregister = useShortcutStore((s) => s.unregister)
  const key = list.map((s) => `${s.id}:${s.keys}`).join('|')
  useEffect(() => {
    register(list)
    const ids = list.map((s) => s.id)
    return () => unregister(ids)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, register, unregister])
}

export function useRegisteredHotkeys(list: RegisteredHotkey[]): void {
  const register = useShortcutStore((s) => s.register)
  const unregister = useShortcutStore((s) => s.unregister)

  // Build fresh bindings every render and hand them straight to useGlobalHotkeys,
  // which keeps the latest set in a ref. Memoizing on the key SET (as before)
  // froze the handlers at their first-render closures, so a handler over changing
  // state ran stale.
  const bindings = Object.fromEntries(list.map((s) => [s.keys, s.handler]))
  useGlobalHotkeys(bindings)

  const metaKey = list.map((s) => `${s.id}:${s.keys}:${s.description}:${s.scope}`).join('|')
  useEffect(() => {
    const meta = list.map(({ handler: _handler, ...rest }) => rest)
    register(meta)
    const ids = meta.map((m) => m.id)
    return () => unregister(ids)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaKey, register, unregister])
}
