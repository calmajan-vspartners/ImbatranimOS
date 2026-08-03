import { beforeEach, describe, expect, it } from 'vitest'
import { installMapGetOrInsert } from './mapGetOrInsert'

type M<K, V> = Map<K, V> & {
  getOrInsert(k: K, v: V): V
  getOrInsertComputed(k: K, f: (k: K) => V): V
}

/**
 * Node 24.18 does **not** have these (checked: both are `undefined`), so these
 * tests exercise the polyfill itself rather than V8's implementation — which is
 * what needed testing. On an engine that does have them, `installMapGetOrInsert`
 * is a no-op and the same assertions describe the native behaviour, so the file
 * keeps its meaning either way.
 */
beforeEach(() => {
  installMapGetOrInsert()
})

describe('getOrInsert', () => {
  it('inserts and returns the value when the key is absent', () => {
    const m = new Map<string, number>() as M<string, number>
    expect(m.getOrInsert('a', 1)).toBe(1)
    expect(m.get('a')).toBe(1)
  })

  it('returns the existing value without overwriting it', () => {
    const m = new Map<string, number>([['a', 1]]) as M<string, number>
    expect(m.getOrInsert('a', 99)).toBe(1)
    expect(m.get('a')).toBe(1)
  })

  it('treats a stored undefined as present', () => {
    // `get(key) ?? insert` would overwrite it. pdf.js stores optional config
    // values, so this is not hypothetical.
    const m = new Map<string, number | undefined>([['a', undefined]]) as M<
      string,
      number | undefined
    >
    expect(m.getOrInsert('a', 5)).toBeUndefined()
    expect(m.size).toBe(1)
  })
})

describe('getOrInsertComputed', () => {
  it('computes, stores and returns on a miss', () => {
    const m = new Map<string, number[]>() as M<string, number[]>
    const arr = m.getOrInsertComputed('k', () => [])
    arr.push(1)
    // The array pdf.js pushes into must be the one in the map, not a copy.
    expect(m.get('k')).toEqual([1])
  })

  it('does not call the callback on a hit', () => {
    const m = new Map<string, number>([['a', 1]]) as M<string, number>
    let calls = 0
    expect(
      m.getOrInsertComputed('a', () => {
        calls++
        return 2
      })
    ).toBe(1)
    expect(calls).toBe(0)
  })

  it('passes the key to the callback', () => {
    const m = new Map<string, string>() as M<string, string>
    expect(m.getOrInsertComputed('x', (k) => `${k}!`)).toBe('x!')
  })

  it('rejects a non-function callback', () => {
    const m = new Map<string, number>() as M<string, number>
    expect(() =>
      (m.getOrInsertComputed as unknown as (k: string, f: unknown) => number)('a', 5)
    ).toThrow(TypeError)
  })

  it('is idempotent to install', () => {
    // Read through a cast: the repo's `lib` target predates these methods, which
    // is exactly why the polyfill exists.
    const proto = Map.prototype as unknown as Record<string, unknown>
    const before = proto.getOrInsertComputed
    installMapGetOrInsert()
    installMapGetOrInsert()
    expect(proto.getOrInsertComputed).toBe(before)
  })

  it('is not enumerable, so it does not leak into for-in over a Map', () => {
    const keys: string[] = []
    for (const k in new Map()) keys.push(k)
    expect(keys).not.toContain('getOrInsertComputed')
  })
})
