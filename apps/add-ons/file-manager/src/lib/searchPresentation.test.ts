import { describe, it, expect } from 'vitest'
import { parentOf, scopeLabel, resultCountLabel, truncationNote } from './searchPresentation'

describe('parentOf', () => {
  it('returns the empty string for a top-level entry', () => {
    expect(parentOf('report.md')).toBe('')
  })

  it('drops the last segment', () => {
    expect(parentOf('docs/report.md')).toBe('docs')
    expect(parentOf('a/b/c/report.md')).toBe('a/b/c')
  })

  it('leaves a directory hit pointing at its own parent, not itself', () => {
    expect(parentOf('docs/archive')).toBe('docs')
  })
})

describe('scopeLabel', () => {
  it('names the root by its label, not by an empty path', () => {
    expect(scopeLabel('Home', '')).toBe('Home')
    expect(scopeLabel('Notes', '')).toBe('Notes')
  })

  it('prefixes a sub-path with a slash so it cannot read as a filename', () => {
    expect(scopeLabel('Home', 'docs')).toBe('/docs')
    expect(scopeLabel('Home', 'docs/2026')).toBe('/docs/2026')
  })
})

describe('resultCountLabel', () => {
  it('agrees with the count', () => {
    expect(resultCountLabel(0)).toBe('0 results')
    expect(resultCountLabel(1)).toBe('1 result')
    expect(resultCountLabel(42)).toBe('42 results')
  })
})

describe('truncationNote', () => {
  it('says the search stopped rather than that nothing else matched', () => {
    const note = truncationNote(100)
    expect(note).toContain('100')
    expect(note).toMatch(/stopped early/i)
    // The distinction the palette loses: this is not "no more matches".
    expect(note).not.toMatch(/no more|nothing else/i)
  })
})
