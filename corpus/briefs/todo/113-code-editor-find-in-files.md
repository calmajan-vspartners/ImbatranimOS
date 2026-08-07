# Brief 113 — Code Editor: find in files, Ctrl+Shift+F over the bounded grep

Status: **todo (ungrilled)** · From the 2026-08-07 research sweep. MEDIUM ·
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
