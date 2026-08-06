import { describe, expect, it } from 'vitest'
import { openAppLabel, resolveOpenApp } from './openWith'

/**
 * The routing table had no tests, which is how `.pdf` came to point at the
 * 340-line viewer while the 3886-line suite sat unreachable (brief 65). These
 * pin the decisions that are easy to flip by accident and hard to notice.
 *
 * Since brief 81 the table itself lives in core, derived from each app's own
 * `opens`; this file is a thin adapter over it. These stay because they assert
 * the *file manager's* contract — the labels its menu shows and the behaviour its
 * double-click depends on — from the outside.
 */
describe('resolveOpenApp', () => {
  it('sends .pdf to norPDF, not the light viewer (brief 65)', () => {
    // The default has to be the capable app. PDF Viewer stays in the tree as a
    // deliberate lightweight option, chosen explicitly.
    expect(resolveOpenApp('home', 'report.pdf')).toBe('norpdf')
  })

  it('routes the office formats to their editors', () => {
    expect(resolveOpenApp('home', 'a.docx')).toBe('docs')
    expect(resolveOpenApp('home', 'a.xlsx')).toBe('sheets')
    expect(resolveOpenApp('home', 'a.csv')).toBe('sheets')
    expect(resolveOpenApp('home', 'a.pptx')).toBe('slides')
  })

  it('sends code to the Code Editor from any root', () => {
    expect(resolveOpenApp('home', 'main.ts')).toBe('code-editor')
    expect(resolveOpenApp('notes', 'main.ts')).toBe('code-editor')
  })

  it('opens .txt and .log in Notepad from ANY root', () => {
    // FLIPPED by brief 59. This test previously asserted that `home/notes.txt`
    // resolved to null — double-clicking a text file in your own home directory
    // opened nothing at all, because Notepad could only read the `notes` root.
    // Notepad is root-aware now, so the `onlyRoots` gate is gone.
    expect(resolveOpenApp('notes', 'notes.txt')).toBe('notepad')
    expect(resolveOpenApp('home', 'notes.txt')).toBe('notepad')
    expect(resolveOpenApp('home', 'server.log')).toBe('notepad')
  })

  it('is case-insensitive about the extension', () => {
    expect(resolveOpenApp('home', 'REPORT.PDF')).toBe('norpdf')
    expect(resolveOpenApp('home', 'Book.XLSX')).toBe('sheets')
  })

  it('FLIPPED by brief 81: a text-ish unmapped file no longer dead-ends', () => {
    // This test used to assert `null` for both of these, and the caller then did
    // nothing at all — double-clicking a `Makefile` was a dead click, which is
    // the single most "broken OS" thing the file manager did. Text-ish files now
    // fall back to the code editor.
    expect(resolveOpenApp('home', 'Makefile')).toBe('code-editor')
    expect(resolveOpenApp('home', 'nginx.conf')).toBe('code-editor')
    expect(resolveOpenApp('home', '.env')).toBe('code-editor')
  })

  it('still returns null for an unknown BINARY, which is the honest answer', () => {
    // …and the caller now opens the "Open with" chooser rather than swallowing
    // the click. Guessing an app that cannot read the bytes is worse than asking.
    expect(resolveOpenApp('home', 'archive.dmg')).toBeNull()
    expect(resolveOpenApp('home', 'firmware.bin')).toBeNull()
  })
})

describe('openAppLabel', () => {
  it('names norPDF, so the menu matches the app that will actually open', () => {
    expect(openAppLabel('norpdf')).toBe('Open in norPDF')
  })

  it('still names PDF Viewer, which remains available', () => {
    expect(openAppLabel('pdf-viewer')).toBe('Open in PDF Viewer')
  })

  it('has a label for every app the map can resolve to', () => {
    // A resolved app with no label is a context-menu item reading "Open in
    // undefined" — cheap to prevent, invisible until a user hits it.
    // Every extension in the map, from a root where its rule applies — so a
    // root-scoped entry is exercised rather than skipped.
    const samples: [string, string][] = [
      ['home', 'a.pdf'],
      ['home', 'a.docx'],
      ['home', 'a.xlsx'],
      ['home', 'a.csv'],
      ['home', 'a.pptx'],
      ['notes', 'a.txt'],
      ['notes', 'a.log'],
      ['home', 'a.md'],
      ['home', 'a.ts'],
      ['home', 'a.png'],
      ['home', 'a.mp3'],
      ['home', 'a.mp4'],
    ]
    for (const [root, name] of samples) {
      const appId = resolveOpenApp(root, name)
      expect(appId, name).not.toBeNull()
      const label = openAppLabel(appId)
      expect(label, `${name} -> ${appId}`).toMatch(/^Open in .+/)
      expect(label).not.toMatch(/undefined/)
    }
  })
})
