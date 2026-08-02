# Brief 75 — Bookmarks: a model the Browser can actually consume

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
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
