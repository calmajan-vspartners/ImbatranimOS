import { describe, expect, it } from 'vitest'
import { describeLossy, rectsOverlap, summarize, type LossyElement } from './lossy'

const region = { x: 100, y: 100, width: 200, height: 100 }
const at = (
  x: number,
  y: number,
  width = 50,
  height = 50
): { x: number; y: number; width: number; height: number } => ({ x, y, width, height })

describe('rectsOverlap', () => {
  it('is true for a real overlap', () => {
    expect(rectsOverlap(region, at(150, 150))).toBe(true)
  })

  it('is false for touching edges', () => {
    // A canvas that ends exactly where the region begins contributes no pixels to it, so
    // warning about it would be noise.
    expect(rectsOverlap(region, at(50, 100, 50, 50))).toBe(false)
    expect(rectsOverlap(region, at(300, 100))).toBe(false)
  })

  it('is false when clear of the region', () => {
    expect(rectsOverlap(region, at(0, 0))).toBe(false)
  })
})

describe('summarize', () => {
  const elements: LossyElement[] = [
    { kind: 'canvas', rect: at(120, 120) },
    { kind: 'canvas', rect: at(200, 150) },
    { kind: 'video', rect: at(110, 110) },
    { kind: 'canvas', rect: at(0, 0) },
    // Zero-size elements are everywhere in a React app (measuring divs, hidden nodes).
    { kind: 'video', rect: at(150, 150, 0, 0) },
  ]

  it('counts only the visible elements inside the region', () => {
    expect(summarize(elements, region)).toEqual({ total: 3, byKind: { canvas: 2, video: 1 } })
  })

  it('is empty for a clean region', () => {
    expect(summarize([{ kind: 'canvas', rect: at(0, 0) }], region)).toEqual({
      total: 0,
      byKind: {},
    })
  })
})

describe('describeLossy', () => {
  it('is null when nothing was at risk — no warning fires for a clean capture', () => {
    expect(describeLossy({ total: 0, byKind: {} })).toBeNull()
  })

  it('names one kind', () => {
    expect(describeLossy({ total: 1, byKind: { canvas: 1 } })).toContain('1 canvas element')
  })

  it('pluralises properly and joins several kinds', () => {
    const text = describeLossy({ total: 3, byKind: { canvas: 2, video: 1 } })
    expect(text).toContain('2 canvas elements')
    expect(text).toContain('and 1 video')
  })

  it('names a cross-origin image readably', () => {
    expect(describeLossy({ total: 2, byKind: { crossOriginImage: 2 } })).toContain(
      '2 cross-origin images'
    )
  })

  it('says "may not" rather than claiming the content was lost', () => {
    // Whether an element survives depends on the browser and on how it draws itself — the
    // Terminal's xterm DOM renderer serialises fine today and would not with a webgl addon.
    expect(describeLossy({ total: 1, byKind: { canvas: 1 } })).toMatch(/may not appear/)
  })

  it('adds a scroll-specific caveat for a scrolled area', () => {
    const text = describeLossy({ total: 1, byKind: { scrolled: 1 } })
    expect(text).toContain('1 scrolled area')
    expect(text).toMatch(/re-rendered from its top/)
  })

  it('does not add the scroll caveat when nothing was scrolled', () => {
    expect(describeLossy({ total: 1, byKind: { canvas: 1 } })).not.toMatch(/from its top/)
  })
})
