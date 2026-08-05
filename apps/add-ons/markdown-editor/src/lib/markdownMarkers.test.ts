import { describe, expect, it } from 'vitest'
import {
  applyLink,
  insertTable,
  setHeading,
  toggleBullet,
  toggleFence,
  toggleInline,
  toggleOrdered,
  toggleQuote,
  toggleTask,
  toggleTaskAtLine,
  type EditResult,
} from './markdownMarkers'

/**
 * Render a result as text with `[` `]` around the resulting selection.
 *
 * Every one of these functions has two halves — the text and where the selection ends
 * up — and a bold button that produces the right text with the caret outside the
 * markers is still broken. Asserting on this string tests both at once.
 */
function show(result: EditResult): string {
  const { text, start, end } = result
  return text.slice(0, start) + '[' + text.slice(start, end) + ']' + text.slice(end)
}

const sel = (text: string) => {
  const start = text.indexOf('[')
  const end = text.indexOf(']') - 1
  return { text: text.replace('[', '').replace(']', ''), start, end }
}

describe('toggleInline', () => {
  it('wraps the selection', () => {
    const { text, start, end } = sel('hello [world]')
    expect(show(toggleInline(text, { start, end }, '**'))).toBe('hello **[world]**')
  })

  it('unwraps when the markers sit outside the selection', () => {
    const { text, start, end } = sel('hello **[world]**')
    expect(show(toggleInline(text, { start, end }, '**'))).toBe('hello [world]')
  })

  it('unwraps when the markers are inside the selection', () => {
    const { text, start, end } = sel('hello [**world**]')
    expect(show(toggleInline(text, { start, end }, '**'))).toBe('hello [world]')
  })

  it('puts the caret between the markers when nothing is selected', () => {
    expect(show(toggleInline('ab', { start: 1, end: 1 }, '*'))).toBe('a*[]*b')
  })

  it('keeps trailing whitespace out of the emphasis', () => {
    // Double-clicking a word selects the trailing space in some browsers; `**word **`
    // is not emphasis at all in CommonMark, so the space has to stay outside.
    const { text, start, end } = sel('[word ]next')
    expect(show(toggleInline(text, { start, end }, '**'))).toBe('**[word]** next')
  })

  it('does not mistake italic markers for bold ones', () => {
    // `slice(start - 2, start)` with `start = 1` slices from the END of the string in
    // JS. If that accidental match were treated as "already bold", bolding an italic
    // word would delete the italics instead.
    const { text, start, end } = sel('*[word]*')
    expect(show(toggleInline(text, { start, end }, '**'))).toBe('***[word]***')
  })
})

describe('setHeading', () => {
  it('adds hashes', () => {
    const { text, start, end } = sel('[Title]')
    expect(setHeading(text, { start, end }, 2).text).toBe('## Title')
  })

  it('replaces an existing level rather than stacking', () => {
    const { text, start, end } = sel('# [Title]')
    expect(setHeading(text, { start, end }, 3).text).toBe('### Title')
  })

  it('clears the heading when applied at the same level', () => {
    const { text, start, end } = sel('## [Title]')
    expect(setHeading(text, { start, end }, 2).text).toBe('Title')
  })

  it('applies to every line the selection touches', () => {
    expect(setHeading('one\ntwo', { start: 1, end: 5 }, 1).text).toBe('# one\n# two')
  })
})

describe('lists', () => {
  it('bullets and unbullets a block', () => {
    const bulleted = toggleBullet('one\ntwo', { start: 0, end: 7 })
    expect(bulleted.text).toBe('- one\n- two')
    expect(toggleBullet(bulleted.text, { start: 0, end: bulleted.text.length }).text).toBe(
      'one\ntwo'
    )
  })

  it('leaves blank lines alone', () => {
    expect(toggleBullet('one\n\ntwo', { start: 0, end: 8 }).text).toBe('- one\n\n- two')
  })

  it('renumbers from one when converting a block that is not fully ordered', () => {
    expect(toggleOrdered('4. one\ntwo', { start: 0, end: 10 }).text).toBe('1. one\n2. two')
  })

  it('toggles an already-ordered list off whatever its numbering', () => {
    expect(toggleOrdered('4. one\n9. two', { start: 0, end: 13 }).text).toBe('one\ntwo')
  })

  it('converts a bullet list to an ordered one without stacking markers', () => {
    expect(toggleOrdered('- one\n- two', { start: 0, end: 11 }).text).toBe('1. one\n2. two')
  })

  it('preserves indentation so nested items stay nested', () => {
    expect(toggleBullet('  child', { start: 0, end: 7 }).text).toBe('  - child')
  })

  it('does not strip a checkbox when the bullet button is pressed', () => {
    // A task item matches the bullet pattern too. Treating it as "already bulleted"
    // would make the bullet button silently delete the checkbox.
    expect(toggleBullet('- [ ] task', { start: 0, end: 10 }).text).toBe('- task')
  })

  it('toggles task items', () => {
    const tasks = toggleTask('one\ntwo', { start: 0, end: 7 })
    expect(tasks.text).toBe('- [ ] one\n- [ ] two')
    expect(toggleTask(tasks.text, { start: 0, end: tasks.text.length }).text).toBe('one\ntwo')
  })

  it('keeps a checked item checked when toggled off', () => {
    expect(toggleTask('- [x] done', { start: 0, end: 10 }).text).toBe('done')
  })
})

