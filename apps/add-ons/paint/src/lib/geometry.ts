/** Rectangle + clamp math for the canvas and the crop selection (brief 95). */

export type Rect = { x: number; y: number; width: number; height: number }

/** Editing re-encodes and the whole bitmap lives in memory; refuse beyond this. */
export const MAX_DIMENSION = 4096

/** Two drag corners → a normalised rect, clamped to the canvas. */
export function dragRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  canvasWidth: number,
  canvasHeight: number
): Rect {
  const x1 = Math.max(0, Math.min(ax, bx))
  const y1 = Math.max(0, Math.min(ay, by))
  const x2 = Math.min(canvasWidth, Math.max(ax, bx))
  const y2 = Math.min(canvasHeight, Math.max(ay, by))
  return {
    x: Math.round(x1),
    y: Math.round(y1),
    width: Math.max(0, Math.round(x2 - x1)),
    height: Math.max(0, Math.round(y2 - y1)),
  }
}

/** A crop must have area; a stray click yields a zero rect that crops nothing. */
export function isCroppable(rect: Rect | null): rect is Rect {
  return rect !== null && rect.width >= 1 && rect.height >= 1
}

/** Pointer position in *bitmap* coordinates, whatever the CSS zoom. */
export function canvasPoint(
  clientX: number,
  clientY: number,
  bounds: { left: number; top: number; width: number; height: number },
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number } {
  const x = ((clientX - bounds.left) / bounds.width) * canvasWidth
  const y = ((clientY - bounds.top) / bounds.height) * canvasHeight
  return {
    x: Math.max(0, Math.min(canvasWidth - 1, Math.floor(x))),
    y: Math.max(0, Math.min(canvasHeight - 1, Math.floor(y))),
  }
}

/** Valid canvas size, or null with no partial acceptance. */
export function parseCanvasSize(
  widthText: string,
  heightText: string
): { width: number; height: number } | null {
  const width = Number(widthText)
  const height = Number(heightText)
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null
  if (width < 1 || height < 1) return null
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) return null
  return { width, height }
}
