import { describe, it, expect } from 'vitest'
import {
  findMatches,
  matchIndexFrom,
  replaceRange,
  replaceAll,
  caretPosition,
  textStats,
} from './findReplace'
import { defaultRoot, isTooLarge, formatBytes, MAX_OPEN_BYTES } from './notepadRoot'

describe('findMatches', () => {
  it('finds every occurrence', () => {
    expect(findMatches('a b a b a', 'a', true)).toEqual([
      { start: 0, end: 1 },
      { start: 4, end: 5 },
      { start: 8, end: 9 },
    ])
  })

  it('is case-insensitive unless asked otherwise', () => {
    expect(findMatches('Foo foo FOO', 'foo', false)).toHaveLength(3)
    expect(findMatches('Foo foo FOO', 'foo', true)).toEqual([{ start: 4, end: 7 }])
  })

  it('returns nothing for an empty query', () => {
    // A naive indexOf('') loop reports a match at every position, so the find bar
    // would claim `length + 1` matches the moment it opened.
    expect(findMatches('anything', '', false)).toEqual([])
  })

  it('does not overlap matches', () => {
    // "aa" in "aaaa" is 2 matches, not 3. Advancing by 1 would also make a
    // single-character query quadratic.
    expect(findMatches('aaaa', 'aa', true)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ])
  })

  it('treats the query as literal text, not a regex', () => {
    // Typing `(` into a find box must not throw, and `.` must not match everything.
    expect(findMatches('a.b(c)', '.', true)).toEqual([{ start: 1, end: 2 }])
    expect(findMatches('a.b(c)', '(c)', true)).toEqual([{ start: 3, end: 6 }])
  })

  it('finds nothing in an empty document', () => {
    expect(findMatches('', 'x', true)).toEqual([])
  })
})

describe('matchIndexFrom', () => {
  const matches = [
    { start: 0, end: 1 },
    { start: 10, end: 11 },
    { start: 20, end: 21 },
  ]

  it('finds the next match at or after the caret', () => {
    expect(matchIndexFrom(matches, 0, 1)).toBe(0)
    expect(matchIndexFrom(matches, 1, 1)).toBe(1)
    expect(matchIndexFrom(matches, 15, 1)).toBe(2)
  })

  it('wraps forward past the last match', () => {
    // A find bar that stops at the end and does nothing more looks broken.
    expect(matchIndexFrom(matches, 25, 1)).toBe(0)
  })

  it('finds the previous match ending at or before the caret', () => {
    expect(matchIndexFrom(matches, 21, -1)).toBe(2)
    expect(matchIndexFrom(matches, 11, -1)).toBe(1)
  })

  it('wraps backward before the first match', () => {
    expect(matchIndexFrom(matches, 0, -1)).toBe(2)
  })

  it('returns -1 when there is nothing to jump to', () => {
    expect(matchIndexFrom([], 0, 1)).toBe(-1)
    expect(matchIndexFrom([], 0, -1)).toBe(-1)
  })
})

describe('replaceRange', () => {
  it('replaces the span and puts the caret after the insertion', () => {
    const out = replaceRange('hello world', { start: 6, end: 11 }, 'there')
    expect(out.text).toBe('hello there')
    // After the insertion, so a following "find next" moves forward instead of
    // matching the replacement again — which, when the replacement contains the
    // query, is an infinite loop.
    expect(out.caret).toBe(11)
  })

  it('handles a replacement longer than the match', () => {
    const out = replaceRange('ab', { start: 0, end: 1 }, 'XXX')
    expect(out.text).toBe('XXXb')
    expect(out.caret).toBe(3)
  })

  it('handles an empty replacement (a delete)', () => {
    expect(replaceRange('abc', { start: 1, end: 2 }, '')).toEqual({ text: 'ac', caret: 1 })
  })
})

