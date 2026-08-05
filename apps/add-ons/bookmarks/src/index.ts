import { lazy } from 'react'
import { Bookmark } from 'lucide-react'
import type { AddonManifest } from '@imbatranim/core'
import { bookmarksSource } from './commandSource'

/**
 * The contract brief 50 (web browser) will consume — settled here, once.
 *
 * The Browser app is planned to **reuse this app** as the OS's bookmark store rather
 * than build its own, and to open a bookmark with:
 *
 * ```ts
 * openApp('browser', { url })
 * ```
 *
 * So brief 75 renamed the field from `href` to `url` all the way down to the SQLite
 * column, rather than leaving a translation at that seam forever. Three things are
 * fixed for whoever implements brief 50:
 *
 * 1. **The field is `url`**, on `BookmarkLink` and in the `bookmark_links` table.
 * 2. **Only `http:` and `https:` can be stored.** The DTO's allow-list
 *    (`bookmark-url.ts`) is what makes it safe to hand a stored value straight to
 *    the browser's fetch path, and to render it as `<a href>` — a `javascript:` or
 *    `data:` URL can never be in the table, including via import.
 * 3. **The tree is flat + `parentId`.** `GET /bookmarks/groups` returns every folder
 *    with its own links; the tree is assembled client-side (`tree.ts`), so the
 *    Browser can reuse the same helpers instead of a second traversal.
 *
 * Until brief 50 exists, activating a bookmark still calls `window.open` — the brief
 * is explicit that this must not change the open behaviour, only the model.
 *
 * **No favicons**, and this is a decision rather than an omission: fetching one is an
 * outbound request per bookmark from the desktop origin, which needs a CSP hole and
 * leaks browsing interest to third parties. Once brief 50 lands its authed,
 * SSRF-filtered proxy they can be fetched *through that proxy* and cached in the home
 * volume. Imported `ICON` attributes (base64 favicons) are dropped for the same
 * reason — see `netscape.ts`.
 */
export const manifest: AddonManifest = {
  id: 'bookmarks',
  name: 'Bookmarks',
  description: 'Save and organize links',
  meta: ['links', 'favorites', 'urls', 'folders'],
  icon: Bookmark,
  component: lazy(() => import('./Bookmarks').then((m) => ({ default: m.Bookmarks }))),
  multiInstance: false,
  defaultSize: { width: 520, height: 560 },
  // Measured, not rounded: at 340px the toolbar wraps to two rows and a depth-4 row
  // still shows its title; below that the search field collapses past usefulness.
  minSize: { width: 340, height: 380 },
  commandSources: [bookmarksSource],
}
