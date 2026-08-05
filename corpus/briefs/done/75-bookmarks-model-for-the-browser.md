# Brief 75 — Bookmarks: a model the Browser can actually consume

Status: **done 2026-08-05** · From the 2026-07-31 app+OS improvement sweep.
EASY/MEDIUM · add-on `apps/add-ons/bookmarks` (562 LOC) + the backend
`bookmarks` module. **Sequence before brief 50 (web browser)**, which plans to
reuse this app rather than rebuild bookmarks.

## Problem

Bookmarks is backend-persisted (`/bookmarks/groups`) — good — with a flat model
of one group level containing links (`types.ts`):

```ts
BookmarkGroup { id, name, icon?, links: BookmarkLink[] }
BookmarkLink  { id, group_id, title, href, icon? }
```

Today it is a launcher of URLs that open in the *host* browser, which is a
reasonable thing for it to have been. But **brief 50 changes what it is for**:
the Browser app will consume it via `openApp('browser', { url })`, making this
the OS's bookmark store rather than a link list. That makes the model's
limitations load-bearing:

1. **One level of grouping only.** No nested folders, which is what a real
   bookmark tree is, and what any import will contain.
2. **No tags and no search.** With more than a screenful, there is no way to
   find anything.
3. **No import/export.** A user's actual bookmarks live in Chrome or Firefox as
   Netscape-format HTML. Without import, adopting the Browser app means
   re-entering everything by hand; without export, the data is trapped —
   the same interop argument as CSV for Sheets and ICS for Calendar.
4. **No duplicate detection and no reordering.**
5. **`href` vs `url` naming.** Brief 50 speaks of `openApp('browser', { url })`.
   Settle the field name now, in one place, rather than translating at the seam
   forever.
6. **`icon?` is an unspecified string.** Before the Browser exists it is
   presumably a lucide name. Decide what it means before favicons become
   tempting.

## Proposed decisions (ungrilled)

- **Nested folders**, via a self-referencing `parentId` on the group, expanded
  lazily in the UI. This is the change that makes import possible, so it comes
  first.
- **Import and export Netscape-format HTML** (what every browser reads and
  writes). Import maps the folder tree onto the nested model and reports what it
  skipped; export produces a file any browser can read.
- **Search across title, URL and folder**, and contribute results to the command
  palette through the app's existing `commandSource.ts`, so bookmarks are
  reachable from `Ctrl+K` without opening the app.
- **Settle the contract with brief 50 now.** Name the field `url`, migrating
  `href`, and define the intent payload once so the Browser consumes it
  unchanged. Record it in the brief-50 spec too, since a mismatch there means
  rework in two apps.
- **No favicons — for now, and say why.** Fetching a favicon means an outbound
  request per bookmark from the desktop origin, which needs a CSP hole and leaks
  browsing interest to third parties. Once brief 50 lands its authed, SSRF-
  filtered proxy, favicons can be fetched **through that proxy** and cached in
  the home volume. Until then, keep the lucide icon. Note this explicitly so it
  is not re-argued.
- **Duplicate detection on add** (same normalised URL), offering to jump to the
  existing entry instead of silently creating a second.
- **Rejected — browser-extension sync.** No credentials, no external services.
- **Rejected — a separate "reading list".** It is a folder.

## Fix

1. Backend: `parentId` on groups (nullable, self-FK) with a cycle guard; rename
   `href` → `url` with a migration; keep everything authed and owner-scoped.
2. Frontend: tree rendering with expand/collapse and drag-to-reorder/move
   between folders; search box filtering the tree.
3. Import/export: a Netscape-HTML parser and serialiser (small and
   well-specified; no dependency), wired to brief 54's file dialog for choosing
   the file.
4. Normalised-URL duplicate check on add.
5. Extend `commandSource.ts` so bookmarks are searchable from the palette.
6. Document the `openApp('browser', { url })` payload in this app's `index.ts`
   as the contract brief 50 will consume.

## Must preserve (regression surface)

- Existing groups and links survive the `parentId` and `href` → `url`
  migrations — test with a realistic dataset.
- Routes stay authed and owner-scoped.
- The existing palette command source keeps working.
- Until brief 50 lands, activating a bookmark keeps doing exactly what it does
  today; this brief must not change the open behaviour, only the model.
- A cycle in `parentId` must be impossible (a folder cannot be its own ancestor).

## Verify bar

`turbo typecheck`, lint + format green, `turbo build` ok. Backend tests for the
migrations, owner scoping, and the cycle guard. Unit tests for the Netscape
parser (nested folders, entities in titles, missing attributes) and the URL
normaliser used for duplicate detection.

**Verified in a browser**: export bookmarks from a real browser and import the
file; confirm the folder tree matches; search from the app and from Ctrl+K;
create a duplicate and get the prompt; move a bookmark between folders and
reload.

