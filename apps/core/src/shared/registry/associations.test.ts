// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ASSOCIATIONS_KEY,
  TEXT_FALLBACK_APP,
  associationKey,
  candidatesFor,
  extensionOf,
  isTextish,
  knownExtensions,
  resolveOpener,
  useAssociationStore,
} from './associations'
import { useAddonStore } from '../store/addonStore'
import { DOTFILE_KEYS } from '../../lib/prefs'

/**
 * Brief 81 — default apps.
 *
 * The headline is the last group: **a double-click must always do something.**
 * Everything before it is resolution order, which matters mostly because getting
 * it wrong silently reverses a decision another brief already made.
 */

beforeEach(() => {
  localStorage.clear()
  useAssociationStore.setState({ overrides: {} })
  useAddonStore.setState({ disabled: [] })
})

describe('extension parsing', () => {
  it('reads the extension, lowercased', () => {
    expect(extensionOf('notes.MD')).toBe('md')
    expect(extensionOf('archive.tar.gz')).toBe('gz')
  })

  it('treats a leading-dot name as having NO extension', () => {
    // `.env`.split('.') gives ['', 'env'], so a naive parse would call this an
    // "env file" and then fail to match the `.env` entry in the text-ish names.
    expect(extensionOf('.env')).toBe('')
    expect(extensionOf('.gitignore')).toBe('')
  })

  it('returns nothing for a bare name', () => {
    expect(extensionOf('Dockerfile')).toBe('')
    expect(extensionOf('Makefile')).toBe('')
  })

  it('keys an override by extension, or by whole name when there is none', () => {
    expect(associationKey('a.CSV')).toBe('csv')
    expect(associationKey('Dockerfile')).toBe('dockerfile')
    expect(associationKey('.env')).toBe('.env')
  })
})

describe('the before/after table — every mapping the old constant had', () => {
  const cases: [string, string][] = [
    ['notes.md', 'markdown-editor'],
    ['notes.markdown', 'markdown-editor'],
    ['a.txt', 'notepad'],
    ['out.log', 'notepad'],
    ['a.json', 'code-editor'],
    ['a.ts', 'code-editor'],
    ['a.tsx', 'code-editor'],
    ['a.js', 'code-editor'],
    ['a.css', 'code-editor'],
    ['a.html', 'code-editor'],
    ['a.sh', 'code-editor'],
    ['a.py', 'code-editor'],
    ['a.go', 'code-editor'],
    ['a.rs', 'code-editor'],
    ['a.yaml', 'code-editor'],
    ['a.yml', 'code-editor'],
    ['a.toml', 'code-editor'],
    ['a.xml', 'code-editor'],
    ['a.sql', 'code-editor'],
    ['deck.pptx', 'slides'],
    ['deck.ppt', 'slides'],
    ['book.xlsx', 'sheets'],
    ['book.xls', 'sheets'],
    ['data.csv', 'sheets'],
    ['letter.docx', 'docs'],
    ['pic.png', 'image-viewer'],
    ['pic.jpg', 'image-viewer'],
    ['pic.svg', 'image-viewer'],
    ['pic.avif', 'image-viewer'],
    ['song.mp3', 'media-player'],
    ['song.flac', 'media-player'],
    ['clip.mp4', 'media-player'],
    ['clip.mkv', 'media-player'],
  ]

  it.each(cases)('%s still opens in %s', (file, appId) => {
    expect(resolveOpener(file).appId).toBe(appId)
  })

  it('.pdf still goes to norPDF, NOT the light viewer', () => {
    // Both claim `.pdf` and pdf-viewer is registered FIRST, so "first candidate
    // wins" would have quietly undone brief 65's decision.
    expect(resolveOpener('doc.pdf').appId).toBe('norpdf')
    expect(candidatesFor('doc.pdf').map((c) => c.appId)).toContain('pdf-viewer')
  })
})

