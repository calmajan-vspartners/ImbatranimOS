/**
 * Placement math for hosted desktop widgets (brief 96). Pure, because a
 * widget dragged off the edge cannot be recovered by the user — the same
 * reason sticky notes made their clamp a tested module.
 */

export type Size = { width: number; height: number }
export type Point = { x: number; y: number }
export type Bounds = { width: number; height: number }

/** Keep at least this much of a widget reachable on every axis. */
const MIN_VISIBLE = 40

/** Clamp a widget's top-left so it can always be grabbed again. */
export function clampWidget(pos: Point, size: Size, bounds: Bounds): Point {
  const maxX = Math.max(0, bounds.width - MIN_VISIBLE)
  const maxY = Math.max(0, bounds.height - MIN_VISIBLE)
  return {
    x: Math.min(Math.max(pos.x, MIN_VISIBLE - size.width), maxX),
    y: Math.min(Math.max(pos.y, 0), maxY),
  }
}

/**
 * Where a newly added widget lands: staggered down-right from a margin so
 * the Nth addition never hides the (N-1)th exactly.
 */
export function staggeredPosition(index: number, size: Size, bounds: Bounds): Point {
  const step = 28
  const base = { x: bounds.width - size.width - 24 - (index % 4) * step, y: 24 + index * step }
  return clampWidget(base, size, bounds)
}
