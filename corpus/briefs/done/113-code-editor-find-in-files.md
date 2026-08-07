# Brief 113 — Code Editor: find in files, Ctrl+Shift+F over the bounded grep

> **Outcome (2026-08-07): DONE.** The brief-88 deferral, closed. `SearchHit`
> gained an optional `matches: { line, text }[]`, opt-in behind a new
> `matches=1` on top of `content=1`, so the palette and brief 112's box see a
> byte-identical response — one test asserts exactly that. `contentMatches`
> became `contentLines`, which returns `null` for "never looked" (unreadable,
> oversize, binary) and an array for "looked", empty when nothing matched: the
> old boolean conflated those two, and the caller needed them apart. Line
> extraction scans the buffer that was read anyway, capped at 5 lines per file
> and 200 chars each (both env-overridable), so the extra data costs two
> constants rather than file size. Eight new cases in a `match lines` describe:
> 1-based numbers, trimmed text, the per-file cap, the per-line char cap,
> case-insensitivity, binaries skipped, a name-only hit that carries no lines,
> and the untouched shape when not opted in.
>
> The editor got a bottom panel — not a dialog (it would end the
> search-edit-search loop) and not the left rail (brief 121's region). Search
> runs on Enter only, the same self-DoS argument as brief 112. Results group by
> file with line-numbered rows; a file matched only by NAME is kept and labelled
> "filename match" rather than discarded, because typing a filename and being
> told there are no results for a file you can see is a lie about the search.
> `truncated` renders a banner instead of being dropped. A monotonic run id
> drops out-of-order responses.
>
> The loader was hoisted, as specced: the effect body became `openTargets()`,
> and `openPath(root, path, { revealLine })` is the panel's only door — the same
> one the intent and the session restore use, so there is still exactly one way
> for a file to become a tab. Reveals queue in a `pendingRevealRef` applied in
> the activation effect **after** `restoreViewState` (the other order lets the
> restored scroll position silently undo the reveal), plus one case the brief
> did not have: re-clicking a hit for the tab that is *already active* changes
> no state, so the activation effect never re-runs and the queued reveal would
> sit there forever — that path applies it inline. An already-open dirty tab is
> focused, never re-read; the probe types an unsaved edit and proves it survives
> a second search-and-click.
>
> Ctrl+Shift+F is the `useSaveHotkey` pattern (window-level capture, gated on
> `system.window.isFocused()`), not `useTopWindowKeydown` — whose default
> ignores text entry, which is where focus always is in this app. Ctrl+F, Ctrl+G
> and Ctrl+S are untouched. The Edit menu's "Find in Files…" is deliberately
> enabled with no tab open: searching the project is how you find the file.
>
> Two things worth recording. Hoisting the loader made `openTargets` traceable
> to the React Compiler lint, which then flagged the effect for reaching
> setState synchronously — true on the everything-already-open path — so the
> effect hops a microtask explicitly, which is what the old inline async IIFE
> was doing implicitly. And Monaco 0.54 focuses a contenteditable
> `div.native-edit-context` (the EditContext API), not the historic hidden
> `<textarea>`; the panel's close path needs a rAF so the focus call lands
> after the unmount commit, or focus falls to `<body>`.
>
> Eager-chunk delta: none. `CodeEditor-*.js` is 20.31 kB (6.91 kB gzip) and the
> panel imports no Monaco types — the shared `index-*.js` is unchanged. Monaco
> stays lazy.
>
> Verified: turbo 120/120, backend 451 unit (+8) + 141 e2e, 9 new frontend unit
> tests for grouping and the request shape, and a 17-check browser probe on the
> production bundle: Ctrl+Shift+F opening and focusing, nothing running until
> Enter, both files grouped with line numbers, a click landing the cursor on
> line 3 of `b.ts`, an unsaved edit surviving a re-click, Esc closing and focus
> returning to Monaco, the ? overlay row, and the palette unchanged — plus a
> `FILES_SEARCH_MAX_RESULTS=2` run for the truncation banner. Console clean.

Status: **done** · From the 2026-08-07 research sweep. MEDIUM ·
`code-editor` + backend (additive per-match line data on
`GET /api/files/search`) + one documented-shortcut row in core `App.tsx`.
The brief-88 deferral, whose sequencing condition (the File menu) shipped in
88. Shares the endpoint with brief 112, which adds the `path` scope param —
if this builds first, add it here to 112's spec (one of them, not both).
Brief 121 (folder tree) later becomes the default-scope provider; no
dependency either way.

## Problem

Brief 88 deferred exactly this: "the bounded content grep already exists
(`/api/files/search?content=1`, brief 45); wiring it into the editor is a
second surface and should follow the File menu" (`done/88:40-42`), and its
outcome confirms "Not done: workspace find-in-files" (`:158`). The endpoint
is live (`files.controller.ts:75-78`); `code-editor/src` has zero references
to it (grep). The palette proves the endpoint but serves *launching*: its
activate reveals the containing folder in Files (`filesSource.ts:64-71`),
which is precisely wrong mid-edit. Search-across-the-project is the
most-used IDE feature after open/save for anyone using the OS as a dev box.

Two gaps verified in the code that the design must be honest about:

1. **Hits carry no line numbers or snippets.** `SearchHit` is
   `{ name, path, type }` (`files.service.ts:39-44`); `contentMatches`
   returns a bare boolean (`:469-486`). A grouped results panel has nothing
   to group *under* without extending the response.
2. **The editor has no "opened folder".** Tabs are individual
   `{ root, path }` files (`CodeEditor.tsx:35-43`); the explorer sidebar is
   brief 121. "Scoped to the opened folder" has nothing to bind to yet.

## Proposed decisions (ungrilled)

- **Extend the response; do not re-grep client-side.** When `content=1`,
  each file hit gains `matches: { line, text }[]`, capped (first 5 per
  file, `text` trimmed to ~200 chars). The bytes are already in memory in
  `contentMatches` (`buf` ≤ 256KB, `files.service.ts:477`) — line extraction
  is a scan over what was read anyway, not a second read. Additive:
  name-only searches, the palette, and brief 112's box see today's shape
  unchanged. Rejected: client-side open-and-scroll re-find — it cannot
  populate a per-match results panel without re-downloading every candidate
  file over HTTP, and the panel *is* the feature.
- **A collapsible bottom panel** (query input + grouped results) under the
  editor surface, Esc closes and returns focus to Monaco. The left rail is
  brief 121's region — two briefs inventing the same sidebar is churn — and
  Monaco owns the center. Rejected: a modal dialog (kills the
  search-edit-search loop); rejected: a left panel (121's region).
- **Scope: the whole `home` root by default, narrowed by an "in folder…"
  chip** via the existing `pickDirectory` (`CodeEditor.tsx:79`,
  `system.fs.pickDirectory`), remembered per window for the session — not a
  dotfile, so no DOTFILE_KEYS registration. When 121's Open Folder lands,
  that folder becomes the default scope. Uses 112's `path` param. Rejected:
  deriving scope from the active tab's directory (surprising — silently
  narrows when you switch tabs).
- **Click opens at the line through the one loader.** Hoist the loader body
  (the effect at `CodeEditor.tsx:213-267`) into a callable
  `openPath(root, path)` used by both the intent effect and the panel — the
  comment's contract ("no second way for a file to become a tab",
  `:200-212`) is the thing to keep, not the effect shape. A
  `pendingRevealRef` (`id → line`) is applied in the activation effect
  (`:165-198`) after `restoreViewState`: `revealLineInCenter` +
  `setPosition`. Already-open tabs are focused and revealed, never re-read
  (`:222-227` — the buffer may hold unsaved edits and may have drifted from
  disk; the reveal is best-effort at that line). Rejected: extending the
  postMessage intent payload with a line field — this is in-app navigation,
  not a protocol concern; `system.ts` stays untouched.
