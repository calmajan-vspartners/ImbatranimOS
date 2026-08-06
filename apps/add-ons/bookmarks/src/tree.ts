import type { BookmarkGroup, BookmarkLink } from './types'
import { normaliseUrl } from './urlNormalise'
import type { ParsedFolder, ParsedLink } from './netscape'

/**
 * Turning the API's flat folder list into something renderable.
 *
 * The server returns folders flat with a `parentId` (see the note on
 * `findAllGroups`), so assembling and flattening the tree lives here — pure, so the
 * two things that are easy to get quietly wrong can be tested: a search that hides a
 * matching child along with its non-matching parent, and a cycle in the data
 * hanging the render.
 */

export type TreeNode = {
  group: BookmarkGroup
  children: TreeNode[]
  depth: number
}

/** One rendered line: a folder or a bookmark, already indented. */
export type Row =
  | { kind: 'folder'; group: BookmarkGroup; depth: number; childCount: number }
  | { kind: 'link'; link: BookmarkLink; depth: number }

/**
 * Build the forest.
 *
 * A folder whose `parentId` points at something missing is treated as a root rather
 * than dropped — the same choice the backend's repair makes, and the reason is the
 * same: losing a folder silently is worse than showing it in the wrong place. The
 * `seen` set makes a cycle in the data finite instead of infinite; the backend's guard
 * should prevent one, but the renderer is not the place to find out it failed.
 */
export function buildTree(groups: BookmarkGroup[]): TreeNode[] {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const childrenOf = new Map<number | null, BookmarkGroup[]>()
  for (const group of groups) {
    const parentId = group.parentId !== null && byId.has(group.parentId) ? group.parentId : null
    const bucket = childrenOf.get(parentId)
    if (bucket) bucket.push(group)
    else childrenOf.set(parentId, [group])
  }

  const seen = new Set<number>()
  const build = (parentId: number | null, depth: number): TreeNode[] =>
    (childrenOf.get(parentId) ?? [])
      .filter((group) => {
        if (seen.has(group.id)) return false
        seen.add(group.id)
        return true
      })
      .map((group) => ({ group, children: build(group.id, depth + 1), depth }))

  const roots = build(null, 0)
  // A *pure* cycle (A→B→A, both present) has no member parented at `null`, so the
  // walk above never reaches it and both folders vanish (L5). Surface any group the
  // walk never visited as a root — the same "wrong place beats silently dropped"
  // choice as a dangling parentId. `seen` still bounds the recursion, so a cycle
  // stays finite. `groups` order is stable, so this is deterministic.
  for (const group of groups) {
    if (seen.has(group.id)) continue
    seen.add(group.id)
    roots.push({ group, children: build(group.id, 1), depth: 0 })
  }

  return roots
}

/**
 * Flatten to rows for rendering, honouring which folders are open.
 *
 * A collapsed folder still reports its `childCount` (folders + links, one level) so
 * the row can say what is inside without the user having to open it.
 */
export function toRows(nodes: TreeNode[], expanded: ReadonlySet<number>): Row[] {
  const rows: Row[] = []
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      rows.push({
        kind: 'folder',
        group: node.group,
        depth: node.depth,
        childCount: node.children.length + node.group.links.length,
      })
      if (!expanded.has(node.group.id)) continue
      for (const link of node.group.links) {
        rows.push({ kind: 'link', link, depth: node.depth + 1 })
      }
      walk(node.children)
    }
  }
  walk(nodes)
  return rows
}

export type SearchResult = {
  /** The tree with non-matching branches removed. */
  nodes: TreeNode[]
  /** Folders to force open so every match is visible. */
  expand: Set<number>
  /** How many bookmarks matched. */
  matches: number
}

/**
 * Filter the tree to what matches, keeping the folders needed to reach it.
 *
 * The rule that matters: **a folder is kept if it matches OR if anything below it
 * does.** Filtering folders independently of their contents is the bug this is
 * written to avoid — it hides a matching bookmark because its parent folder happened
 * not to match the word. A folder that matches by name keeps *all* of its contents,
 * because "show me the Work folder" should show the Work folder.
 */
export function searchTree(nodes: TreeNode[], query: string): SearchResult {
  const needle = query.trim().toLowerCase()
  if (needle === '') return { nodes, expand: new Set(), matches: 0 }

  const expand = new Set<number>()
  let matches = 0

  const linkMatches = (link: BookmarkLink) =>
    link.title.toLowerCase().includes(needle) || link.url.toLowerCase().includes(needle)

  const prune = (list: TreeNode[]): TreeNode[] => {
    const kept: TreeNode[] = []
    for (const node of list) {
      const nameHit = node.group.name.toLowerCase().includes(needle)
      const children = prune(node.children)
      const links = nameHit ? node.group.links : node.group.links.filter(linkMatches)
      if (!nameHit && children.length === 0 && links.length === 0) continue
      matches += links.length
      expand.add(node.group.id)
      kept.push({
        group: { ...node.group, links },
        children,
        depth: node.depth,
      })
    }
    return kept
  }

  return { nodes: prune(nodes), expand, matches }
}

