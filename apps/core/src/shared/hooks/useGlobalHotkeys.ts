import { useEffect, useCallback } from 'react'

/**
 * Maps a key string like "mod+k", "esc", "alt+tab", "mod+`", "mod+w", "mod+m"
 * to a normalized descriptor for comparison.
 *
 * "mod" → Ctrl on non-Mac, Cmd (Meta) on Mac.
 */

type HotkeyBinding = Record<string, () => void>

function isMac(): boolean {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
}

interface ParsedKey {
  mod: boolean
  alt: boolean
  shift: boolean
  ctrl: boolean
  key: string
}

export function parseBinding(binding: string): ParsedKey {
  const parts = binding.toLowerCase().split('+')
  const key = parts[parts.length - 1]
  const mod = parts.includes('mod')
  const alt = parts.includes('alt')
  const shift = parts.includes('shift')
  const ctrl = parts.includes('ctrl')
  return { mod, alt, shift, ctrl, key }
}

/** Exported for the spec — the matcher is where the modifier subtleties live. */
export function eventMatchesBinding(e: KeyboardEvent, parsed: ParsedKey): boolean {
  const mac = isMac()

  // mod = Cmd on mac, Ctrl elsewhere
  const modPressed = mac ? e.metaKey : e.ctrlKey
  if (parsed.mod && !modPressed) return false
  // `!parsed.ctrl` is load-bearing, and its absence was a real bug: off a mac,
  // `mod` IS ctrl, so an explicit `ctrl+…` binding was rejected here by the
  // very key it asked for. Every `ctrl+` binding was therefore dead on Linux
  // and Windows — invisible until brief 85 wanted `ctrl+alt+left`, because
  // until then every binding in the OS used `mod`.
  if (!parsed.mod && !parsed.ctrl && modPressed) return false

  // explicit ctrl (not mod alias)
  if (parsed.ctrl && !e.ctrlKey) return false
  if (!parsed.ctrl && !parsed.mod && e.ctrlKey) return false

  if (parsed.alt !== e.altKey) return false
  if (parsed.shift !== e.shiftKey) return false

  const evKey = e.key.toLowerCase()

  // normalize special keys
  const keyMap: Record<string, string> = {
    escape: 'esc',
    ' ': 'space',
    arrowup: 'up',
    arrowdown: 'down',
    arrowleft: 'left',
    arrowright: 'right',
    tab: 'tab',
    enter: 'enter',
    backspace: 'backspace',
    delete: 'delete',
  }

  const normalized = keyMap[evKey] ?? evKey
  return normalized === parsed.key
}

/**
 * useGlobalHotkeys — registers global keydown listeners for the given bindings.
 *
 * @param bindings Record<string, () => void>
 *   Keys use the syntax: "mod+k" | "esc" | "alt+tab" | "mod+`" | "mod+w" | "mod+m" | etc.
 *   "mod" means Cmd on Mac, Ctrl elsewhere.
 *
 * Example:
 *   useGlobalHotkeys({ 'mod+k': () => openPalette(), 'esc': () => closePalette() })
 */
export function useGlobalHotkeys(bindings: HotkeyBinding): void {
  const stableBindings = bindings
  // Re-bind only when the SET of hotkeys changes; handler identity churn per
  // render is deliberately ignored (callers pass inline closures).
  const bindingsKey = JSON.stringify(Object.keys(stableBindings))

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      for (const [bindingStr, handler] of Object.entries(stableBindings)) {
        const parsed = parseBinding(bindingStr)
        if (eventMatchesBinding(e, parsed)) {
          e.preventDefault()
          handler()
          return
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bindingsKey]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown])
}
