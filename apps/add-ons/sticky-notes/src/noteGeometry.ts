/**
 * Where a note is allowed to be.
 *
 * Pure, and separate from the component, because this is the one piece of the
 * desktop surface that can *lose* a note: drop one past the right edge and after a
 * reload it is off-screen with no way to reach it, and no amount of dragging brings
 * it back. Every gesture therefore runs its result through `clampNote` before it is
 * previewed or persisted.
 *
 * The bounds match the backend DTO's (`MIN_SIZE` / `MAX_SIZE` in
 * `create-sticky-note.dto.ts`), so a drag can never produce a size the server would
 * reject — a 400 mid-gesture would roll the note back and read as a broken drag.
 */

/** Kept in step with the backend DTO. */
export const MIN_W = 120
export const MIN_H = 120
export const MAX_W = 1200
export const MAX_H = 1200

/**
 * How much of a note must stay on screen horizontally. One note-width minimum, so
 * there is always something to grab.
 */
const KEEP_VISIBLE_X = MIN_W

/**
 * Vertically it is the *header* that must stay reachable — the drag handle lives
 * there, so as long as the header is on the desktop the note can be pulled back.
 * `h-6` at the 13px root.
 */
const HEADER_H = 28

export type NoteBox = { x: number; y: number; w: number; h: number }

export type Bounds = { width: number; height: number }

/**
 * Clamp a proposed box to the desktop and to the DTO's size range.
 *
 * Size is clamped before position, and position is clamped against the *bounds*
 * rather than against the clamped size: a note wider than the desktop still gets
 * `x = 0` rather than a negative left, which is what keeps it grabbable.
 */
export function clampNote(box: NoteBox, bounds: Bounds): NoteBox {
  const w = Math.min(MAX_W, Math.max(MIN_W, Math.round(box.w)))
  const h = Math.min(MAX_H, Math.max(MIN_H, Math.round(box.h)))
  return {
    w,
    h,
    x: Math.round(Math.max(0, Math.min(bounds.width - KEEP_VISIBLE_X, box.x))),
    y: Math.round(Math.max(0, Math.min(bounds.height - HEADER_H, box.y))),
  }
}