/**
 * A folder and everything under it, for "what exactly am I about to delete?".
 *
 * Written as two passes — find the node, then take all of it — because the obvious
 * one-pass version is wrong in a way that is easy to miss: recursing with the same
 * "is this the target?" predicate keeps *looking for the target* among the children
 * instead of collecting them, so it returns the folder alone and the confirm
 * understates a destructive action.
 */
export function subtreeOf(nodes: TreeNode[], id: number): BookmarkGroup[] {
  const find = (list: TreeNode[]): TreeNode | null => {
    for (const node of list) {
      if (node.group.id === id) return node
      const hit = find(node.children)
      if (hit) return hit
    }
    return null
  }
  const collect = (node: TreeNode): BookmarkGroup[] => [
    node.group,
    ...node.children.flatMap(collect),
  ]
  const found = find(nodes)
  return found ? collect(found) : []
}

/** Every folder id, for "expand all" and for the initial open-the-roots state. */
export function allFolderIds(nodes: TreeNode[]): number[] {
  const ids: number[] = []
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      ids.push(node.group.id)
      walk(node.children)
    }
  }
  walk(nodes)
  return ids
}

/** `Work / Specs / Draft`, for a search result's subtitle and the command palette. */
export function folderPath(groups: BookmarkGroup[], groupId: number): string {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const names: string[] = []
  const seen = new Set<number>()
  let cursor: number | null = groupId
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor)
    const group: BookmarkGroup | undefined = byId.get(cursor)
    if (!group) break
    names.unshift(group.name)
    cursor = group.parentId
  }
  return names.join(' / ')
}

/**
 * Find an existing bookmark with the same normalised URL.
 *
 * Searches the whole tree, not just the target folder: the same page filed twice in
 * two folders is the duplicate a user most wants to be warned about, since it is the
 * one they cannot see.
 */
export function findDuplicate(
  groups: BookmarkGroup[],
  url: string
): { link: BookmarkLink; path: string } | null {
  const needle = normaliseUrl(url)
  for (const group of groups) {
    for (const link of group.links) {
      if (normaliseUrl(link.url) === needle) {
        return { link, path: folderPath(groups, group.id) }
      }
    }
  }
  return null
}

/**
 * Drop bookmarks from a parsed import that the collection already has.
 *
 * Import is where duplicates arrive in bulk — re-importing the same export, or
 * importing from a second browser that shares most of its bookmarks. Empty folders
 * left behind by the filter are dropped too, so a re-import of an unchanged file adds
 * nothing at all rather than a shell of the tree.
 */
export function dedupeImport(
  folders: ParsedFolder[],
  existing: BookmarkGroup[]
): { folders: ParsedFolder[]; duplicates: number } {
  const known = new Set<string>()
  for (const group of existing) {
    for (const link of group.links) known.add(normaliseUrl(link.url))
  }
  let duplicates = 0

  const keepLink = (link: ParsedLink) => {
    const key = normaliseUrl(link.url)
    if (known.has(key)) {
      duplicates += 1
      return false
    }
    // Also dedupes within the file itself, which real exports do contain.
    known.add(key)
    return true
  }

  const prune = (list: ParsedFolder[]): ParsedFolder[] => {
    const kept: ParsedFolder[] = []
    for (const folder of list) {
      const links = folder.links.filter(keepLink)
      const children = prune(folder.folders)
      if (links.length === 0 && children.length === 0) continue
      kept.push({ name: folder.name, links, folders: children })
    }
    return kept
  }

  return { folders: prune(folders), duplicates }
}

/** Count what an import will actually create, for the confirmation and the report. */
export function countTree(folders: ParsedFolder[]): { folders: number; links: number } {
  let folderCount = 0
  let linkCount = 0
  const walk = (list: ParsedFolder[]) => {
    for (const folder of list) {
      folderCount += 1
      linkCount += folder.links.length
      walk(folder.folders)
    }
  }
  walk(folders)
  return { folders: folderCount, links: linkCount }
}

/** The whole collection as a parsed tree, for export. */
export function toParsedTree(nodes: TreeNode[]): ParsedFolder[] {
  return nodes.map((node) => ({
    name: node.group.name,
    links: node.group.links.map((link) => ({ title: link.title, url: link.url })),
    folders: toParsedTree(node.children),
  }))
}