describe('the user override wins', () => {
  it('over the declared default', () => {
    expect(resolveOpener('a.md').appId).toBe('markdown-editor')
    useAssociationStore.getState().setDefault('md', 'code-editor')
    expect(resolveOpener('a.md')).toEqual({ appId: 'code-editor', reason: 'override' })
  })

  it('and can be cleared back to the default', () => {
    useAssociationStore.getState().setDefault('md', 'code-editor')
    useAssociationStore.getState().clearDefault('md')
    expect(resolveOpener('a.md').appId).toBe('markdown-editor')
  })

  it('is ignored when it names an app that does not exist', () => {
    useAssociationStore.getState().setDefault('md', 'an-app-that-was-removed')
    expect(resolveOpener('a.md').appId).toBe('markdown-editor')
  })

  it('is ignored when the chosen app has been DISABLED', () => {
    useAssociationStore.getState().setDefault('md', 'code-editor')
    useAddonStore.setState({ disabled: ['code-editor'] })
    expect(resolveOpener('a.md').appId).toBe('markdown-editor')
  })

  it('applies to an extensionless name too', () => {
    useAssociationStore.getState().setDefault('dockerfile', 'notepad')
    expect(resolveOpener('Dockerfile').appId).toBe('notepad')
  })
})

describe('a disabled app is not a candidate', () => {
  it('drops out of the candidate list', () => {
    expect(candidatesFor('a.md').map((c) => c.appId)).toContain('markdown-editor')
    useAddonStore.setState({ disabled: ['markdown-editor'] })
    expect(candidatesFor('a.md').map((c) => c.appId)).not.toContain('markdown-editor')
  })

  it('FALLS BACK rather than dead-ending when it owned the extension', () => {
    useAddonStore.setState({ disabled: ['markdown-editor'] })
    // `.md` is text, so the fallback catches it — not a dead double-click.
    expect(resolveOpener('a.md')).toEqual({
      appId: TEXT_FALLBACK_APP,
      reason: 'text-fallback',
    })
  })

  it('hands a contested extension to the other claimant', () => {
    useAddonStore.setState({ disabled: ['norpdf'] })
    expect(resolveOpener('doc.pdf').appId).toBe('pdf-viewer')
  })
})

describe('THE DEAD DOUBLE-CLICK IS GONE', () => {
  const textish = [
    '.env',
    '.gitignore',
    '.bashrc',
    'Dockerfile',
    'Makefile',
    'LICENSE',
    'README',
    'settings.ini',
    'nginx.conf',
    'app.cfg',
    'package-lock.lock',
    'main.lua',
    'App.swift',
    'style.scss',
    'schema.graphql',
    'deploy.tf',
    'notes',
  ]

  it.each(textish)('%s opens in the text editor instead of nothing', (name) => {
    const resolved = resolveOpener(name)
    expect(resolved.appId).toBe(TEXT_FALLBACK_APP)
    expect(resolved.reason).toBe('text-fallback')
  })

  it.each(textish)('%s is recognised as text', (name) => {
    expect(isTextish(name)).toBe(true)
  })

  it('an unknown BINARY resolves to nothing, so the caller offers a chooser', () => {
    // The one honest "we don't know" — and the caller must still show a dialog
    // rather than swallow the click.
    const resolved = resolveOpener('firmware.bin')
    expect(resolved.reason).toBe('none')
    expect(resolved.appId).toBe('')
    expect(isTextish('firmware.bin')).toBe(false)
  })

  it('falls back to nothing rather than crashing when even the editor is disabled', () => {
    useAddonStore.setState({ disabled: ['code-editor'] })
    expect(resolveOpener('nginx.conf').reason).toBe('none')
  })
})

describe('the choice is a dotfile, not a browser-local setting', () => {
  it('the persist key is registered in DOTFILE_KEYS', () => {
    // Wiring the store to `prefsStorage` is NOT enough: `writePref` drops any key
    // that is not in this list, so the override persisted to localStorage and
    // never reached the server. Green unit tests and a working single browser
    // hid it — the only symptom was signing in somewhere else.
    expect(DOTFILE_KEYS as readonly string[]).toContain(ASSOCIATIONS_KEY)
  })
})

describe('the Settings row list', () => {
  it('is computed from the registry, so a new app appears with no second edit', () => {
    const known = knownExtensions()
    expect(known).toContain('md')
    expect(known).toContain('csv')
    expect(known).toContain('pdf')
    expect(known).toContain('mkv')
    // Sorted and unique.
    expect([...new Set(known)]).toEqual(known)
    expect([...known].sort()).toEqual(known)
  })
})
