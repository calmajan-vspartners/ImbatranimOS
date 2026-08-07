# Brief 112 — File Manager search: the box the endpoint has been waiting for

> **Outcome (2026-08-07): DONE.** The endpoint gained one additive optional
> `path` on `SearchQueryDto`; `FilesService.search` now starts the walk at
> `resolveSafe(root, opts.path ?? '')` while still emitting
> `relative(rootDir, abs)`, so a scoped hit's path is root-relative exactly as
> before and the palette's responses are byte-identical. Every bound still
> binds inside a scope, and a traversal `path` is rejected by the same
> `resolveSafe` as everything else. Seven new cases in a `folder scope` describe
> (`files.service.spec.ts`): scoped hit set, root-relative emitted paths,
> no-scope whole-root walk, empty scope === no scope, `../..` rejected, caps
> honoured inside a scope, content grep scoped.
>
> The UI is a box right-aligned in the breadcrumb row (the Breadcrumb grew a
> `right` slot and its segments now shrink and truncate, so a deep path can
> never squeeze the box out), and a results view that **replaces** the listing
> as a *sibling*, not a child. That placement is the whole trick: the listing
> pane is an `UploadDropzone` wrapping a div with `onClick={selection.clear}`,
> `onContextMenu={openBackgroundMenu}` and `onKeyDown={handleListKeyDown}` —
> nested inside it, ArrowDown would have walked an invisible selection through
> the hidden directory, right-click would have offered "New Folder" in the
> folder you left, and a dropped file would have uploaded to the wrong place.
>
> Three decisions the brief did not have and the code demanded. **Two speeds
> stayed, the fetch dialect did not**: the debounce-plus-content-latch split is
> as specced, but the hand-rolled fetch + request-id guard the brief asked for
> was replaced by a keyed `useSearchQuery` — the app's one data-fetching
> pattern, where the key *is* the out-of-order guard (`usePreviewContentQuery`
> says so in its own docblock), with `keepPreviousData` so typing does not
> strobe the pane. **Ctrl+F is not the Ctrl+H pattern**: Ctrl+H's app-root
> `onKeyDown` is dead until something inside the window has focus and bails on
> INPUT, so binding Ctrl+F that way would have been dead in the very box it
> focuses and handed the key to Chrome's find bar; it uses
> `useTopWindowKeydown(..., { ignoreTextEntry: false })`, which is real window
> scope, and yields only to an in-progress rename. **The status bar and the
> preview pane were lying**: with three hits on screen the bar still read "47
> items", and a selected hit is not in `orderedEntries`, so the pane the user
> opened to look at what they found went blank. The bar now counts results, and
> the pane resolves the hit through its own parent listing (same query key as
> the current directory when nothing is selected — no extra request) rather
> than a synthesized `size: 0, modifiedAt: ''`, which would have rendered
> "0 B · Modified Invalid Date".
>
> One toolchain finding worth keeping: React Compiler refuses to compile a
> component that passes a value derived from a **module-level constant**
> (`rootCfg.label`, from `FS_ROOTS`) into an imported function during render —
> it must assume the call could mutate the global, and bails on the whole
> component's memoization. `scopeLabel(rootCfg.label, path)` in FileManager's
> body silently cost the file its compilation; the same call inside a child that
> receives `rootLabel` as a *prop* is fine. Scope formatting therefore lives in
> `SearchBox`, `SearchResults` and a small `SearchStatus`, all reading the one
> `lib/searchPresentation.ts` (4 pure helpers, 11 tests) so the header, the row
> subtitles, the placeholder and the status bar cannot drift.
>
> Verified: turbo 120/120, backend 443 unit + 141 e2e, and a 27-check browser
> probe on the production bundle against the real backend — scoped hits only,
> "Results in /docs", Enter opening Markdown Editor through the association
> registry, Esc restoring the docs listing byte-for-byte, breadcrumb navigation
> clearing the query, content mode waiting for Enter and then finding by
> content (and dropping the answer when the box is edited), Ctrl+F focusing
> from the listing *and* from inside the box, the palette unchanged, console
> clean; plus a second run with `FILES_SEARCH_MAX_RESULTS=2` showing the
> truncation banner ("Stopped early — first 2 shown…") in both the pane and the
> status bar — the flag the palette drops on the floor.

Status: **done** · From the 2026-08-07 research sweep. EASY ·
`file-manager` + one additive backend change (an optional `path` scope param
on `GET /api/files/search`). The endpoint shipped in brief 45 and has exactly
one consumer, the palette (`core/shared/commands/filesSource.ts:49-51`) —
the wiki's "capabilities with one consumer" thesis applied. Shares the new
`path` param with brief 113 (find-in-files): whichever lands first adds it,
not both — the brief-81/63 `csv` precedent.

## Problem

The file manager has zero search UI (grep over
`apps/add-ons/file-manager/src` — no hits). The backend grep is live and
already everything a search box needs: authed by the global SessionAuthGuard
(no `@Public()`), jailed through `resolveSafe`, bounded
(`files.service.ts:350-364` — 100 results / 20k dirents / depth 12 / 3s
budget / 256KB-per-file content cap), returning `{ items, truncated }`
(`files.service.ts:80-84`). Finding a file today means *knowing the global
palette exists* and does this — and the palette searches the whole home root
and then jumps you to the containing folder (`filesSource.ts:64-71`), which
is launcher behaviour, not in-context search.

