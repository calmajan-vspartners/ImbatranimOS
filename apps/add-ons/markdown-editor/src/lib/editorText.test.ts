import { describe, expect, it } from 'vitest'
import { caretLineOf } from './editorText'

describe('caretLineOf', () => {
  it('is 1-based and counts newlines before the caret', () => {
    const text = 'one\ntwo\nthree'
    expect(caretLineOf(text, 0)).toBe(1)
    expect(caretLineOf(text, 3)).toBe(1)
    expect(caretLineOf(text, 4)).toBe(2)
    expect(caretLineOf(text, text.length)).toBe(3)
  })

  it('clamps a caret outside the text', () => {
    expect(caretLineOf('a\nb', -5)).toBe(1)
    expect(caretLineOf('a\nb', 999)).toBe(2)
    expect(caretLineOf('a\nb', Number.NaN)).toBe(1)
  })
})
