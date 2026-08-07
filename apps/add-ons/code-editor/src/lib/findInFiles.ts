import type { SystemHttp } from '@imbatranim/ui'

/** One matching line, as the backend reports it (brief 113). */
export type SearchMatch = { line: number; text: string }

/** The raw hit shape of `GET /api/files/search`. */
export type RawHit = {
  name: string
  path: string
  type: 'file' | 'directory'
  matches?: SearchMatch[]
}

/** One file in the results panel, with its matching lines under it. */
export type FileGroup = {
  path: string
  name: string
  /** The folder the file lives in, '' at the root — the row's subtitle. */
  dir: string
  matches: SearchMatch[]
  /**
   * True when the file is here because its NAME matched, with nothing in the
   * body. Rendered as such: a group with no rows under it looks like a bug.
   */
  nameOnly: boolean
}

export type FindResult = {
  groups: FileGroup[]
  /** The walk hit a bound and stopped — never present this as "everything". */
  truncated: boolean
  /** Total matching lines across every group, for the summary line. */
  matchCount: number
}

export const EMPTY_RESULT: FindResult = { groups: [], truncated: false, matchCount: 0 }

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

/**
 * Shape a raw search response into the panel's model.
 *
 * Directories are dropped — you cannot open one at a line, and a find-in-files
 * result list that includes folders is answering a different question. Files
 * whose name matched but whose body did not are KEPT, flagged `nameOnly`:
 * silently discarding them would mean typing a filename into find-in-files and
 * being told there are no results for a file you can see.
 */
export function groupHits(items: readonly RawHit[]): FindResult {
  const groups: FileGroup[] = []
  let matchCount = 0
  for (const hit of items) {
    if (hit.type !== 'file') continue
    const matches = hit.matches ?? []
    matchCount += matches.length
    groups.push({
      path: hit.path,
      name: hit.name,
      dir: dirOf(hit.path),
      matches,
      nameOnly: matches.length === 0,
    })
  }
  return { groups, truncated: false, matchCount }
}

/**
 * Run one find-in-files search.
 *
 * `content=1` plus `matches=1`: the content grep is what makes this
 * find-in-files rather than find-a-filename, and the line data is what the
 * panel groups under. Both are opt-in, so no other consumer of this endpoint
 * changes shape.
 */
export async function runFindInFiles(
  http: SystemHttp,
  args: { root: string; query: string; scope?: string }
): Promise<FindResult> {
  const res = await http.get<{ items: RawHit[]; truncated: boolean }>('/files/search', {
    params: {
      root: args.root,
      query: args.query,
      content: 1,
      matches: 1,
      // Omitted at the root — an absent scope IS the whole-root walk.
      ...(args.scope ? { path: args.scope } : {}),
    },
  })
  const grouped = groupHits(res.data.items ?? [])
  return { ...grouped, truncated: Boolean(res.data.truncated) }
}
