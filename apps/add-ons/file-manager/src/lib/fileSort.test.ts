import { describe, it, expect } from 'vitest'
import type { FsEntry } from '../types'
import {
  sortEntries,
  filterHidden,
  isHidden,
  nextSort,
  ariaSort,
  gridColumns,
  gridRowCount,
} from './fileSort'

function file(name: string, size: number, modifiedAt: string): FsEntry {
  return { name, path: `dir/${name}`, type: 'file', size, modifiedAt }
}
function dir(name: string, modifiedAt = '2026-01-01T00:00:00.000Z'): FsEntry {
  return { name, path: `dir/${name}`, type: 'directory', size: 4096, modifiedAt }
}

const names = (entries: FsEntry[]) => entries.map((e) => e.name)

describe('sortEntries', () => {
  const listing: FsEntry[] = [
    file('zebra.txt', 10, '2026-03-01T00:00:00.000Z'),
    dir('beta'),
    file('apple.txt', 500, '2026-01-15T00:00:00.000Z'),
    dir('alpha'),
    file('mango.txt', 100, '2026-06-01T00:00:00.000Z'),
  ]

  it('does not mutate its input', () => {
    // The input is TanStack Query's cached array; sorting in place would reorder
    // the cache under every other reader.
    const before = names(listing)
    sortEntries(listing, 'size', 'desc')
    expect(names(listing)).toEqual(before)
  })

  it('sorts by name ascending with directories first', () => {
    expect(names(sortEntries(listing, 'name', 'asc'))).toEqual([
      'alpha',
      'beta',
      'apple.txt',
      'mango.txt',
      'zebra.txt',
    ])
  })

  it('keeps directories first when the direction is reversed', () => {
    // The whole point of pinning: descending must not bury every folder beneath a
    // long file list.
    const out = sortEntries(listing, 'name', 'desc')
    expect(names(out)).toEqual(['beta', 'alpha', 'zebra.txt', 'mango.txt', 'apple.txt'])
    expect(out.slice(0, 2).every((e) => e.type === 'directory')).toBe(true)
  })

  it('sorts files by size, both directions, directories still first', () => {
    expect(names(sortEntries(listing, 'size', 'asc'))).toEqual([
      'alpha',
      'beta',
      'zebra.txt',
      'mango.txt',
      'apple.txt',
    ])
    // Descending reverses the folder names too — the direction applies to the
    // whole list, as it does in Explorer.
    expect(names(sortEntries(listing, 'size', 'desc'))).toEqual([
      'beta',
      'alpha',
      'apple.txt',
      'mango.txt',
      'zebra.txt',
    ])
  })

  it('orders directories among themselves by name under the size key', () => {
    // A directory's reported size is the inode size, which the user cannot see, so
    // comparing it against a file's — or against another directory's — would look
    // like an arbitrary shuffle. Alphabetical is the honest fallback, and the
    // direction still applies to it.
    const dirs = [dir('gamma'), dir('alpha'), dir('beta')]
    expect(names(sortEntries(dirs, 'size', 'asc'))).toEqual(['alpha', 'beta', 'gamma'])
    expect(names(sortEntries(dirs, 'size', 'desc'))).toEqual(['gamma', 'beta', 'alpha'])
  })

  it('sorts by modified date, both directions', () => {
    expect(names(sortEntries(listing, 'modified', 'asc')).slice(2)).toEqual([
      'apple.txt',
      'zebra.txt',
      'mango.txt',
    ])
    expect(names(sortEntries(listing, 'modified', 'desc')).slice(2)).toEqual([
      'mango.txt',
      'zebra.txt',
      'apple.txt',
    ])
  })

  it('sorts an unparseable timestamp last instead of returning NaN', () => {
    // NaN from a comparator makes the result depend on the input order and on the
    // engine's sort implementation — a bug that reproduces on one machine only.
    const broken = [
      file('good.txt', 1, '2026-01-01T00:00:00.000Z'),
      file('bad.txt', 1, 'not a date'),
      file('newer.txt', 1, '2026-05-01T00:00:00.000Z'),
    ]
    expect(names(sortEntries(broken, 'modified', 'asc'))).toEqual([
      'good.txt',
      'newer.txt',
      'bad.txt',
    ])
  })

  it('breaks ties by name so equal entries never swap between renders', () => {
    const sameSize = [
      file('c.txt', 5, '2026-01-01T00:00:00.000Z'),
      file('a.txt', 5, '2026-01-01T00:00:00.000Z'),
      file('b.txt', 5, '2026-01-01T00:00:00.000Z'),
    ]
    expect(names(sortEntries(sameSize, 'size', 'asc'))).toEqual(['a.txt', 'b.txt', 'c.txt'])
    // Descending flips the size comparison, not the name tiebreak — the tiebreak
    // must stay stable or the list reshuffles when nothing changed.
    expect(names(sortEntries(sameSize, 'size', 'desc'))).toEqual(['a.txt', 'b.txt', 'c.txt'])
  })

  it('handles an empty listing', () => {
    expect(sortEntries([], 'name', 'asc')).toEqual([])
  })
})

