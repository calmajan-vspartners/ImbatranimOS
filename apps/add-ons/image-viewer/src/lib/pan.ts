/**
 * Pan geometry for the zoomed image.
 *
 * The brief's first item, and rightly: zoomed past fit, the off-screen part of
 * the image was simply unreachable — no drag, no scroll — which makes zoom close
 * to decorative.
 *
 * The rule is "you cannot lose the image": the offset is clamped so at least
 * some of the picture stays inside the viewport. Where the image is *smaller*
 * than the viewport on an axis it is pinned to centre on that axis, because a
 * fit-sized image sliding around inside a larger window is only ever an
 * accident.
 */

export type Offset = { x: number; y: number }

export const NO_PAN: Offset = { x: 0, y: 0 }

/**
 * Clamp a pan offset for a rendered content box inside a viewport.
 *
 * `content` is the image's size **after** scale and rotation — the on-screen
 * bounding box, not the natural pixels. Both are in CSS pixels, and the offset
 * is a translation applied around a centred image.
 */
export function clampPan(offset: Offset, content: Size, viewport: Size): Offset {
  return {
    x: clampAxis(offset.x, content.width, viewport.width),
    y: clampAxis(offset.y, content.height, viewport.height),
  }
}

export type Size = { width: number; height: number }

function clampAxis(value: number, content: number, viewport: number): number {
  // Degenerate inputs happen for real — before first layout, and while a window
  // is dragged to nothing. NaN would propagate into a CSS transform, which the
  // browser drops silently, leaving the image stuck at its last offset.
  if (!Number.isFinite(value)) return 0
  if (!Number.isFinite(content) || !Number.isFinite(viewport)) return 0
  if (content <= viewport) return 0

  // The image is larger than the viewport on this axis, so panning is bounded by
  // how much of it hangs off each side.
  const slack = (content - viewport) / 2
  return Math.min(slack, Math.max(-slack, value))
}

/** Whether panning does anything at all at this size — drives the cursor. */
export function canPan(content: Size, viewport: Size): boolean {
  if (![content.width, content.height, viewport.width, viewport.height].every(Number.isFinite)) {
    return false
  }
  return content.width > viewport.width || content.height > viewport.height
}

/**
 * The on-screen bounding box of an image at a given scale and rotation.
 *
 * A quarter turn swaps the axes, so a 90°-rotated portrait photo is *wider* than
 * it is tall on screen. Getting this wrong makes the pan bounds wrong in exactly
 * the case the user rotated the image to fix.
 */
export function renderedSize(natural: Size | null, scale: number, rotation: number): Size {
  if (!natural || !Number.isFinite(scale) || scale <= 0) return { width: 0, height: 0 }
  const quarterTurn = Math.abs(rotation % 180) === 90
  const w = quarterTurn ? natural.height : natural.width
  const h = quarterTurn ? natural.width : natural.height
  return { width: w * scale, height: h * scale }
}
