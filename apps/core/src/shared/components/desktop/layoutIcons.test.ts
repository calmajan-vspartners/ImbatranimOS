import { describe, expect, it } from 'vitest'
import { GRID_GAP, ICON_HEIGHT, PADDING, layoutIcons } from './layoutIcons'

const STRIDE = ICON_HEIGHT + GRID_GAP
const ids = (n: number) => Array.from({ length: n }, (_, i) => `app-${i}`)

/** Every icon must sit inside the usable area and never share a cell. */
function assertSane(
  out: Record<string, { x: number; y: number }>,
  viewport: { width: number; height: number }
) {
  const seen = new Set<string>()
  for (const [id, p] of Object.entries(out)) {
    expect(p.y, `${id} must not sit above the top edge`).toBeGreaterThanOrEqual(0)
    expect(p.x, `${id} must not sit left of the edge`).toBeGreaterThanOrEqual(0)
    expect(p.y + ICON_HEIGHT, `${id} must fit above the bottom edge`).toBeLessThanOrEqual(
      viewport.height
    )
    const key = `${p.x},${p.y}`
    expect(seen.has(key), `${id} overlaps another icon at ${key}`).toBe(false)
    seen.add(key)
  }
}

describe('layoutIcons', () => {
  it('derives rows from the viewport height instead of a fixed 8', () => {
    // The old code hardcoded 8 rows, needing 8*96=768px. A short desktop has
    // nowhere near that, and the overflow was clipped away with the apps in it.
    const short = layoutIcons(ids(23), {}, { width: 1280, height: 533 })
    const tall = layoutIcons(ids(23), {}, { width: 1440, height: 856 })

    const shortCols = new Set(Object.values(short).map((p) => p.x)).size
    const tallCols = new Set(Object.values(tall).map((p) => p.x)).size

    expect(shortCols).toBeGreaterThan(tallCols)
    assertSane(short, { width: 1280, height: 533 })
    assertSane(tall, { width: 1440, height: 856 })
  })

  it('never places an icon below the usable height', () => {
    const viewport = { width: 1280, height: 533 }
    const out = layoutIcons(ids(23), {}, viewport)
    for (const p of Object.values(out)) {
      expect(p.y + ICON_HEIGHT).toBeLessThanOrEqual(viewport.height)
    }
  })

  it('places nothing on top of a pinned icon', () => {
    // Pin the cell an auto icon would otherwise take (col 0, row 1).
    const pinned = { pinnedApp: { x: PADDING, y: PADDING + STRIDE } }
    const out = layoutIcons(ids(6), pinned, { width: 1280, height: 533 })

    expect(out.pinnedApp, 'a pinned icon is not re-placed').toBeUndefined()
    for (const p of Object.values(out)) {
      expect(`${p.x},${p.y}`).not.toBe(`${PADDING},${PADDING + STRIDE}`)
    }
    assertSane({ ...out, ...pinned }, { width: 1280, height: 533 })
  })

  it('lays out only the ids it is given', () => {
    // `settings` used to consume an index while never being rendered, which
    // left a permanent hole in the grid.
    const out = layoutIcons(['a', 'b', 'c'], {}, { width: 1280, height: 533 })
    expect(Object.keys(out).sort()).toEqual(['a', 'b', 'c'])
    // Consecutive ids occupy consecutive rows — no gap.
    expect(out.b.y - out.a.y).toBe(STRIDE)
    expect(out.c.y - out.b.y).toBe(STRIDE)
  })

  it('survives a viewport too short for even one row', () => {
    const out = layoutIcons(ids(3), {}, { width: 400, height: 10 })
    expect(Object.keys(out)).toHaveLength(3)
    // One row minimum, so each icon goes into its own column rather than
    // stacking invisibly on top of the previous one.
    expect(new Set(Object.values(out).map((p) => p.x)).size).toBe(3)
  })

  it('is deterministic', () => {
    const a = layoutIcons(ids(23), {}, { width: 1280, height: 533 })
    const b = layoutIcons(ids(23), {}, { width: 1280, height: 533 })
    expect(a).toEqual(b)
  })
})
