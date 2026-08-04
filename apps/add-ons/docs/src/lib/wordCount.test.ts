import { describe, expect, it } from 'vitest'
import { countText, htmlToText } from './wordCount'

describe('countText', () => {
  it('counts plain words', () => {
    expect(countText('one two three').words).toBe(3)
  })

  it('treats any run of whitespace as one separator', () => {
    expect(countText('a\n\n  b\t\tc').words).toBe(3)
  })

  it('counts a hyphenated or apostrophised word as one', () => {
    // Splitting on punctuation inflates the count on ordinary English.
    expect(countText("well-known don't state-of-the-art").words).toBe(3)
  })

  it('does not count a standalone punctuation run as a word', () => {
    expect(countText('hello — world').words).toBe(2)
    expect(countText('...').words).toBe(0)
    expect(countText('***  ---').words).toBe(0)
  })

  it('counts words in scripts without Latin letters', () => {
    expect(countText('日本語 テキスト').words).toBe(2)
    expect(countText('Привет мир').words).toBe(2)
  })

  it('counts a bare number as a word', () => {
    expect(countText('42 apples').words).toBe(2)
  })

  it('counts characters by code point, not UTF-16 unit', () => {
    // '👍' is two UTF-16 units and one character to a reader.
    expect(countText('👍').characters).toBe(1)
    expect('👍'.length).toBe(2)
  })

  it('reports characters with and without spaces', () => {
    const c = countText('ab cd')
    expect(c.characters).toBe(5)
    expect(c.charactersNoSpaces).toBe(4)
  })

  it('handles empty and whitespace-only input', () => {
    expect(countText('')).toEqual({ words: 0, characters: 0, charactersNoSpaces: 0 })
    expect(countText('   \n ').words).toBe(0)
  })
})

describe('htmlToText', () => {
  it('separates block elements so paragraphs do not merge into one word', () => {
    // Without the newline, "end" + "Begin" counts as a single word.
    const text = htmlToText('<p>paragraph end</p><p>Begin next</p>')
    expect(countText(text).words).toBe(4)
    expect(text).toMatch(/end\s+Begin/)
  })

  it('turns <br> into a break', () => {
    expect(countText(htmlToText('one<br>two')).words).toBe(2)
  })

  it('separates list items and table rows', () => {
    expect(countText(htmlToText('<ul><li>alpha</li><li>beta</li></ul>')).words).toBe(2)
    expect(
      countText(htmlToText('<table><tr><td>a</td></tr><tr><td>b</td></tr></table>')).words
    ).toBe(2)
  })

  it('drops tags without dropping their text', () => {
    expect(htmlToText('<p><strong>bold</strong> and <em>italic</em></p>').trim()).toBe(
      'bold and italic'
    )
  })

  it('decodes the entities a document actually contains', () => {
    expect(htmlToText('<p>a&nbsp;b &amp; c</p>')).toContain('a b & c')
  })
})