describe('replaceAll', () => {
  it('replaces every occurrence and reports the count', () => {
    expect(replaceAll('a b a b a', 'a', 'X', true)).toEqual({ text: 'X b X b X', count: 3 })
  })

  it('TERMINATES when the replacement contains the query', () => {
    // The reason this scans the original and assembles a new string rather than
    // replacing in place: in-place replacement re-searches text that already holds
    // the replacement, so `a` → `aa` never finishes.
    expect(replaceAll('aaa', 'a', 'aa', true)).toEqual({ text: 'aaaaaa', count: 3 })
  })

  it('reports 0 and returns the text untouched when nothing matches', () => {
    const text = 'nothing here'
    const out = replaceAll(text, 'zzz', 'X', true)
    expect(out.count).toBe(0)
    expect(out.text).toBe(text)
  })

  it('respects case sensitivity', () => {
    expect(replaceAll('Foo foo', 'foo', 'X', true)).toEqual({ text: 'Foo X', count: 1 })
    expect(replaceAll('Foo foo', 'foo', 'X', false)).toEqual({ text: 'X X', count: 2 })
  })

  it('does nothing for an empty query', () => {
    expect(replaceAll('abc', '', 'X', true)).toEqual({ text: 'abc', count: 0 })
  })
})

describe('caretPosition', () => {
  it('is 1-based, so it matches what compilers and editors say', () => {
    expect(caretPosition('abc', 0)).toEqual({ line: 1, column: 1 })
    expect(caretPosition('abc', 3)).toEqual({ line: 1, column: 4 })
  })

  it('counts lines across newlines', () => {
    const text = 'one\ntwo\nthree'
    expect(caretPosition(text, 0)).toEqual({ line: 1, column: 1 })
    // Offset 4 is the 't' of "two" — start of line 2.
    expect(caretPosition(text, 4)).toEqual({ line: 2, column: 1 })
    expect(caretPosition(text, 8)).toEqual({ line: 3, column: 1 })
  })

  it('puts the caret at the end of a line correctly', () => {
    // Offset 3 is the newline after "one": still line 1, column 4.
    expect(caretPosition('one\ntwo', 3)).toEqual({ line: 1, column: 4 })
  })

  it('clamps an out-of-range or nonsense caret', () => {
    expect(caretPosition('abc', 99)).toEqual({ line: 1, column: 4 })
    expect(caretPosition('abc', -5)).toEqual({ line: 1, column: 1 })
    expect(caretPosition('abc', NaN)).toEqual({ line: 1, column: 1 })
  })

  it('handles an empty document', () => {
    expect(caretPosition('', 0)).toEqual({ line: 1, column: 1 })
  })

  it('handles a trailing newline', () => {
    expect(caretPosition('a\n', 2)).toEqual({ line: 2, column: 1 })
  })
})

describe('textStats', () => {
  it('counts words, characters and lines', () => {
    expect(textStats('hello world')).toEqual({ chars: 11, words: 2, lines: 1 })
    expect(textStats('a\nb\nc')).toEqual({ chars: 5, words: 3, lines: 3 })
  })

  it('reports zero words for empty or whitespace-only text', () => {
    expect(textStats('')).toEqual({ chars: 0, words: 0, lines: 1 })
    expect(textStats('   \n  ')).toMatchObject({ words: 0 })
  })

  it('counts an emoji as one character, not two', () => {
    // UTF-16 length would say 2. Same reasoning as Docs' word count.
    expect(textStats('a🙂').chars).toBe(2)
  })

  it('does not double-count runs of whitespace as words', () => {
    expect(textStats('one     two\n\n\tthree').words).toBe(3)
  })

  it('reports one line for an empty document, not zero', () => {
    // The caret is on line 1 even in an empty file, so "0 lines" would contradict
    // the position indicator beside it.
    expect(textStats('').lines).toBe(1)
  })
})

describe('defaultRoot', () => {
  it('opens into notes while legacy notes exist there', () => {
    // Silently switching to `home` would show a returning user an empty directory
    // and read as "my notes are gone".
    expect(defaultRoot(true)).toBe('notes')
  })

  it('opens into home on a fresh install', () => {
    expect(defaultRoot(false)).toBe('home')
  })

  it('returns null while the answer is unknown', () => {
    // Must not be conflated with "empty", or the first render for a returning user
    // points at home and then jumps.
    expect(defaultRoot(null)).toBeNull()
  })
})

describe('size guard', () => {
  it('refuses a file over the cap', () => {
    expect(isTooLarge(MAX_OPEN_BYTES + 1)).toBe(true)
    expect(isTooLarge(MAX_OPEN_BYTES)).toBe(false)
    expect(isTooLarge(0)).toBe(false)
  })

  it('treats an unknown size as openable rather than blocking on it', () => {
    // A missing size must not lock the user out of their own file.
    expect(isTooLarge(NaN)).toBe(false)
  })

  it('formats sizes for the refusal message', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(-1)).toBe('unknown size')
  })
})