describe('toggleTaskAtLine', () => {
  const doc = '# List\n\n- [ ] one\n- [x] two\n- plain\n'

  it('ticks and unticks the addressed line', () => {
    expect(toggleTaskAtLine(doc, 3)).toContain('- [x] one')
    expect(toggleTaskAtLine(doc, 4)).toContain('- [ ] two')
  })

  it('leaves the rest of the document byte-identical', () => {
    const next = toggleTaskAtLine(doc, 3)
    expect(next.split('\n').filter((_, i) => i !== 2)).toEqual(
      doc.split('\n').filter((_, i) => i !== 2)
    )
  })

  it('does nothing when the line is not a task item', () => {
    // Better than guessing: the click may have landed on a list item whose checkbox
    // belongs to a nested child.
    expect(toggleTaskAtLine(doc, 5)).toBe(doc)
    expect(toggleTaskAtLine(doc, 1)).toBe(doc)
    expect(toggleTaskAtLine(doc, 99)).toBe(doc)
  })

  it('handles an upper-case X and keeps indentation', () => {
    expect(toggleTaskAtLine('  - [X] nested', 1)).toBe('  - [ ] nested')
  })
})

describe('toggleQuote', () => {
  it('quotes and unquotes', () => {
    const quoted = toggleQuote('one\ntwo', { start: 0, end: 7 })
    expect(quoted.text).toBe('> one\n> two')
    expect(toggleQuote(quoted.text, { start: 0, end: quoted.text.length }).text).toBe('one\ntwo')
  })

  it('unquotes a bare `>` with no space', () => {
    expect(toggleQuote('>one', { start: 0, end: 4 }).text).toBe('one')
  })
})

describe('applyLink', () => {
  it('uses the selection as the label and selects the placeholder URL', () => {
    const { text, start, end } = sel('see [the spec]')
    expect(show(applyLink(text, { start, end }))).toBe('see [the spec]([https://])')
  })

  it('recognises a selected URL and puts the caret in the empty label', () => {
    const { text, start, end } = sel('[https://example.com]')
    expect(show(applyLink(text, { start, end }))).toBe('[[]](https://example.com)')
  })

  it('inserts a placeholder label when nothing is selected', () => {
    expect(applyLink('', { start: 0, end: 0 }).text).toBe('[link](https://)')
  })
})

describe('insertTable', () => {
  it('separates the table from the paragraph above it', () => {
    // Without the blank line the pipes become part of the paragraph and render
    // literally — the classic "insert table produced garbage" bug.
    const result = insertTable('a paragraph', { start: 11, end: 11 })
    expect(result.text.startsWith('a paragraph\n\n| Column')).toBe(true)
    expect(result.text.slice(result.start, result.end)).toBe('Column')
  })

  it('does not add padding at the start of an empty document', () => {
    expect(insertTable('', { start: 0, end: 0 }).text.startsWith('| Column')).toBe(true)
  })
})

describe('toggleFence', () => {
  it('fences the selected lines and keeps them selected', () => {
    const result = toggleFence('code here', { start: 0, end: 9 })
    expect(result.text).toBe('```\ncode here\n```')
    expect(result.text.slice(result.start, result.end)).toBe('code here')
  })

  it('unfences when the fence lines sit outside the selection', () => {
    // The state this function itself leaves behind: fencing selects the code, not the
    // fences. Missing this case makes the button add-only.
    const { text, start, end } = sel('```\n[code]\n```')
    expect(toggleFence(text, { start, end }).text).toBe('code')
  })

  it('unfences an existing block', () => {
    expect(toggleFence('```js\nx\n```', { start: 0, end: 11 }).text).toBe('x')
  })

  it('puts the caret on the info string for an empty fence', () => {
    const result = toggleFence('', { start: 0, end: 0 })
    expect(result.text).toBe('```\n\n```')
    expect(result.start).toBe(3)
  })
})
