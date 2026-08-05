import { describe, expect, it } from 'vitest'
import {
  forgetPosition,
  rememberPosition,
  RESUME_MAX_ENTRIES,
  resumeKey,
  shouldRemember,
  shouldResume,
} from './resume'

describe('shouldRemember', () => {
  it('ignores anything shorter than a minute in', () => {
    // A folder of 30-second clips would otherwise accumulate an entry each.
    expect(shouldRemember(12, 300)).toBe(false)
    expect(shouldRemember(90, 300)).toBe(true)
  })

  it('treats the last few seconds as finished', () => {
    expect(shouldRemember(295, 300)).toBe(false)
    expect(shouldRemember(280, 300)).toBe(true)
  })

  it('refuses non-finite values', () => {
    expect(shouldRemember(Number.NaN, 300)).toBe(false)
    expect(shouldRemember(90, Number.POSITIVE_INFINITY)).toBe(false)
  })
})

describe('shouldResume', () => {
  it('offers a stored mid-file position', () => {
    expect(shouldResume(120, 600)).toBe(true)
  })

  it('declines when there is nothing stored', () => {
    expect(shouldResume(undefined, 600)).toBe(false)
  })

  it('declines a position past the end — the file may have been replaced on disk', () => {
    expect(shouldResume(900, 600)).toBe(false)
  })

  it('declines before the duration is known', () => {
    expect(shouldResume(120, Number.NaN)).toBe(false)
    expect(shouldResume(120, 0)).toBe(false)
  })
})

describe('rememberPosition', () => {
  it('adds and overwrites without mutating the input', () => {
    const before = { 'home:a.mp4': 90 }
    const after = rememberPosition(before, 'home:a.mp4', 120)
    expect(after['home:a.mp4']).toBe(120)
    expect(before['home:a.mp4']).toBe(90)
  })

  it('caps the map, dropping the least recently written entry', () => {
    let map: Record<string, number> = {}
    for (let i = 0; i < 5; i++) map = rememberPosition(map, `k${i}`, 100 + i, 3)
    expect(Object.keys(map)).toEqual(['k2', 'k3', 'k4'])
  })

  it('re-writing an old key protects it from the trim', () => {
    // Insertion order is the LRU signal, so a key that was just written must move to the
    // end — otherwise the file you are watching gets evicted.
    let map: Record<string, number> = {}
    for (let i = 0; i < 3; i++) map = rememberPosition(map, `k${i}`, 100, 3)
    map = rememberPosition(map, 'k0', 200, 3)
    map = rememberPosition(map, 'k3', 100, 3)
    expect(Object.keys(map).sort()).toEqual(['k0', 'k2', 'k3'])
  })

  it('has a sane default cap', () => {
    expect(RESUME_MAX_ENTRIES).toBeGreaterThan(50)
  })
})

describe('forgetPosition', () => {
  it('removes one key and leaves the rest', () => {
    expect(forgetPosition({ a: 1, b: 2 }, 'a')).toEqual({ b: 2 })
  })

  it('is a no-op for an unknown key', () => {
    expect(forgetPosition({ b: 2 }, 'a')).toEqual({ b: 2 })
  })
})

describe('resumeKey', () => {
  it('separates the same path in different roots', () => {
    expect(resumeKey('home', 'a.mp4')).not.toBe(resumeKey('notes', 'a.mp4'))
  })
})