describe('filterHidden', () => {
  const listing = [
    file('visible.txt', 1, '2026-01-01T00:00:00.000Z'),
    file('.bashrc', 1, '2026-01-01T00:00:00.000Z'),
    dir('.config'),
    dir('Documents'),
  ]

  it('drops dotfiles and dot-directories by default', () => {
    expect(names(filterHidden(listing, false))).toEqual(['visible.txt', 'Documents'])
  })

  it('returns everything when asked', () => {
    expect(filterHidden(listing, true)).toHaveLength(4)
  })

  it('returns the same array reference when showing hidden', () => {
    // Cheap identity check: a needless copy would make every render a new array
    // and defeat memoisation downstream.
    expect(filterHidden(listing, true)).toBe(listing)
  })

  it('does not treat a name with an interior dot as hidden', () => {
    expect(isHidden(file('archive.tar.gz', 1, '2026-01-01T00:00:00.000Z'))).toBe(false)
    expect(isHidden(dir('.local'))).toBe(true)
  })
})

describe('nextSort', () => {
  it('flips direction when the active column is clicked again', () => {
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' })
    expect(nextSort({ key: 'name', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' })
  })

  it('starts a new column at its natural direction, not the previous one', () => {
    // "Sort by size" means biggest first; "sort by name" means A→Z. Inheriting the
    // previous column's direction gives the user the opposite of what they meant
    // half the time.
    expect(nextSort({ key: 'name', dir: 'desc' }, 'size')).toEqual({ key: 'size', dir: 'desc' })
    expect(nextSort({ key: 'name', dir: 'asc' }, 'modified')).toEqual({
      key: 'modified',
      dir: 'desc',
    })
    expect(nextSort({ key: 'size', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'asc' })
  })
})

describe('ariaSort', () => {
  it('reports the direction only for the active column', () => {
    const current = { key: 'size' as const, dir: 'desc' as const }
    expect(ariaSort('size', current)).toBe('descending')
    expect(ariaSort('name', current)).toBe('none')
    expect(ariaSort('modified', current)).toBe('none')
    expect(ariaSort('size', { key: 'size', dir: 'asc' })).toBe('ascending')
  })
})

describe('grid geometry', () => {
  it('fits as many whole tiles as the pane allows', () => {
    expect(gridColumns(96 * 4)).toBe(4)
    expect(gridColumns(96 * 4 + 95)).toBe(4)
    expect(gridColumns(96 * 5)).toBe(5)
  })

  it('never returns zero columns for a degenerate pane', () => {
    // Zero columns divides into Infinity rows and NaN indices, and a pane really
    // does measure 0 before first layout or when a window is dragged to nothing.
    expect(gridColumns(0)).toBe(1)
    expect(gridColumns(-10)).toBe(1)
    expect(gridColumns(NaN)).toBe(1)
    expect(gridColumns(50)).toBe(1)
  })

  it('rounds rows up so a partial last row still exists', () => {
    expect(gridRowCount(10, 4)).toBe(3)
    expect(gridRowCount(8, 4)).toBe(2)
    expect(gridRowCount(1, 4)).toBe(1)
    expect(gridRowCount(0, 4)).toBe(0)
  })
})
