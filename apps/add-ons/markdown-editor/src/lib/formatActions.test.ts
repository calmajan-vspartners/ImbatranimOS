import { describe, expect, it } from 'vitest'
import { applyFormat, FORMAT_HINTS, keyToFormat, type FormatKind } from './formatActions'

const ALL_KINDS: FormatKind[] = [
  'bold',
  'italic',
  'strike',
  'code',
  'fence',
  'h1',
  'h2',
  'h3',
  'bullet',
  'ordered',
  'task',
  'quote',
  'link',
  'table',
]

describe('applyFormat', () => {
  it('produces markdown for every kind, and never loses the text', () => {
    for (const kind of ALL_KINDS) {
      const result = applyFormat(kind, 'word', { start: 0, end: 4 })
      expect(result.text, kind).toContain('word')
      expect(result.text, kind).not.toBe('word')
      expect(result.start, kind).toBeGreaterThanOrEqual(0)
      expect(result.end, kind).toBeLessThanOrEqual(result.text.length)
    }
  })

  it('uses asterisks for italic, not underscores', () => {
    // `snake_case_words` is emphasis in CommonMark and not in GFM; asterisks mean the
    // same thing in both, so they are the portable choice.
    expect(applyFormat('italic', 'word', { start: 0, end: 4 }).text).toBe('*word*')
  })

  it('round-trips every toggle back to the original text', () => {
    // A toolbar where the button only adds markers reaches `****word****` in four clicks.
    for (const kind of [
      'bold',
      'italic',
      'strike',
      'code',
      'bullet',
      'ordered',
      'task',
      'quote',
      'fence',
    ] as const) {
      const once = applyFormat(kind, 'word', { start: 0, end: 4 })
      const twice = applyFormat(kind, once.text, { start: once.start, end: once.end })
      expect(twice.text, kind).toBe('word')
    }
  })

  it('has a hint for every kind', () => {
    for (const kind of ALL_KINDS) expect(FORMAT_HINTS[kind], kind).toBeDefined()
  })
})

describe('keyToFormat', () => {
  const press = (key: string, code: string, shiftKey = false) =>
    keyToFormat({ key, code, shiftKey })

  it('maps the plain letter shortcuts', () => {
    expect(press('b', 'KeyB')).toBe('bold')
    expect(press('i', 'KeyI')).toBe('italic')
    expect(press('k', 'KeyK')).toBe('link')
    expect(press('e', 'KeyE')).toBe('code')
  })

  it('matches shifted digits on the physical key, not the character', () => {
    // Ctrl+Shift+8 arrives as `key: '*'` on a US layout and as other characters
    // elsewhere; the physical `code` is the only stable signal.
    expect(press('*', 'Digit8', true)).toBe('bullet')
    expect(press('&', 'Digit7', true)).toBe('ordered')
    expect(press('!', 'Digit1', true)).toBe('h1')
    expect(press('>', 'Period', true)).toBe('quote')
  })

  it('keeps shifted and unshifted bindings apart', () => {
    expect(press('e', 'KeyE', false)).toBe('code')
    expect(press('E', 'KeyE', true)).toBe('fence')
  })

  it('returns null for anything unbound, so the keystroke keeps its normal meaning', () => {
    // Ctrl+A, Ctrl+C, Ctrl+V and friends must reach the textarea untouched.
    expect(press('a', 'KeyA')).toBeNull()
    expect(press('v', 'KeyV')).toBeNull()
    expect(press('s', 'KeyS')).toBeNull()
    expect(press('f', 'KeyF', true)).toBeNull()
  })
})
