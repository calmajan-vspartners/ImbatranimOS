import { describe, expect, it } from 'vitest'
import { canPan, clampPan, NO_PAN, renderedSize } from './pan'

const vp = { width: 800, height: 600 }

describe('clampPan', () => {
  it('pins to centre when the image fits the viewport', () => {
    // A fit-sized image sliding around inside a larger window is only ever an
    // accident.
    expect(clampPan({ x: 50, y: -30 }, { width: 400, height: 300 }, vp)).toEqual(NO_PAN)
  })

  it('allows panning by exactly the overhang, and no further', () => {
    // 1600 wide in an 800 viewport: 400px hangs off each side.
    const content = { width: 1600, height: 600 }
    expect(clampPan({ x: 0, y: 0 }, content, vp)).toEqual({ x: 0, y: 0 })
    expect(clampPan({ x: 400, y: 0 }, content, vp)).toEqual({ x: 400, y: 0 })
    expect(clampPan({ x: 900, y: 0 }, content, vp)).toEqual({ x: 400, y: 0 })
    expect(clampPan({ x: -900, y: 0 }, content, vp)).toEqual({ x: -400, y: 0 })
  })

  it('clamps each axis independently', () => {
    // Wide but not tall: horizontal pan is allowed, vertical is pinned.
    const content = { width: 1600, height: 300 }
    expect(clampPan({ x: 300, y: 200 }, content, vp)).toEqual({ x: 300, y: 0 })
  })

  it('returns no pan rather than NaN for degenerate sizes', () => {
    // Happens before first layout and when a window is dragged to nothing. NaN
    // reaches the CSS transform, which the browser drops — leaving the image
    // stuck at whatever offset it had.
    expect(clampPan({ x: 10, y: 10 }, { width: 0, height: 0 }, vp)).toEqual(NO_PAN)
    expect(clampPan({ x: NaN, y: 10 }, { width: 1600, height: 1200 }, vp).x).toBe(0)
    expect(
      clampPan({ x: 10, y: 10 }, { width: 1600, height: 1200 }, { width: NaN, height: 600 }).x
    ).toBe(0)
  })
})

describe('canPan', () => {
  it('is true only when the image overflows an axis', () => {
    expect(canPan({ width: 400, height: 300 }, vp)).toBe(false)
    expect(canPan({ width: 900, height: 300 }, vp)).toBe(true)
    expect(canPan({ width: 400, height: 700 }, vp)).toBe(true)
  })

  it('is false for degenerate sizes rather than showing a grab cursor', () => {
    expect(canPan({ width: NaN, height: 300 }, vp)).toBe(false)
  })
})

describe('renderedSize', () => {
  it('scales the natural size', () => {
    expect(renderedSize({ width: 400, height: 200 }, 2, 0)).toEqual({ width: 800, height: 400 })
  })

  it('swaps the axes on a quarter turn', () => {
    // A 90°-rotated portrait is WIDER than tall on screen. Getting this wrong
    // makes the pan bounds wrong in exactly the case the user rotated to fix.
    expect(renderedSize({ width: 400, height: 200 }, 1, 90)).toEqual({ width: 200, height: 400 })
    expect(renderedSize({ width: 400, height: 200 }, 1, 270)).toEqual({ width: 200, height: 400 })
    expect(renderedSize({ width: 400, height: 200 }, 1, -90)).toEqual({ width: 200, height: 400 })
  })

  it('keeps the axes at a half turn', () => {
    expect(renderedSize({ width: 400, height: 200 }, 1, 180)).toEqual({ width: 400, height: 200 })
  })

  it('is zero for a missing image or a nonsense scale', () => {
    expect(renderedSize(null, 1, 0)).toEqual({ width: 0, height: 0 })
    expect(renderedSize({ width: 400, height: 200 }, 0, 0)).toEqual({ width: 0, height: 0 })
    expect(renderedSize({ width: 400, height: 200 }, NaN, 0)).toEqual({ width: 0, height: 0 })
  })
})
