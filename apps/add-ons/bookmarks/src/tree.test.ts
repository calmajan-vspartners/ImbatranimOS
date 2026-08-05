import { describe, expect, it } from 'vitest'
import {
  allFolderIds,
  buildTree,
  countTree,
  dedupeImport,
  findDuplicate,
  folderPath,
  searchTree,
  subtreeOf,
  toParsedTree,
  toRows,
} from './tree'
import type { BookmarkGroup, BookmarkLink } from './types'

let nextId = 100
const link = (title: string, url: string, groupId: number): BookmarkLink => ({
  id: nextId++,
  groupId,
  title,
  url,
  icon: null,
  position: 1,
})
const group = (
  id: number,
  name: string,
  parentId: number | null,
  links: BookmarkLink[] = []
): BookmarkGroup => ({ id, name, icon: null, parentId, position: 1, links })

/**
 * Work
 *   Specs        — spec.example
 * Personal       — news.example
 */
function fixture(): BookmarkGroup[] {
  return [
    group(1, 'Work', null),
    group(2, 'Specs', 1, [link('Spec', 'https://spec.example/a', 2)]),
    group(3, 'Personal', null, [link('News', 'https://news.example/', 3)]),
  ]
}

describe('buildTree', () => {
  it('nests by parentId', () => {
    const tree = buildTree(fixture())
    expect(tree.map((n) => n.group.name)).toEqual(['Work', 'Personal'])
    expect(tree[0].children.map((n) => n.group.name)).toEqual(['Specs'])
    expect(tree[0].depth).toBe(0)
    expect(tree[0].children[0].depth).toBe(1)
  })

  it('shows a folder whose parent is missing rather than dropping it', () => {
    // The state the pre-brief-75 orphan bug produced. Losing a folder silently is
    // worse than showing it at the root.
    const tree = buildTree([group(9, 'Stranded', 404)])
    expect(tree.map((n) => n.group.name)).toEqual(['Stranded'])
  })

  it('terminates on a cycle in the data instead of hanging the render', () => {
    // The backend guard should make this impossible; the renderer is not the place to
    // discover that it failed.
    const tree = buildTree([group(1, 'A', 2), group(2, 'B', 1)])
    expect(allFolderIds(tree).length).toBeLessThanOrEqual(2)
  })
})

describe('toRows', () => {
  it('hides the contents of a collapsed folder but keeps its count', () => {
    const tree = buildTree(fixture())
    const collapsedAll = toRows(tree, new Set())
    expect(collapsedAll.map((r) => (r.kind === 'folder' ? r.group.name : r.link.title))).toEqual([
      'Work',
      'Personal',
    ])
    // The count is still reported, so the row can say what is inside unopened.
    const work = collapsedAll[0]
    expect(work.kind === 'folder' && work.childCount).toBe(1)
  })

  it('emits links and subfolders, indented, when open', () => {
    const tree = buildTree(fixture())
    const rows = toRows(tree, new Set([1, 2, 3]))
    expect(
      rows.map((r) => `${r.depth}:${r.kind === 'folder' ? r.group.name : r.link.title}`)
    ).toEqual(['0:Work', '1:Specs', '2:Spec', '0:Personal', '1:News'])
  })
})

describe('searchTree', () => {
  it('keeps a matching bookmark AND the folders needed to reach it', () => {
    // The bug this test exists for: filtering folders independently of their contents
    // hides a matching bookmark because its parent folder did not match the word.
    const result = searchTree(buildTree(fixture()), 'spec')
    expect(result.nodes.map((n) => n.group.name)).toEqual(['Work'])
    expect(result.nodes[0].children[0].group.links.map((l) => l.title)).toEqual(['Spec'])
    expect(result.matches).toBe(1)
    // Every folder on the path is force-opened so the match is actually visible.
    expect([...result.expand].sort()).toEqual([1, 2])
  })

  it('shows everything inside a folder that matches by name', () => {
    const result = searchTree(buildTree(fixture()), 'personal')
    expect(result.nodes.map((n) => n.group.name)).toEqual(['Personal'])
    expect(result.nodes[0].group.links.map((l) => l.title)).toEqual(['News'])
  })

  it('matches on the URL, not just the title', () => {
    const result = searchTree(buildTree(fixture()), 'news.example')
    expect(result.matches).toBe(1)
  })

  it('returns nothing when nothing matches', () => {
    const result = searchTree(buildTree(fixture()), 'zzz')
    expect(result.nodes).toEqual([])
    expect(result.matches).toBe(0)
  })

  it('is a no-op for an empty query', () => {
    const tree = buildTree(fixture())
    const result = searchTree(tree, '   ')
    expect(result.nodes).toBe(tree)
    expect(result.expand.size).toBe(0)
  })

  it('is case-insensitive', () => {
    expect(searchTree(buildTree(fixture()), 'SPEC').matches).toBe(1)
  })
})

