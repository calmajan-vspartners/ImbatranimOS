import type { Annotation } from '../types'

/**
 * Store rect-like annotations with positive width/height so later maths is simple.
 *
 * Dragging up or left produces negative dimensions, and every consumer — the pixelate
 * sampler, the blackout fill, the export — would otherwise need its own `Math.min` dance.
 * One of them forgetting is a redaction drawn in the wrong place, which is the worst
 * available bug in this app.
 */
export function normalizeRect(a: Annotation): Annotation {
  if (a.type === 'rect' || a.type === 'pixelate' || a.type === 'blackout') {
    return {
      ...a,
      x: Math.min(a.x, a.x + a.w),
      y: Math.min(a.y, a.y + a.h),
      w: Math.abs(a.w),
      h: Math.abs(a.h),
    }
  }
  return a
}

/**
 * Block size for the pixelate tool, in device pixels.
 *
 * Deliberately coarse. Pixelation is **not** a safe redaction for text: the mosaic is a
 * deterministic function of the characters under it, and recovering short strings from a
 * fine mosaic is a solved exercise — Unredacter did it against exactly this pattern. Bigger
 * blocks destroy more information, and the tool that actually destroys it (Black out) now
 * sits next to this one in the toolbar.
 */
export function pixelateBlockSize(ratio: number): number {
  return Math.max(14, Math.round(16 * ratio))
}

/** Is a dragged shape big enough to keep, or was it a stray click? */
export function isWorthKeeping(a: Annotation): boolean {
  switch (a.type) {
    case 'rect':
    case 'pixelate':
    case 'blackout':
      return Math.abs(a.w) > 3 && Math.abs(a.h) > 3
    case 'arrow':
      return Math.hypot(a.x2 - a.x1, a.y2 - a.y1) > 4
    case 'freehand':
      return a.points.length > 1
    case 'text':
      return a.text.trim().length > 0
  }
}
