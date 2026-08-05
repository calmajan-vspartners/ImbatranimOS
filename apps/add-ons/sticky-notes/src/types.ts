/**
 * The shapes the backend `sticky-notes` module speaks.
 *
 * camelCase throughout, with `x`/`y` rather than `pos_x`/`pos_y`. This is the
 * module `ui-conventions.md` §45 and brief 71 both singled out for leaking
 * `snake_case` into React props; brief 74 rewrites both sides.
 */

/** Shared with Calendar's event colours — see `noteStyle.ts` for why. */
export type NoteColor = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'slate'

export type StickyNote = {
  id: number
  content: string
  /** Position on the desktop layer, px from its top-left. */
  x: number
  y: number
  width: number
  height: number
  /** null uses the default surface treatment. */
  color: NoteColor | null
  /** False means the note exists only in the manager window. */
  onDesktop: boolean
  createdAt: string
  updatedAt: string
}

export type StickyNoteInput = {
  content?: string
  x?: number
  y?: number
  width?: number
  height?: number
  color?: NoteColor | null
  onDesktop?: boolean
}

/** Same fields; separate name so a create and a patch cannot be confused. */
export type StickyNotePatch = StickyNoteInput
