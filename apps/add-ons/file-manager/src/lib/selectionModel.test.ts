import { describe, it, expect } from 'vitest'
import { applySelect, modeFromEvent, nextAnchor, rangeBetween } from './selectionModel'

const ORDER = ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt']

describe('modeFromEvent', () => {
  it('reads a plain click as replace', () => {
    expect(modeFromEvent({ ctrlKey: false, metaKey: false, shiftKey: false })).toBe('replace')
  })

  it('reads ctrl or meta as toggle', () => {
    expect(modeFromEvent({ ctrlKey: true, metaKey: false, shiftKey: false })).toBe('toggle')
    expect(modeFromEvent({ ctrlKey: false, metaKey: true, shiftKey: false })).toBe('toggle')
  })

  it('lets shift win over ctrl so the two modifiers cannot fight', () => {
    expect(modeFromEvent({ ctrlKey: true, metaKey: false, shiftKey: true })).toBe('range')
  })
})

describe('rangeBetween', () => {
  it('covers both endpoints, forwards', () => {
    expect(rangeBetween(ORDER, 'b.txt', 'd.txt')).toEqual(['b.txt', 'c.txt', 'd.txt'])
  })

  it('covers both endpoints, backwards', () => {
    expect(rangeBetween(ORDER, 'd.txt', 'b.txt')).toEqual(['b.txt', 'c.txt', 'd.txt'])
  })

  it('is a single row when both ends are the same', () => {
    expect(rangeBetween(ORDER, 'c.txt', 'c.txt')).toEqual(['c.txt'])
  })

  it('degrades to the target when the anchor has vanished', () => {
    // The anchored row was deleted / renamed / filtered away since it was set.
    expect(rangeBetween(ORDER, 'gone.txt', 'c.txt')).toEqual(['c.txt'])
  })

  it('selects nothing when the target itself is not in the list', () => {
    expect(rangeBetween(ORDER, 'a.txt', 'gone.txt')).toEqual([])
  })
})

describe('applySelect', () => {
  it('replace picks exactly one row', () => {
    expect([...applySelect(new Set(['a.txt', 'b.txt']), 'replace', 'd.txt', ORDER, null)]).toEqual([
      'd.txt',
    ])
  })

  it('replace on the sole selected row clears it — the pre-existing quirk', () => {
    expect(applySelect(new Set(['d.txt']), 'replace', 'd.txt', ORDER, null).size).toBe(0)
  })

  it('replace on one of several selected rows still narrows to that row', () => {
    expect([...applySelect(new Set(['a.txt', 'd.txt']), 'replace', 'd.txt', ORDER, null)]).toEqual([
      'd.txt',
    ])
  })

  it('toggle adds and removes without touching the rest', () => {
    const added = applySelect(new Set(['a.txt']), 'toggle', 'c.txt', ORDER, null)
    expect([...added].sort()).toEqual(['a.txt', 'c.txt'])
    expect([...applySelect(added, 'toggle', 'a.txt', ORDER, null)]).toEqual(['c.txt'])
  })

  it('range replaces the selection with the span from the anchor', () => {
    expect([...applySelect(new Set(['z']), 'range', 'd.txt', ORDER, 'b.txt')]).toEqual([
      'b.txt',
      'c.txt',
      'd.txt',
    ])
  })

  it('range with no anchor yet selects just the clicked row', () => {
    expect([...applySelect(new Set(), 'range', 'd.txt', ORDER, null)]).toEqual(['d.txt'])
  })
})

describe('nextAnchor', () => {
  it('moves on replace and toggle', () => {
    expect(nextAnchor('replace', 'c.txt', 'a.txt')).toBe('c.txt')
    expect(nextAnchor('toggle', 'c.txt', 'a.txt')).toBe('c.txt')
  })

  it('stays put on a range, so shrinking a range works', () => {
    expect(nextAnchor('range', 'e.txt', 'b.txt')).toBe('b.txt')
  })

  it('adopts the target when a range starts with no anchor', () => {
    expect(nextAnchor('range', 'e.txt', null)).toBe('e.txt')
  })
})

describe('grow then shrink a range', () => {
  it('walks back to the anchor instead of dragging a window', () => {
    const anchor = 'b.txt'
    const grown = applySelect(new Set(), 'range', 'e.txt', ORDER, anchor)
    expect(grown.size).toBe(4)
    const shrunk = applySelect(grown, 'range', 'c.txt', ORDER, nextAnchor('range', 'e.txt', anchor))
    expect([...shrunk]).toEqual(['b.txt', 'c.txt'])
  })
})
