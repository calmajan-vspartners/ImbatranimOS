/**
 * The xterm theme, derived from the OS design tokens rather than hardcoded.
 *
 * `ui-conventions.md` §8/§46 flags `bg-[#0d0d0e]` and `#f2f2ef` in `Terminal.tsx`
 * as the OS's one remaining literal-colour violation: every other surface flips
 * with `[data-theme]` and the Terminal stayed black in light mode.
 *
 * ## Flipping the background is not enough — the ANSI palette has to move too
 *
 * This is the part that makes the "just read the tokens" version wrong. xterm's
 * default 16 ANSI colours are tuned for a dark background; drop them onto the
 * light surface (`#f3f3f1`) and bright yellow, bright cyan and bright white become
 * effectively invisible. Any `ls --color`, `git status` or npm output would have
 * unreadable words in it — a worse bug than the one being fixed, and one that only
 * shows up if you actually look at coloured output in light mode.
 *
 * So each theme carries its own ANSI palette: the dark one is a standard bright
 * set, the light one uses darkened variants that hold contrast on a near-white
 * background. The *design* tokens (surface, on-surface, accent) still come from
 * CSS so theme and accent changes are picked up live.
 */

export type XtermTheme = {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

/** Resolves a CSS custom property name (with the leading `--`) to its value. */
export type VarResolver = (name: string) => string

/**
 * ANSI 16 for a dark background — the conventional bright set, which is what the
 * terminal already effectively had via xterm's defaults.
 */
const ANSI_DARK = {
  black: '#3b3b40',
  red: '#ff6b6b',
  green: '#5fd75f',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#dcdcd6',
  brightBlack: '#5c5c63',
  brightRed: '#ff8787',
  brightGreen: '#87ff87',
  brightYellow: '#ffd787',
  brightBlue: '#87b9ff',
  brightMagenta: '#d7a3ff',
  brightCyan: '#7fd3dd',
  brightWhite: '#ffffff',
} as const

/**
 * ANSI 16 for a light background.
 *
 * Every entry is darkened until it holds up on `#f3f3f1`. The "bright" half is
 * deliberately NOT brighter than the normal half here — on a light background
 * "bright" has to mean *more saturated*, not closer to white, or bright-white text
 * disappears entirely. `brightWhite` maps to near-black for the same reason: a
 * program printing bold white expects it to be the most legible colour available.
 */
const ANSI_LIGHT = {
  black: '#1c1c1f',
  red: '#b3261e',
  green: '#1a6e2e',
  yellow: '#8a6100',
  blue: '#1f5fd6',
  magenta: '#8e24aa',
  cyan: '#00697a',
  white: '#57575d',
  brightBlack: '#3f3f45',
  brightRed: '#d13b30',
  brightGreen: '#22843a',
  brightYellow: '#a37400',
  brightBlue: '#2f6fe0',
  brightMagenta: '#a334c0',
  brightCyan: '#0b7f92',
  brightWhite: '#16161a',
} as const

/** Fallbacks matching the dark tokens, for the frame before CSS has resolved. */
const FALLBACK = { surface: '#0d0d0e', onSurface: '#f2f2ef', accent: '#c0263a' }

function firstNonEmpty(...values: string[]): string {
  for (const v of values) {
    const trimmed = v?.trim()
    if (trimmed) return trimmed
  }
  return ''
}

/**
 * Build the xterm theme for a mode, reading design tokens through `resolve`.
 *
 * Takes a resolver rather than touching `getComputedStyle` itself so the mapping
 * is testable without a DOM — the reason the ANSI-contrast decisions above can be
 * pinned by tests at all.
 */
export function buildXtermTheme(mode: 'dark' | 'light', resolve: VarResolver): XtermTheme {
  const ansi = mode === 'light' ? ANSI_LIGHT : ANSI_DARK
  const background = firstNonEmpty(resolve('--k-surface'), FALLBACK.surface)
  const foreground = firstNonEmpty(resolve('--k-on-surface'), FALLBACK.onSurface)
  const accent = firstNonEmpty(resolve('--accent'), FALLBACK.accent)
  return {
    background,
    foreground,
    cursor: accent,
    // The cursor block is filled with the accent, so the glyph under it must be
    // the surface colour to stay readable — not a fixed near-black, which would
    // vanish on the light surface.
    cursorAccent: background,
    selectionBackground: mode === 'light' ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.18)',
    ...ansi,
  }
}

/** A resolver over the real document root. */
export function documentVarResolver(): VarResolver {
  const style = getComputedStyle(document.documentElement)
  return (name) => style.getPropertyValue(name)
}
