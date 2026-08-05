import { describe, expect, it } from 'vitest'
import { minimalEdit } from './minimalEdit'

/** Applying the edit must reproduce `after` exactly — that is the whole contract. */
function apply(before: string, after: string): string {
  const edit = minimalEdit(before, after)
  return before.slice(0, edit.start) + edit.insert + before.slice(edit.end)
}

describe('minimalEdit', () => {
  const cases: [string, string][] = [
    ['word', '**word**'],
    ['**word**', 'word'],
    ['one\ntwo', '- one\n- two'],
    ['- one\n- two', 'one\ntwo'],
    ['', '| a |'],
    ['abc', ''],
    ['a', 'b'],
    ['aaaa', 'aa'],
    ['# Title', '### Title'],
    ['x\ny\nz', 'x\nz'],
  ]

  it('round-trips every case', () => {
    for (const [before, after] of cases)
      expect(apply(before, after), `${before} → ${after}`).toBe(after)
  })

  it('touches only the characters that changed', () => {
    // The span is what gets selected and replaced in the DOM; a span wider than the real
    // change would put the caret in the wrong place and scroll the textarea.
    expect(minimalEdit('hello world', 'hello **world**')).toEqual({
      start: 6,
      end: 11,
      insert: '**world**',
    })
  })

  it('reports an empty insert for a pure deletion', () => {
    expect(minimalEdit('a> b', 'a b')).toEqual({ start: 1, end: 2, insert: '' })
  })

  it('is a no-op for identical strings', () => {
    expect(minimalEdit('same', 'same')).toEqual({ start: 0, end: 0, insert: '' })
  })

  it('does not let the prefix and suffix overlap on repeated characters', () => {
    // `aaaa` → `aa` has a 2-char common prefix AND a 2-char common suffix; counting both
    // independently would produce a negative-width span.
    const edit = minimalEdit('aaaa', 'aa')
    expect(edit.end).toBeGreaterThanOrEqual(edit.start)
  })
})