describe('subtreeOf — what a delete is actually about to destroy', () => {
  it('includes the folder AND everything under it', () => {
    // The bug this exists for: a one-pass "collect if this is the target" recursion
    // keeps looking for the target among the children instead of collecting them, so
    // it returns Work alone. The confirm then said "the empty folder Work" about a
    // folder holding a subfolder and two bookmarks — understating a destructive
    // action, which is the one direction that must never happen.
    const subtree = subtreeOf(buildTree(fixture()), 1)
    expect(subtree.map((g) => g.name)).toEqual(['Work', 'Specs'])
    expect(subtree.reduce((n, g) => n + g.links.length, 0)).toBe(1)
  })

  it('finds a folder nested below the root', () => {
    expect(subtreeOf(buildTree(fixture()), 2).map((g) => g.name)).toEqual(['Specs'])
  })

  it('is empty for a folder that is not there', () => {
    expect(subtreeOf(buildTree(fixture()), 999)).toEqual([])
  })

  it('counts a deep chain in full', () => {
    const deep = [
      group(1, 'A', null),
      group(2, 'B', 1),
      group(3, 'C', 2, [link('x', 'https://x.example/', 3)]),
    ]
    const subtree = subtreeOf(buildTree(deep), 1)
    expect(subtree.map((g) => g.name)).toEqual(['A', 'B', 'C'])
    expect(subtree.reduce((n, g) => n + g.links.length, 0)).toBe(1)
  })
})

describe('folderPath', () => {
  it('joins the ancestors', () => {
    expect(folderPath(fixture(), 2)).toBe('Work / Specs')
    expect(folderPath(fixture(), 1)).toBe('Work')
  })

  it('stops on a broken or cyclic chain', () => {
    expect(folderPath([group(1, 'A', 2), group(2, 'B', 1)], 1)).toBe('B / A')
    expect(folderPath([group(9, 'Stranded', 404)], 9)).toBe('Stranded')
  })
})

describe('findDuplicate', () => {
  it('finds the same address filed anywhere, and says where', () => {
    // The duplicate a user most wants warning about is the one in a folder they are
    // not looking at.
    const found = findDuplicate(fixture(), 'https://www.spec.example/a')
    expect(found?.link.title).toBe('Spec')
    expect(found?.path).toBe('Work / Specs')
  })

  it('is null for an address that is not there', () => {
    expect(findDuplicate(fixture(), 'https://nothing.example/')).toBeNull()
  })
})

describe('dedupeImport', () => {
  const imported = [
    {
      name: 'Bar',
      links: [
        { title: 'Spec again', url: 'https://spec.example/a' },
        { title: 'Fresh', url: 'https://fresh.example/' },
      ],
      folders: [
        {
          name: 'Empty after dedupe',
          links: [{ title: 'News', url: 'https://news.example/' }],
          folders: [],
        },
      ],
    },
  ]

  it('drops bookmarks already in the collection', () => {
    const result = dedupeImport(imported, fixture())
    expect(result.duplicates).toBe(2)
    expect(result.folders[0].links.map((l) => l.title)).toEqual(['Fresh'])
  })

  it('drops folders that end up empty, so a re-import adds nothing at all', () => {
    const result = dedupeImport(imported, fixture())
    // "Empty after dedupe" held only a bookmark we already have.
    expect(result.folders[0].folders).toEqual([])

    const again = dedupeImport(
      [{ name: 'Bar', links: [{ title: 'Spec', url: 'https://spec.example/a' }], folders: [] }],
      fixture()
    )
    expect(again.folders).toEqual([])
    expect(again.duplicates).toBe(1)
  })

  it('dedupes within the file itself, which real exports contain', () => {
    const result = dedupeImport(
      [
        {
          name: 'Dupes',
          links: [
            { title: 'One', url: 'https://one.example/' },
            { title: 'One again', url: 'https://www.one.example' },
          ],
          folders: [],
        },
      ],
      []
    )
    expect(result.duplicates).toBe(1)
    expect(result.folders[0].links.map((l) => l.title)).toEqual(['One'])
  })
})

describe('countTree', () => {
  it('counts folders and links at every depth', () => {
    expect(
      countTree([
        {
          name: 'a',
          links: [{ title: '1', url: 'https://a.example/' }],
          folders: [{ name: 'b', links: [{ title: '2', url: 'https://b.example/' }], folders: [] }],
        },
      ])
    ).toEqual({ folders: 2, links: 2 })
  })

  it('is zero for nothing', () => {
    expect(countTree([])).toEqual({ folders: 0, links: 0 })
  })
})

describe('toParsedTree', () => {
  it('produces exactly what the exporter and the import DTO expect', () => {
    expect(toParsedTree(buildTree(fixture()))).toEqual([
      {
        name: 'Work',
        links: [],
        folders: [
          { name: 'Specs', links: [{ title: 'Spec', url: 'https://spec.example/a' }], folders: [] },
        ],
      },
      {
        name: 'Personal',
        links: [{ title: 'News', url: 'https://news.example/' }],
        folders: [],
      },
    ])
  })
})
