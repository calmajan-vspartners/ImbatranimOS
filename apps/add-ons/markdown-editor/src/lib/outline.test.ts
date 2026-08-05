import { describe, expect, it } from 'vitest'
import { parseHeadings, plainTitle, slugify } from './outline'

describe('parseHeadings', () => {
  it('reads level, text and 1-based line', () => {
    expect(parseHeadings('# One\n\n## Two')).toEqual([
      { level: 1, title: 'One', line: 1, offset: 0, slug: 'one' },
      { level: 2, title: 'Two', line: 3, offset: 7, slug: 'two' },
    ])
  })

  it('ignores hashes inside a fenced code block', () => {
    // The failure this prevents is not exotic: any README with a shell snippet in it
    // would otherwise fill the outline with comment lines.
    const text = [
      '# Real',
      '',
      '```sh',
      '# not a heading',
      'echo hi',
      '```',
      '',
      '## Also real',
    ].join('\n')
    expect(parseHeadings(text).map((h) => h.title)).toEqual(['Real', 'Also real'])
  })

  it('handles tilde fences and a fence that is never closed', () => {
    expect(parseHeadings('~~~\n# inside\n~~~\n# after').map((h) => h.title)).toEqual(['after'])
    expect(parseHeadings('```\n# inside\n# still inside').map((h) => h.title)).toEqual([])
  })

  it('does not treat a nested fence marker as the closing one', () => {
    const text = '````\n```\n# inside\n````\n# after'
    expect(parseHeadings(text).map((h) => h.title)).toEqual(['after'])
  })

  it('needs a space after the hashes, and rejects seven', () => {
    expect(parseHeadings('#nope\n####### nope\n#hash #tag').map((h) => h.title)).toEqual([])
  })

  it('strips closed-ATX trailing hashes', () => {
    expect(parseHeadings('## Title ##')[0].title).toBe('Title')
  })

  it('reports an offset that points at the start of the heading line', () => {
    const text = 'intro\n## Deep'
    const heading = parseHeadings(text)[0]
    expect(text.slice(heading.offset)).toBe('## Deep')
  })

  it('makes repeated slugs unique, as GitHub does', () => {
    expect(parseHeadings('# API\n# API\n# API').map((h) => h.slug)).toEqual([
      'api',
      'api-1',
      'api-2',
    ])
  })
})

describe('plainTitle', () => {
  it('flattens inline markup and keeps link labels', () => {
    expect(plainTitle('The **bold** `code` [spec](https://x.test) ~~old~~')).toBe(
      'The bold code spec old'
    )
  })
})

describe('slugify', () => {
  it('lowercases, drops punctuation and hyphenates spaces', () => {
    expect(slugify('Getting Started: the Basics!')).toBe('getting-started-the-basics')
  })

  it('keeps non-ASCII letters rather than emptying the slug', () => {
    expect(slugify('Café Größe')).toBe('café-größe')
  })
})
