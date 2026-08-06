import { describe, expect, it } from 'vitest'
import { floodFill, pixelAt, type Pixels, type Rgba } from './floodFill'
import { canRedo, canUndo, createUndoStack, push, redo, undo } from './undoStack'
import { MAX_DIMENSION, canvasPoint, dragRect, isCroppable, parseCanvasSize } from './geometry'

const WHITE: Rgba = [255, 255, 255, 255]
const BLACK: Rgba = [0, 0, 0, 255]
const RED: Rgba = [200, 30, 30, 255]

/** width × height pixels of one colour, with optional overrides. */
function image(width: number, height: number, base: Rgba, over: Record<string, Rgba> = {}): Pixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set(base, i * 4)
  for (const [key, color] of Object.entries(over)) {
    const [x, y] = key.split(',').map(Number)
    data.set(color, (y * width + x) * 4)
  }
  return { width, height, data }
}

describe('floodFill', () => {
  it('fills a bounded region and stops at the border', () => {
    // A 5×5 white image with a black vertical wall at x=2.
    const p = image(5, 5, WHITE, {
      '2,0': BLACK,
      '2,1': BLACK,
      '2,2': BLACK,
      '2,3': BLACK,
      '2,4': BLACK,
    })
    expect(floodFill(p, 0, 0, RED)).toBe(true)
    expect(pixelAt(p, 1, 4)).toEqual(RED)
    expect(pixelAt(p, 2, 2)).toEqual(BLACK) // the wall holds
    expect(pixelAt(p, 3, 0)).toEqual(WHITE) // the far side is untouched
  })

  it('filling with the colour already there is a no-op', () => {
    const p = image(3, 3, WHITE)
    expect(floodFill(p, 1, 1, WHITE)).toBe(false)
  })

  it('tolerates near-target pixels (the JPEG-white case)', () => {
    const offWhite: Rgba = [250, 252, 251, 255]
    const p = image(3, 1, WHITE, { '1,0': offWhite })
    floodFill(p, 0, 0, RED)
    expect(pixelAt(p, 1, 0)).toEqual(RED)
    expect(pixelAt(p, 2, 0)).toEqual(RED)
  })

  it('is 4-connected: no leaking through a diagonal gap', () => {
    // Diagonal wall of black: (1,0) and (0,1) — the corner (0,0) is sealed.
    const p = image(3, 3, WHITE, { '1,0': BLACK, '0,1': BLACK })
    floodFill(p, 0, 0, RED)
    expect(pixelAt(p, 0, 0)).toEqual(RED)
    expect(pixelAt(p, 1, 1)).toEqual(WHITE)
  })

  it('a click outside the canvas changes nothing', () => {
    const p = image(2, 2, WHITE)
    expect(floodFill(p, 5, 0, RED)).toBe(false)
  })
})

describe('undoStack', () => {
  it('undo restores, redo replays, both hand back the displaced present', () => {
    let stack = createUndoStack<string>(10)
    stack = push(stack, 'v1')
    stack = push(stack, 'v2')
    const u = undo(stack, 'v3')!
    expect(u.state).toBe('v2')
    const r = redo(u.stack, u.state)!
    expect(r.state).toBe('v3')
    expect(canRedo(r.stack)).toBe(false)
  })

  it('editing after an undo discards the redo tail', () => {
    let stack = createUndoStack<string>(10)
    stack = push(stack, 'v1')
    const u = undo(stack, 'v2')!
    const edited = push(u.stack, u.state)
    expect(canRedo(edited)).toBe(false)
  })

  it('the cap drops the oldest state, not the newest', () => {
    let stack = createUndoStack<string>(3)
    for (const v of ['a', 'b', 'c', 'd']) stack = push(stack, v)
    expect(stack.past).toEqual(['b', 'c', 'd'])
    expect(canUndo(stack)).toBe(true)
  })
})

describe('geometry', () => {
  it('dragRect normalises any corner pair and clamps to the canvas', () => {
    expect(dragRect(10, 10, 4, 2, 100, 100)).toEqual({ x: 4, y: 2, width: 6, height: 8 })
    expect(dragRect(-5, -5, 200, 50, 100, 100)).toEqual({ x: 0, y: 0, width: 100, height: 50 })
  })

  it('a zero-area selection is not croppable', () => {
    expect(isCroppable(dragRect(5, 5, 5, 9, 100, 100))).toBe(false)
    expect(isCroppable(null)).toBe(false)
    expect(isCroppable(dragRect(5, 5, 7, 9, 100, 100))).toBe(true)
  })

  it('canvasPoint maps through CSS zoom into bitmap coordinates', () => {
    const bounds = { left: 100, top: 50, width: 200, height: 100 } // 2× zoom of 100×50
    expect(canvasPoint(100, 50, bounds, 100, 50)).toEqual({ x: 0, y: 0 })
    expect(canvasPoint(299, 149, bounds, 100, 50)).toEqual({ x: 99, y: 49 })
    expect(canvasPoint(0, 0, bounds, 100, 50)).toEqual({ x: 0, y: 0 }) // clamped
  })

  it('parseCanvasSize refuses fractions, zero and the beyond-cap', () => {
    expect(parseCanvasSize('800', '600')).toEqual({ width: 800, height: 600 })
    expect(parseCanvasSize('800.5', '600')).toBeNull()
    expect(parseCanvasSize('0', '600')).toBeNull()
    expect(parseCanvasSize(String(MAX_DIMENSION + 1), '600')).toBeNull()
    expect(parseCanvasSize('abc', '600')).toBeNull()
  })
})
