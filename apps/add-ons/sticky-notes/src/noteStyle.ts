import type { NoteColor } from './types'

/**
 * How a note is painted.
 *
 * **The colour decision the brief asked to be grilled and recorded.** The OS
 * identity is Win7-classic B&W plus one accent (`ui-conventions.md` §5-8), and a
 * sticky note's metaphor wants colour — the brief calls this "the one place the
 * locked identity and the app's metaphor genuinely pull apart".
 *
 * It turns out the question was already settled one brief earlier. Brief 72 gave
 * Calendar events a six-name palette applied as a **tinted left border plus a
 * low-alpha fill**, on exactly this reasoning: enough hue to tell two things apart
 * at a glance, not enough to read as a saturated colour block. So this reuses that
 * palette and that treatment rather than inventing a second scheme — two apps
 * disagreeing about what "amber" looks like would be worse than either choice.
 *
 * What was rejected: saturated sticky yellow/pink (off-identity), and
 * surface-container steps alone (on-identity but five near-identical greys, which
 * defeats the only organisational affordance a note colour has).
 *
 * The map is duplicated from Calendar's `eventStyle.ts` **deliberately**. The
 * repo's own rule is to promote a shared helper into core on the *third* copy; this
 * is the second. When a third app needs it, this and `eventStyle.ts` move to core
 * together.
 */

/** Border + fill per colour. Literal class strings — Tailwind cannot see
 *  constructed names, so an interpolated `border-${color}` would not exist. */
const COLOR_CLASS: Record<NoteColor, string> = {
  blue: 'border-sky-500/60 bg-sky-500/15',
  green: 'border-emerald-500/60 bg-emerald-500/15',
  amber: 'border-amber-500/60 bg-amber-500/15',
  red: 'border-rose-500/60 bg-rose-500/15',
  purple: 'border-violet-500/60 bg-violet-500/15',
  slate: 'border-slate-400/60 bg-slate-400/15',
}

const DEFAULT_CLASS = 'border-outline-variant bg-surface-container'

export function noteColorClass(color: NoteColor | null): string {
  return color ? COLOR_CLASS[color] : DEFAULT_CLASS
}

/** Solid swatches for the picker, where the point IS to show the hue. */
export const COLOR_SWATCH: Record<NoteColor, string> = {
  blue: 'bg-sky-500',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-rose-500',
  purple: 'bg-violet-500',
  slate: 'bg-slate-400',
}

export const COLOR_OPTIONS: NoteColor[] = ['blue', 'green', 'amber', 'red', 'purple', 'slate']

/** The first line of a note, for a row preview or a window title. */
export function noteTitle(content: string): string {
  const firstLine = content.split('\n').find((line) => line.trim() !== '')
  return firstLine?.trim().slice(0, 60) ?? ''
}

/** What a row shows when the note has no text yet. */
export const EMPTY_LABEL = '(empty note)'

export function notePreview(content: string): string {
  return noteTitle(content) || EMPTY_LABEL
}
