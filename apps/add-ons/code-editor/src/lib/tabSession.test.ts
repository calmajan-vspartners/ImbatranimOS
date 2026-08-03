import { beforeEach, describe, expect, it, vi } from 'vitest'
import { claimTabSession, loadTabSession, resetTabSessionClaim, saveTabSession } from './tabSession'

const KEY = 'imbatranimos:code-editor:tabs'

function fakeSessionStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  } as Storage
}

beforeEach(() => {
  vi.stubGlobal('sessionStorage', fakeSessionStorage())
  resetTabSessionClaim()
})

describe('saveTabSession / loadTabSession', () => {
  it('round-trips a tab list', () => {
    saveTabSession([
      { root: 'home', path: 'src/a.ts' },
      { root: 'notes', path: 'b.md' },
    ])
    expect(loadTabSession()).toEqual([
      { root: 'home', path: 'src/a.ts' },
      { root: 'notes', path: 'b.md' },
    ])
  })

  it('returns an empty list when nothing was saved', () => {
    expect(loadTabSession()).toEqual([])
  })

  it('survives a corrupt record rather than throwing at boot', () => {
    sessionStorage.setItem(KEY, '{not json')
    expect(loadTabSession()).toEqual([])
  })

  it('drops entries that are not {root, path}', () => {
    // A record written by an older shape must not reach openPath as undefined,
    // which would fetch `/files/content?root=undefined`.
    sessionStorage.setItem(KEY, JSON.stringify([{ root: 'home' }, 42, null, { root: 1, path: 2 }]))
    expect(loadTabSession()).toEqual([])
  })

  it('ignores a non-array payload', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ root: 'home', path: 'a.ts' }))
    expect(loadTabSession()).toEqual([])
  })

  it('does not throw when storage refuses the write', () => {
    vi.stubGlobal('sessionStorage', {
      ...fakeSessionStorage(),
      setItem: () => {
        throw new DOMException('QuotaExceededError')
      },
    } as Storage)
    expect(() => saveTabSession([{ root: 'home', path: 'a.ts' }])).not.toThrow()
  })
})

describe('claimTabSession', () => {
  it('gives the record to the first caller only', () => {
    saveTabSession([{ root: 'home', path: 'a.ts' }])
    expect(claimTabSession()).toEqual([{ root: 'home', path: 'a.ts' }])
    // The editor is multiInstance: a second window must not open a duplicate
    // set of the first window's tabs.
    expect(claimTabSession()).toEqual([])
    expect(claimTabSession()).toEqual([])
  })

  it('still marks the session claimed when there was nothing to restore', () => {
    expect(claimTabSession()).toEqual([])
    saveTabSession([{ root: 'home', path: 'a.ts' }])
    // Saving after the claim is the running editor recording its own tabs —
    // it must not become something a later window picks up mid-session.
    expect(claimTabSession()).toEqual([])
  })
})
