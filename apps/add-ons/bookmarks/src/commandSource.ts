import type { CommandSource, CommandSourceContext, CommandItem } from '@imbatranim/core'
import { fetchGroups } from './api/bookmarksApi'
import { folderPath } from './tree'
import type { BookmarkLink } from './types'

const GROUP = 'Bookmarks'

/**
 * Bookmarks in the command palette.
 *
 * The URL cache is populated on each search so `activate` can open without a second
 * round trip — `activate` is synchronous by contract, so it cannot fetch. It is keyed
 * by id and refreshed on every search, so it never serves a URL the search did not
 * just see.
 */
const urlCache = new Map<number, string>()

/** How many results the palette shows. More than this and the palette is a list app. */
const LIMIT = 8

export const bookmarksSource: CommandSource = {
  group: GROUP,

  async search(query: string, ctx: CommandSourceContext): Promise<CommandItem[]> {
    try {
      const groups = await fetchGroups(ctx.http)
      const needle = query.trim().toLowerCase()

      // Searching the folder path too is the point of the palette after brief 75:
      // typing "work" should reach everything filed under Work, even when no
      // bookmark's own title contains the word.
      const matches: { link: BookmarkLink; path: string }[] = []
      for (const group of groups) {
        const path = folderPath(groups, group.id)
        for (const link of group.links) {
          urlCache.set(link.id, link.url)
          if (
            needle === '' ||
            link.title.toLowerCase().includes(needle) ||
            link.url.toLowerCase().includes(needle) ||
            path.toLowerCase().includes(needle)
          ) {
            matches.push({ link, path })
          }
        }
      }

      return matches.slice(0, LIMIT).map(({ link, path }) => ({
        id: `bookmark:${link.id}`,
        label: link.title,
        // The folder is what tells two similarly named bookmarks apart; the URL alone
        // often cannot, since two pages share a host.
        subtitle: path ? `${path} · ${link.url}` : link.url,
        group: GROUP,
      }))
    } catch {
      return []
    }
  },

  activate(item: CommandItem): void {
    const id = parseInt(item.id.replace(/^bookmark:/, ''), 10)
    const url = urlCache.get(id)
    // Deliberately no fallback to parsing `subtitle`: it now carries the folder path
    // as well, so treating it as a URL would open the wrong thing. A cache miss means
    // a stale item, and doing nothing beats opening something unintended.
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  },
}
