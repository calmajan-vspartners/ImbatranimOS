import { create } from 'zustand'

export type ShortcutScope = 'Global' | 'Window management' | 'Editing'

export type Shortcut = {
  /** Stable id, so re-registration (HMR, remount) replaces rather than duplicates. */
  id: string
  /** Binding string in `useGlobalHotkeys` syntax, e.g. `mod+k`. */
  keys: string
  description: string
  scope: ShortcutScope
  /** Caveat shown beside the row — e.g. a key the browser may intercept first. */
  note?: string
}

type ShortcutStore = {
  shortcuts: Record<string, Shortcut>
  register: (list: Shortcut[]) => void
  unregister: (ids: string[]) => void
}

/**
 * The one list of keyboard shortcuts in the OS.
 *
 * Before this existed, bindings were declared inline at their call sites and
 * nothing in the UI mentioned any of them — five global hotkeys that a user
 * could only discover by being told. The registry exists so the shortcut list
 * is generated from the actual bindings and cannot drift from them; see
 * `useRegisteredHotkeys`, which registers and binds in a single call so it is
 * not possible to add one without the other.
 */
export const useShortcutStore = create<ShortcutStore>()((set) => ({
  shortcuts: {},

  register: (list) =>
    set((state) => {
      const next = { ...state.shortcuts }
      for (const s of list) {
        if (
          import.meta.env.DEV &&
          next[s.id] === undefined &&
          Object.values(next).some((e) => e.keys === s.keys && e.scope === s.scope)
        ) {
          console.warn(
            `[shortcuts] "${s.keys}" is registered twice in scope "${s.scope}" ` +
              `(${s.id}). One of them will never fire.`
          )
        }
        next[s.id] = s
      }
      return { shortcuts: next }
    }),

  unregister: (ids) =>
    set((state) => {
      const next = { ...state.shortcuts }
      for (const id of ids) delete next[id]
      return { shortcuts: next }
    }),
}))

export const SCOPE_ORDER: ShortcutScope[] = ['Global', 'Window management', 'Editing']

/** Registered shortcuts, grouped by scope in a stable display order. */
export function groupShortcuts(shortcuts: Shortcut[]): [ShortcutScope, Shortcut[]][] {
  return SCOPE_ORDER.map(
    (scope) =>
      [
        scope,
        shortcuts.filter((s) => s.scope === scope).sort((a, b) => a.keys.localeCompare(b.keys)),
      ] as [ShortcutScope, Shortcut[]]
  ).filter(([, list]) => list.length > 0)
}

/**
 * True when the event target is somewhere the user is typing, so an unmodified
 * key (`?`, F1) must reach the field instead of triggering a shortcut.
 *
 * The `textarea` case covers the Terminal too: xterm reads input through a
 * hidden textarea, and it must receive every keystroke it is given.
 */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  // Explicit `=== true`: lib.dom types isContentEditable as boolean, but it is
  // absent in some environments and returns undefined there, which would make
  // this function's declared boolean return a lie.
  return target.isContentEditable === true
}

/** Human-readable binding, e.g. `mod+k` → `Ctrl + K` (or `⌘ + K` on a Mac). */
export function formatKeys(keys: string, mac: boolean): string {
  return keys
    .split('+')
    .map((part) => {
      const p = part.trim().toLowerCase()
      if (p === 'mod') return mac ? '⌘' : 'Ctrl'
      if (p === 'alt') return mac ? '⌥' : 'Alt'
      if (p === 'shift') return mac ? '⇧' : 'Shift'
      if (p === 'ctrl') return 'Ctrl'
      if (p === 'esc') return 'Esc'
      if (p.length === 1) return p.toUpperCase()
      return p.charAt(0).toUpperCase() + p.slice(1)
    })
    .join(' + ')
}
