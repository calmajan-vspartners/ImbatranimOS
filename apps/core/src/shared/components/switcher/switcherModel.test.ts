import { describe, expect, it } from 'vitest'
import { commitTarget, openOrAdvance, switcherOrder } from './switcherModel'

/**
 * The Alt+Tab semantics the old blind cycle got wrong, pinned as units:
 * MRU-first ordering, quick-tap toggling the last TWO windows (not the LRU),
 * minimized windows included, reverse wrapping, cancel touching nothing.
 */

const win = (
  id: string,
  zIndex: number,
  opts: Partial<{ isVisible: boolean; ws: number }> = {}
) => ({
  id,
  appId: id,
  title: id,
  isVisible: opts.isVisible ?? true,
  workspaceId: opts.ws ?? 1,
  zIndex,
})

describe('switcherOrder', () => {
  it('sorts most-recently-used (z-descending) first', () => {
    const order = switcherOrder([win('a', 1), win('c', 3), win('b', 2)], 1)
    expect(order.map((w) => w.id)).toEqual(['c', 'b', 'a'])
  })

  it('includes minimized windows — they keep the z of their last focus', () => {
    const order = switcherOrder([win('a', 1), win('b', 2, { isVisible: false }), win('c', 3)], 1)
    expect(order.map((w) => w.id)).toEqual(['c', 'b', 'a'])
  })

  it('is scoped to the active workspace', () => {
    const order = switcherOrder([win('a', 1), win('other', 9, { ws: 2 }), win('c', 3)], 1)
    expect(order.map((w) => w.id)).toEqual(['c', 'a'])
  })
})

describe('openOrAdvance', () => {
  const ids = ['c', 'b', 'a'] // MRU order: c focused, b second-most-recent

  it('a quick tap selects the SECOND-most-recent — the pairwise toggle', () => {
    const s = openOrAdvance(null, ids, 1)
    expect(commitTarget(s)).toBe('b')
  })

  it('two taps reach the third; wrapping continues past the end', () => {
    let s = openOrAdvance(null, ids, 1)
    s = openOrAdvance(s, ids, 1)
    expect(commitTarget(s)).toBe('a')
    s = openOrAdvance(s, ids, 1)
    expect(commitTarget(s)).toBe('c')
  })

  it('retreat (shift) moves back and wraps below zero', () => {
    let s = openOrAdvance(null, ids, 1) // b
    s = openOrAdvance(s, ids, -1) // back to c (index 0)
    expect(commitTarget(s)).toBe('c')
    s = openOrAdvance(s, ids, -1) // wraps to the far end
    expect(commitTarget(s)).toBe('a')
  })

  it('opening backwards starts at the far end', () => {
    const s = openOrAdvance(null, ids, -1)
    expect(commitTarget(s)).toBe('a')
  })

  it('zero candidates: the overlay does not open', () => {
    expect(openOrAdvance(null, [], 1)).toBeNull()
  })

  it('one candidate: opens showing it; commit is that window', () => {
    const s = openOrAdvance(null, ['only'], 1)
    expect(s).not.toBeNull()
    expect(commitTarget(s)).toBe('only')
  })

  it('commitTarget of a closed switcher is null (cancel touches nothing)', () => {
    expect(commitTarget(null)).toBeNull()
  })
})