- **Truncation honesty**: `truncated: true` renders a banner saying the walk
  stopped early (the bounds: 100 results / 20k dirents / depth 12 / 3s —
  `searchBounds`, `files.service.ts:350-364`). Never a bare list that looks
  complete. Stale responses dropped (out-of-order guard).
- **Ctrl+Shift+F on the `useSaveHotkey` pattern** — a window capture
  listener gated on `system.window.isFocused()` with `preventDefault`
  (`packages/ui/src/hooks/systemHooks.ts:24-38`) — because focus usually
  sits in Monaco's textarea, where a text-entry-ignoring binding
  (`useTopWindowKeydown`'s default) goes dead. Documented in core
  `App.tsx`'s `useDocumentedShortcuts` block (the `editing.save` precedent,
  `App.tsx:43-49`), scope `Editing`, note "Only while a Code Editor window
  has focus". Rejected: `useRegisteredHotkeys` — global, would open a
  background editor's panel. The Edit menu gains "Find in Files…" beside
  Find…/Go to Line (`CodeEditor.tsx:560-573`), *enabled with no tab open* —
  searching needs no buffer.

> **Note (2026-08-07):** brief 112 landed the shared optional `path` scope on
> `GET /api/files/search` — the csv precedent settled in 112's favour. This brief
> must build `matches` on top of that exact `search(root, query, { content, path })`
> signature rather than adding the param itself.