One claim from the research sharpened against the code: **the endpoint
cannot scope to a folder today.** `SearchQueryDto` accepts only
root/query/content (`dto/files.dto.ts:37-51`) and the walk always starts at
the jail root (`files.service.ts:385`). "Scoped to here" needs an additive
optional `path`.

## Proposed decisions (ungrilled)

- **Scope to the current folder, always.** A search box inside a window
  sitting at `~/projects/x` means "find it *here*". Whole-root search stays
  the palette's job; no "search everywhere" toggle. Rejected: duplicating
  the palette inside the app.
- **Additive `path` param, jailed the same way.** The service resolves the
  start dir via `resolveSafe(root, path)` and keeps emitting rootDir-relative
  paths (`relative(rootDir, abs)`, `files.service.ts:449`), so every existing
  consumer — the palette included — sees the exact response shape it sees
  today. Rejected: client-side filtering of whole-root results — with a
  100-result cap the folder you are in may not appear at all; dishonest.
- **The box lives right-aligned in the Breadcrumb row**
  (`components/Breadcrumb.tsx` renders a bar with dead right space) — the
  Explorer position the Win7 identity invokes. Rejected: the toolbar (full)
  and a dialog (loses the pane you are searching).
- **Results replace the list pane while the query is non-empty**, under a
  header naming the scope ("Results in /projects/x") and an honest banner
  when `truncated` ("Stopped early — first N shown; narrow the search").
  The palette silently drops `truncated` today; this UI must not. Rejected:
  a dropdown popover — cannot host 100 rows or the open verbs.
- **Name matches search live (debounced ~300ms, stale responses dropped);
  content mode runs on Enter only.** The content grep is a real bounded FS
  walk reading up to 256KB per file — firing it per keystroke turns typing
  into self-DoS of the container (lightweight invariant). Name-only live
  matches the palette's feel. Rejected: live content grep; rejected:
  Enter-only for names (reads as dead beside the palette).
- **Results show name + containing folder, no content snippet in v1.**
  `SearchHit` is `{ name, path, type }` (`files.service.ts:39-44`) — the
  route cannot return highlights, and the per-match line/snippet extension
  is brief 113's backend change. Don't promise what the shape can't carry.
- **Enter/double-click opens through `handleOpen`** with a synthesized
  `FsEntry` (the `handleNewFile` precedent, `FileManager.tsx:297`), so files
  route through the brief-81 association registry and a directory hit
  navigates this window. Esc clears back to the listing. Ctrl+F focuses the
  box, bound on the app root exactly like Ctrl+H (`FileManager.tsx:541-548`)
  and documented in core `App.tsx`'s block (the `files.toggle-hidden`
  precedent, `App.tsx:73-82`). Brief 111 claims no Ctrl+F — no collision.

## Fix

1. Backend: `path?: string` (`@IsOptional() @IsString()`) on
   `SearchQueryDto`; `FilesService.search` gains `opts.path`, start dir =
   `resolveSafe(root, opts.path ?? '')`. Extend the existing
   `search (jailed + bounded)` describe in `files.service.spec.ts:273` —
   scoped hit set, traversal `path` rejected, emitted paths still
   root-relative.
2. `file-manager/src/hooks/useFileSearch.ts`: debounced fetch through the
   handle's http, out-of-order-response guard, `{ items, truncated,
   searching }` state.
3. `components/SearchBox.tsx` rendered in the Breadcrumb row; query +
   content-mode ("search inside files") state lifted to `FileManager.tsx`.
4. `components/SearchResults.tsx`: ≤100 plain rows (the server cap — no
   virtualizer needed), icon + name + parent path, ArrowUp/Down + Enter,
   double-click, scope header, truncation banner, content-mode "Searching…"
   state.
5. Clearing: Esc or the box's X; any navigation (breadcrumb, tree, opening a
   directory hit) clears the query and restores the listing.
6. Ctrl+F focus in `handleAppKeyDown` + the documented row in core
   `App.tsx`.

## Must preserve (regression surface)

- The palette Files source untouched and its responses byte-identical (the
  param is additive; omitting it keeps today's whole-root walk).
- Every bound still binds with a `path` scope: result/entry/depth/time caps,
  symlinks never followed, `node_modules`/`.git`/dot-dirs skipped
  (`files.service.ts:426-433`).
- The listing pane with an empty query — selection, keyboard nav, context
  menu, upload dropzone — byte-for-byte underneath.
- Auth invariant: the route keeps the global guard; no `@Public()` anywhere.
- No new dependency; `system.ts` untouched; no new store (search state is
  ephemeral window state, not config — nothing for DOTFILE_KEYS).

## Verify bar

`turbo typecheck`, lint + format, `turbo test`, `turbo build` green.
Backend: the extended `files.service.spec.ts` cases above must be named in
the outcome.

**Verified in a browser** (production bundle + real backend): create
`~/docs/report-a.md` and `~/report-b.md`; navigate into `docs`, type
"report" → only `report-a.md` appears under a "Results in /docs" header;
Enter opens it in Markdown Editor (association registry, not a hardcode);
content mode + "needle" finds the file containing it only after Enter, with
a searching state in between; a folder with >100 matches (or
`FILES_SEARCH_MAX_RESULTS` dialed down via env) shows the truncation
banner; Esc restores the listing exactly as it was; the palette's file
search still behaves as before. Console clean (§14).

## Out of scope

Content snippets and line numbers (brief 113 owns the response extension),
cross-root or whole-jail search from this box, fuzzy matching, saved
searches or type/date filters, replacing the palette source, and search in
the Trash dialog.
