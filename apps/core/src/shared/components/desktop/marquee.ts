import { ICON_HEIGHT, ICON_WIDTH, type Point } from './layoutIcons'

/** A drag rectangle in icon-container coordinates, in any direction. */
export type DragRect = { x1: number; y1: number; x2: number; y2: number }

export type NormalRect = { left: number; top: number; right: number; bottom: number }

/**
 * Normalize a drag that may run in any direction into left/top/right/bottom.
 * Dragging up-and-left is as natural as down-and-right, and the raw points
 * come out inverted for three of the four quadrants.
 */
export function normalizeRect(r: DragRect): NormalRect {
  return {
    left: Math.min(r.x1, r.x2),
    right: Math.max(r.x1, r.x2),
    top: Math.min(r.y1, r.y2),
    bottom: Math.max(r.y1, r.y2),
  }
}

/** Did the pointer travel far enough to be a drag rather than a click? */
export function isDrag(r: DragRect, threshold = 4): boolean {
  return Math.abs(r.x2 - r.x1) >= threshold || Math.abs(r.y2 - r.y1) >= threshold
}

/**
 * The ids whose icon footprint intersects the marquee.
 *
 * An icon occupies ICON_WIDTH × ICON_HEIGHT from its stored top-left, the same
 * footprint the drag clamp and the grid use. Touching edges counts as a hit —
 * a marquee drawn exactly along an icon's edge visibly covers it, so treating
 * that as a miss reads as a bug.
 */
export function iconsInRect(
  positions: Record<string, Point>,
  rect: NormalRect,
  ids?: readonly string[]
): string[] {
  const hits: string[] = []
  for (const [id, pos] of Object.entries(positions)) {
    if (ids && !ids.includes(id)) continue
    const overlaps =
      pos.x <= rect.right &&
      pos.x + ICON_WIDTH >= rect.left &&
      pos.y <= rect.bottom &&
      pos.y + ICON_HEIGHT >= rect.top
    if (overlaps) hits.push(id)
  }
  return hits
}