## Out of scope

Favicons (until brief 50's proxy exists), sync, sharing, a reading list, tags
(folders first — revisit only if folders prove insufficient), and any Browser
app work.

---

## Outcome — done 2026-08-05

Every item on the problem list was real. The model is now nested, `url`-named,
importable and exportable — and the bug brief 73 handed over is fixed, along with two
more found by measuring rather than reading.

### The bug handed over from brief 73: deleting a folder orphaned every link in it

`bookmark_links.group_id` declares `ON DELETE CASCADE` and `deleteGroup` even carried
a comment saying *"CASCADE delete is handled by SQLite foreign key ON DELETE
CASCADE"*. But **`PRAGMA foreign_keys` is never enabled on this connection**, so the
constraint was decorative: every folder deletion left its links in the table. They
were invisible — the read path buckets links by an existing folder id — and
accumulated forever.

Fixed in two places, because a live database may already be carrying them:

- `deleteGroup` now collects the folder's **subtree** and deletes links and folders in
  one transaction. Same shape as Todo's list deletion, for the same reason. The
  subtree walk is iterative with a seen-set, so a cycle written before the guard
  existed cannot spin the server.
- `migrate()` sweeps up what the shipped bug already produced: orphaned links are
  **deleted** (the user confirmed "Delete group and all its links?", so they were
  meant to go — resurrecting them would undo a decision already made), while a folder
  whose parent is gone is **promoted to the root** rather than deleted, because nobody
  ever confirmed losing that.

The pragma itself is still off, deliberately: turning it on globally would change
behaviour for every other module at once, which is not this brief's business. The
lesson is now recorded in the schema — every new column that would want a foreign key
carries a comment saying why it has none.

### Found while probing, in no brief: `@IsUrl()` was wrong in both directions

Measured against validator.js's defaults, the DTO this module shipped with:

```
http://localhost:3000   REJECTED   ← the OS itself is a localhost web app
http://imbatranim       REJECTED   ← the machine's own hostname
https://a.b/c?d=1#e     REJECTED   ← a perfectly valid URL
ftp://x.com             ACCEPTED   ← a scheme nothing here can open
```

So a user could not bookmark their own dev server but could store an `ftp:` link.
`require_tld` is the cause: a single-label host has no dot, and the check does not care
that it resolves.

Replaced with an explicit **scheme allow-list** parsed by the platform's `URL`
(`dto/bookmark-url.ts`). `http:` and `https:` only. That is stricter where it matters
and permissive where the OS needs it — and the strictness became load-bearing the
moment this brief added import: a Netscape file is untrusted input, the app renders
bookmarks as `<a href>`, and a `javascript:` or `data:` URL reaching the table would
be stored XSS. The e2e proves the whole import is refused rather than partially
applied when one URL fails.

The frontend completes a bare host (`example.com` → `https://example.com`) so the
allow-list never turns into pedantry — and `completeUrl` explicitly refuses to invent
a scheme for a string that already has one, so it can never launder a rejected URL
into an accepted one.

### Found while probing, in no brief: core's `Select` showed values, not labels

The folder picker in the new move dialog read **`6`** instead of `Work / Specs`.
Cause is in core, not this app: `<BaseSelect.Value>` with no children renders the raw
value, because base-ui can only resolve a label when `Select.Root` is given an `items`
map. **Every Select in the OS whose value differed from its label was affected** —
`git-gui`'s repository picker showed a root id, Calendar's reminder picker showed a
minute offset. Fixed once in `ui/Select.tsx` with a `children` lookup; verified in the
browser that git-gui's picker now reads "Home". No jsdom test: core's vitest config
explicitly defers component testing until a brief requires it, and a browser check is
stronger here than a rendered assertion.

### Found while probing: my own delete confirm understated a destructive action

It said *"Delete the empty folder Work?"* about a folder holding a subfolder and two
bookmarks. The subtree collection recursed with the same "is this the target?"
predicate, so it kept *looking for* the target among the children instead of
collecting them. Now `subtreeOf` in `tree.ts`, two passes and tested — the confirm
reads "Delete “Work” and everything in it — 1 bookmark and 1 subfolder?". A confirm
that understates what will be lost is the one direction that must never happen.

### The decisions

- **Nested folders via `parentId`**, with a cycle guard that walks *up* from the
  proposed parent (the cheap direction: a cycle exists exactly when the moved folder
  is on that chain). Refused with a 400, tested three ways — into itself, into its
  child, into its grandchild.
- **`href` → `url`, all the way to the SQLite column**, via `ALTER TABLE RENAME
  COLUMN`. This is the contract brief 50 will consume, documented in this app's
  `index.ts` so whoever implements the Browser reads it there: the field is `url`,
  only `http(s)` can be stored, and the tree is flat + `parentId` with the helpers in
  `tree.ts` reusable.
- **The tree is assembled on the client.** The whole collection is one screenful of
  data even after a large import, the palette needs the flat link list anyway, and a
  nested response would make "move this folder" a diff of two trees instead of one
  field.
- **Netscape HTML parsed on the client, inserted by one authed route.** `netscape.ts`
  is hand-rolled with no dependency, per the brief — and for a reason beyond the
  dependency rule: `DOMParser` is untestable in the `node` environment every add-on's
  vitest uses, and this is precisely the code whose input is written by someone else's
  software. The format is also not real HTML (unclosed `<DT>`, stray `<p>`, nesting by
  `<DL>` depth), so a tolerant scanner models it better than a spec-compliant parser
  that would try to "fix" the markup. Import is **one round trip and one transaction**
  rather than 2000 POSTs.
- **Import reports what it refused.** Skipped non-web URLs, folders flattened past
  `MAX_DEPTH` (kept, not dropped), and duplicates already present are all counted and
  said out loud. A re-import of an unchanged file adds *nothing* — including no empty
  folder shells — and says so.
- **Duplicate detection on a normalised URL**, with the normalisation choices written
  down in `urlNormalise.ts` rather than left implicit: scheme kept, host lowercased,
  path case preserved, default port and empty trailing slash and fragment dropped,
  query kept exactly, `www.` dropped as an acknowledged heuristic. The duplicate
  search covers the **whole tree**, because the duplicate worth warning about is the
  one in a folder the user is not looking at.
- **Search keeps the path to a match.** A folder is kept if it matches *or if anything
  below it does*, and the folders on the way are force-opened. Filtering folders
  independently of their contents is the bug this is written to avoid.
- **Reorder is structurally safe.** Brief 73's reorder bug was a filtered view
  stamping 1..N over rows it could not see; here the server refuses a list that is not
  every sibling of exactly one parent.
- **No favicons**, restated as a decision with its reason in `index.ts`, and imported
  base64 `ICON` attributes are dropped for the same reason. Revisit when brief 50's
  proxy exists.
- **Opening a bookmark still calls `window.open`** — the brief is explicit that this
  brief changes the model, not the open behaviour.
- **A picker, not a typed folder name, for "move".** Asking a user to retype
  `Work / Specs` exactly would be a spelling test.

### The style pass, unasked but owed

The brief said nothing about style, but this app had the same debt brief 74 just paid
for sticky-notes: raw `<button>`s throughout, a `<span onClick>` rename that no
keyboard could reach, and — worse — **no failure signal at all**. Every mutation
carried `onSuccess` only, so a rejected write did nothing visible. Now kit `Button`s,
real `<button>` rows with focus rings, and one `reportFailure()` on every mutation's
`onError`.

### Verified in a browser, against the production bundle on the real backend

```
PASS the tree renders nested, indented 6/18/30px by depth
PASS collapsing a folder hides its contents and keeps its count
PASS searching "5545" keeps Work / Specs / RFC 5545 — the whole path
PASS searching a folder name shows everything inside it
PASS the status bar reads "3 bookmarks · 3 folders", then "1 match"
PASS one Tab run reaches a bookmark row (#11) — it was unreachable before
PASS deleting a folder leaves ZERO orphaned links (the brief-73 bug)
PASS the confirm names what is lost: "1 bookmark and 1 subfolder"
PASS the duplicate prompt fires for "www.news.example" vs a stored news.example
PASS the move dialog's picker reads "Work / Specs", not "6"
PASS moving a bookmark lands it in the destination folder
PASS importing a real Chrome file: 2 imported, 2 skipped, 1 already here
PASS no javascript: or place: URL reaches the table
PASS export writes Chrome's exact format, nested, entities escaped
PASS re-importing that export adds nothing: "All 4 bookmarks are already here"
PASS Ctrl+K finds a bookmark by its FOLDER name, with the path in the subtitle
PASS every control is reachable at the declared minSize of 340x380
PASS git-gui's Select now reads "Home" instead of a raw root id
PASS light theme: row and status text both readable
page errors: none
```

Tests: frontend vitest **828 → 886** (58 new in a package that had **zero** — the
Netscape reader/writer against a real Chrome export, the URL normaliser, and the tree
helpers), backend e2e **115 → 138** (23 new covering auth on all ten routes, the
camelCase/`url` shape, what counts as a URL, nesting and the cycle guard, the orphan
bug and its migration sweep, moving, reordering, and atomic import). Backend unit
unchanged at 208. All 101 turbo tasks green. Zero new dependencies.

Out of scope and untouched, as the brief specified: favicons, sync, sharing, a reading
list, tags, and any Browser app work. Drag-to-reorder is also not here — the reorder
*routes* and their guards are, so the gesture is a UI addition rather than a model
change, exactly as Todo's drag was split out.
