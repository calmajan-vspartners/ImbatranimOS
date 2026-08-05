import { describe, expect, it } from 'vitest'
import { isWorthKeeping, normalizeRect, pixelateBlockSize } from './annotationGeometry'

describe('normalizeRect', () => {
  it('flips a rect dragged up and to the left', () => {
    expect(normalizeRect({ type: 'rect', x: 100, y: 80, w: -40, h: -30, color: '#000' })).toEqual({
      type: 'rect',
      x: 60,
      y: 50,
      w: 40,
      h: 30,
      color: '#000',
    })
  })

  it('normalizes both redaction shapes, not just the outline', () => {
    // A redaction drawn in the wrong place is the worst bug this app can have.
    expect(normalizeRect({ type: 'blackout', x: 50, y: 50, w: -20, h: 10 })).toEqual({
      type: 'blackout',
      x: 30,
      y: 50,
      w: 20,
      h: 10,
    })
    expect(normalizeRect({ type: 'pixelate', x: 50, y: 50, w: 20, h: -10 })).toEqual({
      type: 'pixelate',
      x: 50,
      y: 40,
      w: 20,
      h: 10,
    })
  })

  it('leaves other annotations untouched', () => {
    const arrow = { type: 'arrow', x1: 1, y1: 2, x2: 3, y2: 4, color: '#000' } as const
    expect(normalizeRect(arrow)).toEqual(arrow)
  })
})

describe('pixelateBlockSize', () => {
  it('is coarse even at ratio 1', () => {
    // Pixelation is reversible on small text; the mosaic has to destroy real information.
    expect(pixelateBlockSize(1)).toBeGreaterThanOrEqual(14)
  })

  it('scales with the device pixel ratio', () => {
    expect(pixelateBlockSize(2)).toBeGreaterThan(pixelateBlockSize(1))
  })
})

describe('isWorthKeeping', () => {
  it('drops a stray click for every draggable shape', () => {
    expect(isWorthKeeping({ type: 'rect', x: 0, y: 0, w: 1, h: 1, color: '#000' })).toBe(false)
    expect(isWorthKeeping({ type: 'blackout', x: 0, y: 0, w: 2, h: 40 })).toBe(false)
    expect(isWorthKeeping({ type: 'arrow', x1: 0, y1: 0, x2: 2, y2: 2, color: '#000' })).toBe(false)
    expect(isWorthKeeping({ type: 'freehand', points: [{ x: 0, y: 0 }], color: '#000' })).toBe(
      false
    )
  })

  it('keeps a real drag', () => {
    expect(isWorthKeeping({ type: 'blackout', x: 0, y: 0, w: 60, h: 20 })).toBe(true)
    expect(isWorthKeeping({ type: 'arrow', x1: 0, y1: 0, x2: 40, y2: 0, color: '#000' })).toBe(true)
  })

  it('drops empty text but keeps typed text', () => {
    expect(isWorthKeeping({ type: 'text', x: 0, y: 0, text: '  ', color: '#000', size: 12 })).toBe(
      false
    )
    expect(isWorthKeeping({ type: 'text', x: 0, y: 0, text: 'hi', color: '#000', size: 12 })).toBe(
      true
    )
  })
})
