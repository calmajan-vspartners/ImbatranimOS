import { describe, it, expect } from 'vitest'
import { pushSample, sparklinePoints, formatRate, matchesFilter, HISTORY_LENGTH } from './history'

describe('pushSample', () => {
  it('appends without mutating the input', () => {
    const original = [1, 2, 3]
    const next = pushSample(original, 4, 10)
    expect(next).toEqual([1, 2, 3, 4])
    expect(original).toEqual([1, 2, 3])
  })

  it('drops the oldest once the limit is reached', () => {
    let h: number[] = []
    for (let i = 1; i <= 5; i++) h = pushSample(h, i, 3)
    expect(h).toEqual([3, 4, 5])
    expect(h).toHaveLength(3)
  })

  it('never exceeds the limit however many are pushed', () => {
    let h: number[] = []
    for (let i = 0; i < HISTORY_LENGTH * 3; i++) h = pushSample(h, i)
    expect(h).toHaveLength(HISTORY_LENGTH)
    // And it kept the NEWEST, not the oldest.
    expect(h[h.length - 1]).toBe(HISTORY_LENGTH * 3 - 1)
  })

  it('stores 0 for a non-finite reading', () => {
    // NaN would render as a gap in the path and then poison the scale.
    expect(pushSample([], NaN)).toEqual([0])
    expect(pushSample([], Infinity)).toEqual([0])
  })
})

describe('sparklinePoints', () => {
  it('returns empty for fewer than two samples', () => {
    // A one-point polyline draws nothing, and emitting a degenerate path makes a
    // blank sparkline look like a rendering bug instead of "not enough data yet".
    expect(sparklinePoints([], 100, 20)).toBe('')
    expect(sparklinePoints([50], 100, 20)).toBe('')
  })

  it('spans the full width and inverts the y axis', () => {
    // 0% must sit at the BOTTOM (y = height) and 100% at the top (y = 0).
    const pts = sparklinePoints([0, 100], 100, 20).split(' ')
    expect(pts[0]).toBe('0.00,20.00')
    expect(pts[1]).toBe('100.00,0.00')
  })

  it('uses a FIXED 0-100 scale rather than auto-fitting', () => {
    // The tempting mistake: auto-fitting makes idle noise look like a crisis,
    // because a series wobbling between 0.1% and 0.4% would fill the whole box.
    const quiet = sparklinePoints([0.1, 0.4], 100, 20).split(' ')
    const yValues = quiet.map((p) => Number(p.split(',')[1]))
    // Both points stay near the bottom of a 20px box.
    expect(yValues.every((y) => y > 19.9)).toBe(true)
  })

  it('clamps out-of-range values instead of drawing outside the box', () => {
    const pts = sparklinePoints([-50, 150], 100, 20).split(' ')
    expect(pts[0]).toBe('0.00,20.00')
    expect(pts[1]).toBe('100.00,0.00')
  })

  it('spaces points evenly across the width', () => {
    const pts = sparklinePoints([0, 0, 0], 100, 10).split(' ')
    expect(pts.map((p) => p.split(',')[0])).toEqual(['0.00', '50.00', '100.00'])
  })

  it('returns empty for a zero-sized box', () => {
    // Happens genuinely before first layout.
    expect(sparklinePoints([1, 2, 3], 0, 20)).toBe('')
    expect(sparklinePoints([1, 2, 3], 100, 0)).toBe('')
  })
})

describe('formatRate', () => {
  it('scales through B/s, KB/s and MB/s', () => {
    expect(formatRate(0)).toBe('0 B/s')
    expect(formatRate(512)).toBe('512 B/s')
    expect(formatRate(2048)).toBe('2.0 KB/s')
    expect(formatRate(5 * 1024 * 1024)).toBe('5.0 MB/s')
  })

  it('switches unit exactly at the boundary', () => {
    expect(formatRate(1023)).toBe('1023 B/s')
    expect(formatRate(1024)).toBe('1.0 KB/s')
    expect(formatRate(1024 * 1024 - 1)).toBe('1024.0 KB/s')
    expect(formatRate(1024 * 1024)).toBe('1.0 MB/s')
  })

  it('shows an em dash for nonsense rather than NaN', () => {
    expect(formatRate(NaN)).toBe('—')
    expect(formatRate(-1)).toBe('—')
  })
})

describe('matchesFilter', () => {
  const proc = { name: 'node', pid: 1234 }

  it('matches everything for an empty or whitespace query', () => {
    expect(matchesFilter(proc, '')).toBe(true)
    expect(matchesFilter(proc, '   ')).toBe(true)
  })

  it('matches the name case-insensitively, anywhere in it', () => {
    expect(matchesFilter(proc, 'NODE')).toBe(true)
    expect(matchesFilter(proc, 'od')).toBe(true)
    expect(matchesFilter(proc, 'python')).toBe(false)
  })

  it('matches a pid by prefix, so a half-remembered pid works', () => {
    expect(matchesFilter(proc, '12')).toBe(true)
    expect(matchesFilter(proc, '1234')).toBe(true)
    expect(matchesFilter(proc, '34')).toBe(false)
  })

  it('does not treat a non-numeric query as a pid', () => {
    expect(matchesFilter({ name: 'bash', pid: 99 }, '9x')).toBe(false)
  })
})
