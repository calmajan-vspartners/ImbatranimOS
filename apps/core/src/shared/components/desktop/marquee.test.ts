import { describe, expect, it } from 'vitest'
import { iconsInRect, isDrag, normalizeRect } from './marquee'
import { ICON_HEIGHT, ICON_WIDTH } from './layoutIcons'

/** Icons at a known grid: a at (16,16), b at (96,16), c at (16,112). */
const POSITIONS = {
  a: { x: 16, y: 16 },
  b: { x: 96, y: 16 },
  c: { x: 16, y: 112 },
}

describe('normalizeRect', () => {
  it('leaves a down-right drag alone', () => {
    expect(normalizeRect({ x1: 10, y1: 20, x2: 100, y2: 200 })).toEqual({
      left: 10,
      top: 20,
      right: 100,
      bottom: 200,
    })
  })

  it('flips an up-left drag — dragging backwards is as natural as forwards', () => {
    expect(normalizeRect({ x1: 100, y1: 200, x2: 10, y2: 20 })).toEqual({
      left: 10,
      top: 20,
      right: 100,
      bottom: 200,
    })
  })

  it('flips a single inverted axis', () => {
    expect(normalizeRect({ x1: 100, y1: 20, x2: 10, y2: 200 })).toEqual({
      left: 10,
      top: 20,
      right: 100,
      bottom: 200,
    })
  })
})

describe('isDrag', () => {
  it('a jittery click is not a drag', () => {
    expect(isDrag({ x1: 50, y1: 50, x2: 52, y2: 51 })).toBe(false)
  })

  it('past the threshold on either axis is a drag', () => {
    expect(isDrag({ x1: 50, y1: 50, x2: 54, y2: 50 })).toBe(true)
    expect(isDrag({ x1: 50, y1: 50, x2: 50, y2: 46 })).toBe(true)
  })
})

describe('iconsInRect', () => {
  it('selects only the icons the band actually covers', () => {
    const hits = iconsInRect(POSITIONS, normalizeRect({ x1: 0, y1: 0, x2: 70, y2: 70 }))
    expect(hits).toEqual(['a'])
  })

  it('a band across the top row takes both of its icons', () => {
    const hits = iconsInRect(POSITIONS, normalizeRect({ x1: 0, y1: 0, x2: 200, y2: 70 }))
    expect(hits.sort()).toEqual(['a', 'b'])
  })

  it('works for an inverted drag over the same area', () => {
    const hits = iconsInRect(POSITIONS, normalizeRect({ x1: 200, y1: 70, x2: 0, y2: 0 }))
    expect(hits.sort()).toEqual(['a', 'b'])
  })

  it('touching an edge counts as a hit — the band visibly covers it', () => {
    // Exactly the right edge of icon a's footprint.
    const edge = { x1: 16 + ICON_WIDTH, y1: 16, x2: 300, y2: 16 + ICON_HEIGHT }
    expect(iconsInRect(POSITIONS, normalizeRect(edge))).toContain('a')
  })

  it('empty desktop space selects nothing', () => {
    expect(iconsInRect(POSITIONS, normalizeRect({ x1: 400, y1: 400, x2: 600, y2: 600 }))).toEqual(
      []
    )
  })

  it('honours the id filter, so stale store entries are ignored', () => {
    const withGhost = { ...POSITIONS, ghost: { x: 16, y: 16 } }
    const rect = normalizeRect({ x1: 0, y1: 0, x2: 70, y2: 70 })
    expect(iconsInRect(withGhost, rect).sort()).toEqual(['a', 'ghost'])
    expect(iconsInRect(withGhost, rect, ['a', 'b', 'c'])).toEqual(['a'])
  })
})
