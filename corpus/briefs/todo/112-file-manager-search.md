# Brief 112 — File Manager search: the box the endpoint has been waiting for

Status: **todo (ungrilled)** · From the 2026-08-07 research sweep. EASY ·
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