## Fix

1. Backend `files.service.ts`: `contentMatches` grows into a variant
   returning capped `{ line, text }[]` (the boolean path stays for
   name-only); `SearchHit` gains optional `matches`; controller unchanged.
   Extend the `search (jailed + bounded)` describe
   (`files.service.spec.ts:273`): line numbers correct, per-file cap
   enforced, binary/oversize skips intact, response without `content=1`
   byte-identical to today.
2. `code-editor/src/lib/findInFiles.ts`: fetch via the handle's http,
   stale-response guard, group-by-file shaping. Vitest for grouping + guard.
3. `code-editor/src/components/SearchPanel.tsx`: input, scope chip
   (`pickDirectory`), grouped results with per-match "line: text" rows,
   truncation banner, loading state, Esc behaviour.
4. `CodeEditor.tsx`: hoist the loader into `openPath(root, path,
   { revealLine? })`; `pendingRevealRef` applied in the activation effect;
   panel open/closed state.
5. The Ctrl+Shift+F capture binding + the Edit-menu row + the documented row
   in core `App.tsx`.
6. Record the eager-chunk delta in the outcome (the brief-88 habit) —
   Monaco stays lazy; the panel must not deep-import Monaco types
   (`CodeEditor.tsx:27-30` pattern).

## Must preserve (regression surface)

- The one-loader contract: intent, Open dialog, session restore and the
  panel all become tabs through the same path.
- Already-open tabs are focused, never re-read — dirty buffers keep their
  unsaved edits and their dot.
- The palette Files source and brief 112's box see additive-only response
  changes; name-only searches are byte-identical.
- Search bounds, jail, symlink/skip rules untouched; the route keeps the
  global auth guard, no `@Public()`.
- Monaco lazily loaded; no new dependency; `system.ts` untouched.
- Ctrl+S, Ctrl+G, Ctrl+F (in-file find, `CodeEditor.tsx:512-515`) keep
  working; Ctrl+Shift+F must not shadow them.

## Verify bar

`turbo typecheck`, lint + format, `turbo test`, `turbo build` green.
Backend: the extended `files.service.spec.ts` cases named in the outcome.
Frontend vitest per Fix 2.

**Verified in a browser** (production bundle + real backend): seed
`~/proj/a.ts` and `~/proj/sub/b.ts` both containing `needle()`;
Ctrl+Shift+F, type "needle" → two file groups with line-numbered rows; click
the `b.ts` hit → a tab opens with the cursor on that line, centered; edit
`a.ts` without saving, search again, click its hit → the existing dirty tab
focuses (dot intact, edits intact), cursor moves; scope chip to `~/proj/sub`
→ only `b.ts` groups; `FILES_SEARCH_MAX_RESULTS` dialed down via env shows
the truncation banner; Esc closes the panel and focus lands back in Monaco;
the palette's file search is unchanged. Console clean (§14).

## Out of scope

Replace-in-files, regex/case-sensitivity toggles (the endpoint is a
case-insensitive substring match by design — `files.service.ts:387,439`),
the folder tree (brief 121), search history, streaming results, and
surfacing the new `matches` snippets in the file manager (a later pass may
reuse them; 112 ships without).
