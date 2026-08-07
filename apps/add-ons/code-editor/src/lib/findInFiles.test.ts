import { describe, it, expect, vi } from 'vitest'
import { groupHits, runFindInFiles, type RawHit } from './findInFiles'

const file = (path: string, matches?: { line: number; text: string }[]): RawHit => ({
  name: path.split('/').pop() as string,
  path,
  type: 'file',
  ...(matches ? { matches } : {}),
})

describe('groupHits', () => {
  it('keeps one group per file with its lines under it', () => {
    const r = groupHits([
      file('a.ts', [
        { line: 2, text: 'needle()' },
        { line: 9, text: 'const needle = 1' },
      ]),
      file('sub/b.ts', [{ line: 4, text: 'needle()' }]),
    ])
    expect(r.groups.map((g) => g.path)).toEqual(['a.ts', 'sub/b.ts'])
    expect(r.groups[0].matches).toHaveLength(2)
    expect(r.matchCount).toBe(3)
  })

  it('reports the containing folder for each group', () => {
    const r = groupHits([file('a.ts', [{ line: 1, text: 'x' }]), file('src/deep/c.ts', [])])
    expect(r.groups.map((g) => g.dir)).toEqual(['', 'src/deep'])
  })

  it('drops directories — you cannot open a folder at a line', () => {
    const r = groupHits([
      { name: 'needle-dir', path: 'needle-dir', type: 'directory' },
      file('a.ts', [{ line: 1, text: 'needle' }]),
    ])
    expect(r.groups.map((g) => g.path)).toEqual(['a.ts'])
  })

  it('keeps a name-only hit, flagged, rather than silently discarding it', () => {
    // Typing a filename into find-in-files and being told "no results" for a
    // file you can see would be a lie about the search, not about the file.
    const r = groupHits([file('needle-utils.ts')])
    expect(r.groups).toHaveLength(1)
    expect(r.groups[0].nameOnly).toBe(true)
    expect(r.groups[0].matches).toEqual([])
    expect(r.matchCount).toBe(0)
  })

  it('is empty for an empty response', () => {
    expect(groupHits([])).toEqual({ groups: [], truncated: false, matchCount: 0 })
  })
})

describe('runFindInFiles', () => {
  const http = (items: RawHit[], truncated = false) => {
    const get = vi.fn().mockResolvedValue({ data: { items, truncated } })
    return { get } as unknown as Parameters<typeof runFindInFiles>[0] & { get: typeof get }
  }

  it('asks for the content grep AND the line data', async () => {
    const h = http([])
    await runFindInFiles(h, { root: 'home', query: 'needle' })
    expect(h.get).toHaveBeenCalledWith('/files/search', {
      params: { root: 'home', query: 'needle', content: 1, matches: 1 },
    })
  })

  it('sends a scope only when there is one — no scope IS the whole root', async () => {
    const h = http([])
    await runFindInFiles(h, { root: 'home', query: 'needle', scope: 'proj/sub' })
    expect(h.get.mock.calls[0][1].params.path).toBe('proj/sub')

    const h2 = http([])
    await runFindInFiles(h2, { root: 'home', query: 'needle', scope: '' })
    expect(h2.get.mock.calls[0][1].params).not.toHaveProperty('path')
  })

  it('carries `truncated` through instead of dropping it', async () => {
    const r = await runFindInFiles(http([file('a.ts', [{ line: 1, text: 'x' }])], true), {
      root: 'home',
      query: 'needle',
    })
    expect(r.truncated).toBe(true)
  })

  it('survives a response with no items array', async () => {
    const get = vi.fn().mockResolvedValue({ data: {} })
    const h = { get } as unknown as Parameters<typeof runFindInFiles>[0]
    await expect(runFindInFiles(h, { root: 'home', query: 'x' })).resolves.toEqual({
      groups: [],
      truncated: false,
      matchCount: 0,
    })
  })
})
