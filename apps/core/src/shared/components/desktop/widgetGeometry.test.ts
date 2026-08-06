import { describe, expect, it } from 'vitest'
import { clampWidget, staggeredPosition } from './widgetGeometry'

const BOUNDS = { width: 1280, height: 700 }
const SIZE = { width: 220, height: 120 }

describe('clampWidget', () => {
  it('leaves an in-bounds widget alone', () => {
    expect(clampWidget({ x: 100, y: 100 }, SIZE, BOUNDS)).toEqual({ x: 100, y: 100 })
  })

  it('a widget dragged off the right/bottom keeps a grabbable strip', () => {
    expect(clampWidget({ x: 5000, y: 5000 }, SIZE, BOUNDS)).toEqual({ x: 1240, y: 660 })
  })

  it('a widget dragged off the left keeps its trailing edge reachable', () => {
    const p = clampWidget({ x: -5000, y: 10 }, SIZE, BOUNDS)
    expect(p.x + SIZE.width).toBeGreaterThanOrEqual(40)
    expect(p.y).toBe(10)
  })

  it('never places above the top edge', () => {
    expect(clampWidget({ x: 10, y: -50 }, SIZE, BOUNDS).y).toBe(0)
  })

  it('degrades sanely on a tiny viewport', () => {
    const p = clampWidget({ x: 500, y: 500 }, SIZE, { width: 30, height: 30 })
    expect(p.x).toBe(0)
    expect(p.y).toBe(0)
  })
})

describe('staggeredPosition', () => {
  it('successive additions never coincide', () => {
    const a = staggeredPosition(0, SIZE, BOUNDS)
    const b = staggeredPosition(1, SIZE, BOUNDS)
    expect(a).not.toEqual(b)
  })

  it('stays clamped even at high indices', () => {
    const p = staggeredPosition(50, SIZE, BOUNDS)
    expect(p.y).toBeLessThanOrEqual(700 - 40)
  })
})
