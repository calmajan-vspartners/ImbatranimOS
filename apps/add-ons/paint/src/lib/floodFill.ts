/**
 * Scanline flood fill over raw RGBA pixels (brief 95). Pure — takes the
 * buffer, returns whether anything changed — so the boundary cases (fill on
 * the target colour, fill at an edge, anti-aliased borders) are testable
 * without a canvas.
 */

export type Pixels = {
  width: number
  height: number
  /** RGBA, row-major, 4 bytes per pixel — ImageData.data's exact shape. */
  data: Uint8ClampedArray
}

export type Rgba = [number, number, number, number]

export function pixelAt(p: Pixels, x: number, y: number): Rgba {
  const i = (y * p.width + x) * 4
  return [p.data[i], p.data[i + 1], p.data[i + 2], p.data[i + 3]]
}

function setPixel(p: Pixels, x: number, y: number, c: Rgba): void {
  const i = (y * p.width + x) * 4
  p.data[i] = c[0]
  p.data[i + 1] = c[1]
  p.data[i + 2] = c[2]
  p.data[i + 3] = c[3]
}

/**
 * Colour distance tolerance: a JPEG's "white" background is not uniformly
 * 255,255,255, and a zero-tolerance fill leaves speckle halos. 32 per channel
 * (squared distance) matches what desktop editors default to.
 */
const TOLERANCE_SQ = 32 * 32

function matches(p: Pixels, x: number, y: number, target: Rgba): boolean {
  const i = (y * p.width + x) * 4
  const dr = p.data[i] - target[0]
  const dg = p.data[i + 1] - target[1]
  const db = p.data[i + 2] - target[2]
  const da = p.data[i + 3] - target[3]
  return dr * dr + dg * dg + db * db + da * da <= TOLERANCE_SQ
}

/** Fill the 4-connected region under (x, y) with `fill`. True if pixels changed. */
export function floodFill(p: Pixels, x: number, y: number, fill: Rgba): boolean {
  if (x < 0 || x >= p.width || y < 0 || y >= p.height) return false
  const target = pixelAt(p, x, y)
  if (target.every((v, i) => v === fill[i])) return false

  const visited = new Uint8Array(p.width * p.height)
  const stack: number[] = [y * p.width + x]
  let changed = false

  while (stack.length > 0) {
    const idx = stack.pop()!
    if (visited[idx]) continue
    visited[idx] = 1
    const px = idx % p.width
    const py = Math.floor(idx / p.width)
    if (!matches(p, px, py, target)) continue

    setPixel(p, px, py, fill)
    changed = true
    if (px > 0) stack.push(idx - 1)
    if (px < p.width - 1) stack.push(idx + 1)
    if (py > 0) stack.push(idx - p.width)
    if (py < p.height - 1) stack.push(idx + p.width)
  }
  return changed
}
