import { describe, it, expect } from 'vitest'
import { baseName, linkTarget } from './linkTarget'
import type { SystemIntents } from '@imbatranim/ui'

/** A stand-in registry: whatever the map says, and '' for anything else. */
const assoc = (map: Record<string, string>) =>
  ({
    resolveOpener: (name: string) => {
      const ext = name.split('.').pop()?.toLowerCase() ?? ''
      return { appId: map[ext] ?? '', source: 'declared' as const }
    },
  }) as unknown as SystemIntents['associations']

describe('baseName', () => {
  it('takes the last segment', () => {
    expect(baseName('docs/img/logo.png')).toBe('logo.png')
    expect(baseName('logo.png')).toBe('logo.png')
  })
})

describe('linkTarget', () => {
  const registry = assoc({ png: 'image-viewer', csv: 'sheets', pdf: 'pdf-viewer' })

  it('keeps markdown in the markdown editor, whatever the registry says', () => {
    // Even if the user associated .md with Notepad: following a link inside a
    // document set is reading, not launching.
    const hostile = assoc({ md: 'notepad', markdown: 'notepad' })
    expect(linkTarget(hostile, 'notes/other.md')).toEqual({ kind: 'markdown' })
    expect(linkTarget(hostile, 'OTHER.MARKDOWN')).toEqual({ kind: 'markdown' })
  })

  it('routes everything else through the association registry', () => {
    expect(linkTarget(registry, 'img/logo.png')).toEqual({ kind: 'app', appId: 'image-viewer' })
    expect(linkTarget(registry, 'data/rows.csv')).toEqual({ kind: 'app', appId: 'sheets' })
    expect(linkTarget(registry, 'spec.pdf')).toEqual({ kind: 'app', appId: 'pdf-viewer' })
  })

  it('says nothing claims it rather than guessing', () => {
    expect(linkTarget(registry, 'archive.weird')).toEqual({ kind: 'none' })
  })

  it('matches on the basename, not the whole path', () => {
    // A directory called "notes.csv" in the path must not decide the answer.
    expect(linkTarget(registry, 'notes.csv/readme.pdf')).toEqual({
      kind: 'app',
      appId: 'pdf-viewer',
    })
  })
})
