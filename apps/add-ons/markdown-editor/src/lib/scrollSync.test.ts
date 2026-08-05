import { describe, expect, it } from 'vitest'
import {
  anchorsFromLineTops,
  lineForTop,
  mapScroll,
  normalizeAnchors,
  topForLine,
} from './scrollSync'

// A document where line height is deliberately non-uniform between the two panes:
// line 1 at the top, line 10 after a tall image, line 20 after a compact table.
const preview = [
  { line: 1, top: 0 },
  { line: 10, top: 800 },
  { line: 20, top: 900 },
]

describe('topForLine', () => {
  it('interpolates between anchors', () => {
    expect(topForLine(preview, 5.5)).toBeCloseTo(400)
    expect(topForLine(preview, 15)).toBeCloseTo(850)
  })

  it('clamps rather than extrapolating past the ends', () => {
    // Extrapolating past the last anchor produces offsets beyond scrollHeight, which
    // the browser clamps — so the pane sticks at the bottom instead of tracking.
    expect(topForLine(preview, 0)).toBe(0)
    expect(topForLine(preview, 999)).toBe(900)
  })

  it('is 0 with no anchors at all', () => {
    expect(topForLine([], 12)).toBe(0)
  })
})

describe('lineForTop', () => {
  it('inverts topForLine', () => {
    expect(lineForTop(preview, 400)).toBeCloseTo(5.5)
    expect(lineForTop(preview, topForLine(preview, 14))).toBeCloseTo(14)
  })

  it('clamps at both ends', () => {
    expect(lineForTop(preview, -50)).toBe(1)
    expect(lineForTop(preview, 5000)).toBe(20)
  })
})

describe('normalizeAnchors', () => {
  it('sorts by line and drops duplicate lines', () => {
    // Several rendered blocks legitimately report the same source line — a list and
    // its first item, a table and its first row.
    expect(
      normalizeAnchors([
        { line: 3, top: 40 },
        { line: 1, top: 0 },
        { line: 3, top: 55 },
      ])
    ).toEqual([
      { line: 1, top: 0 },
      { line: 3, top: 40 },
    ])
  })

  it('drops anchors whose top runs backwards', () => {
    expect(
      normalizeAnchors([
        { line: 1, top: 100 },
        { line: 2, top: 20 },
        { line: 3, top: 150 },
      ])
    ).toEqual([
      { line: 1, top: 100 },
      { line: 3, top: 150 },
    ])
  })
})

describe('mapScroll', () => {
  const editor = anchorsFromLineTops([0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200])

  it('maps a mid-document editor position through the preview anchors', () => {
    // Editor line 6 sits at 100px; the preview puts line 6 five-ninths of the way
    // through its 800px image block.
    const top = mapScroll(
      { anchors: editor, scrollTop: 100 },
      { anchors: preview, scrollHeight: 2000, clientHeight: 400 }
    )
    expect(top).toBeCloseTo((5 / 9) * 800)
  })

  it('reaching the bottom of one pane reaches the bottom of the other', () => {
    // Without this clamp the passive pane parks with content still below the fold, and
    // the feature reads as an approximation rather than as sync.
    const top = mapScroll(
      { anchors: editor, scrollTop: 200 },
      { anchors: preview, scrollHeight: 1000, clientHeight: 400 }
    )
    expect(top).toBe(600)
  })

  it('never returns a negative offset', () => {
    expect(
      mapScroll(
        { anchors: editor, scrollTop: 0 },
        { anchors: preview, scrollHeight: 100, clientHeight: 400 }
      )
    ).toBe(0)
  })
})
