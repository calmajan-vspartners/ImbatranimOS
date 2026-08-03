import { describe, expect, it } from 'vitest'
import { extensionOf, unsupportedReason } from './formats'

describe('extensionOf', () => {
  it('reads the last dot-segment, lowercased', () => {
    expect(extensionOf('a/b/Report.DOCX')).toBe('docx')
    expect(extensionOf('archive.tar.gz')).toBe('gz')
  })

  it('returns empty for a name with no extension', () => {
    expect(extensionOf('Makefile')).toBe('')
    expect(extensionOf('a/b/LICENSE')).toBe('')
  })

  it('does not treat a leading dot as an extension', () => {
    // `.gitignore` is a name, not an extension — otherwise a dotfile would be
    // refused with a message about a format called "gitignore".
    expect(extensionOf('.gitignore')).toBe('')
  })
})

describe('unsupportedReason', () => {
  it('accepts .docx, in any case', () => {
    expect(unsupportedReason('notes.docx')).toBeNull()
    expect(unsupportedReason('NOTES.DOCX')).toBeNull()
  })

  it('names the format it was handed, for word-processor formats', () => {
    expect(unsupportedReason('old.doc')).toContain('Word 97-2003')
    expect(unsupportedReason('x.odt')).toContain('OpenDocument')
    expect(unsupportedReason('x.rtf')).toContain('Rich Text')
  })

  it('points at the app that does own the format', () => {
    // A refusal that does not answer "then where does this open?" is a dead end
    // with better manners.
    expect(unsupportedReason('a.txt')).toContain('Notepad')
    expect(unsupportedReason('a.md')).toContain('Markdown Editor')
    expect(unsupportedReason('a.xlsx')).toContain('Sheets')
    expect(unsupportedReason('a.pptx')).toContain('Slides')
  })

  it('always says what Docs does read', () => {
    for (const path of ['a.doc', 'a.txt', 'a.zzz', 'Makefile']) {
      expect(unsupportedReason(path)).toContain('.docx')
    }
  })

  it('handles an extensionless file without claiming a format', () => {
    expect(unsupportedReason('Makefile')).toBe(
      'This file has no extension. Docs reads .docx files.'
    )
  })
})
