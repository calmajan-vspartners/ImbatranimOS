import { describe, expect, it } from 'vitest'
import { hasHiddenSelection, pruneSelection } from './bulkSelection'

describe('bulk selection pruning (M2)', () => {
  it('drops selected ids that are no longer visible', () => {
    // Selected 1, 2, 3 under one view; a filter switch leaves only 2 visible. A
    // bulk Delete must act on 2 alone, never on the hidden 1 and 3.
    const selected = new Set([1, 2, 3])
    const visible = new Set([2, 4, 5])
    expect([...pruneSelection(selected, visible)]).toEqual([2])
  })

  it('keeps the whole selection when everything is still visible', () => {
    const selected = new Set([1, 2])
    const visible = new Set([1, 2, 3])
    expect([...pruneSelection(selected, visible)]).toEqual([1, 2])
  })

  it('empties a selection whose rows all vanished', () => {
    expect(pruneSelection(new Set([1, 2]), new Set([9])).size).toBe(0)
  })

  it('detects a stale selection so the render-time prune only runs when needed', () => {
    expect(hasHiddenSelection(new Set([1, 2]), new Set([1, 2, 3]))).toBe(false)
    expect(hasHiddenSelection(new Set([1, 2]), new Set([1]))).toBe(true)
    expect(hasHiddenSelection(new Set(), new Set([1]))).toBe(false)
  })
})
