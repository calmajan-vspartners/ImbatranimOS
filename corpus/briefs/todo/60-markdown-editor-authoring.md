# Brief 60 — Markdown Editor: make it an authoring tool, not a preview pane

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
EASY/MEDIUM · add-on `apps/add-ons/markdown-editor` (249 LOC). Depends on brief
54 for Open/New.

## Problem

The app is correct and small: react-markdown + remark-gfm, three view modes
(editor / split / preview, `MarkdownEditor.tsx:32,109-110`), the full save spine,
and deliberately **no `rehype-raw`**, which is what keeps it XSS-safe against a
markdown file you did not write. All of that should stay exactly as it is.

What is missing is everything between "renders markdown" and "you would write in
it":

1. **No formatting affordances.** No toolbar, no shortcuts — no Ctrl+B/I/K, no
   list or heading helpers, no table insert. Every markdown editor has these
   because typing `**` around a selection by hand is the thing you do a hundred
   times an hour.
2. **No scroll sync.** Editor and preview scroll independently in split mode, so
   past one screenful the preview shows a different part of the document than
   the one being edited. This is the single most-felt omission in a split view.
3. **The split is fixed.** `mode` toggles between three layouts; the divider
   cannot be dragged, so the ratio cannot be tuned. `usePaneResize` already
   exists in the file-manager package as a proven pattern.
4. **No outline.** For anything longer than a screen there is no heading
   navigation.
5. **No image support into the real FS.** Pasting or dropping an image cannot
   write it next to the document and insert a relative link — the obvious
   "this is a real OS with a real filesystem" move, and the one thing a
   browser-based editor can do better than a web app.
6. **No code highlighting in the preview**, so fenced blocks render flat.

## Proposed decisions (ungrilled)

- **Toolbar + shortcuts over a WYSIWYG.** Keep the source-of-truth as plain
  text; add selection-aware helpers (bold, italic, link, inline code, H1-H3,
  bullet/numbered list, quote, table skeleton, task list). Toggling — applying
  a marker twice removes it — matters more than the button count.
- **Scroll sync by heading anchors, not line ratio.** Proportional scroll
  desynchronises badly around images and tables. Map source headings to rendered
  headings and interpolate; sync the pane the user is not actively scrolling.
- **Draggable split divider**, reusing the `usePaneResize` approach, persisted.
- **Outline as a collapsible left rail** in the editor pane, built from the
  heading tokens.
- **Image paste/drop writes into the document's own directory** (or a sibling
  `assets/` if that already exists), via the authed upload path, then inserts a
  relative link. Only when the document has been saved somewhere — otherwise
  prompt to save first, because there is no directory to write into yet.
- **Rejected — `rehype-raw` / raw HTML in preview.** It is the app's security
  property. A markdown file is untrusted input; enabling raw HTML makes opening
  someone's README an XSS. Do not revisit without a sanitizer decision.
- **Rejected — Mermaid diagrams.** A large dependency for a rarely-used feature,
  against "lightweight is identity". Revisit only if asked for directly.
- **Deferred — export to HTML/PDF.** Print-to-PDF is better solved once as a
  platform capability than per app.
- **Syntax highlighting in preview: adopt only if cheap.** Prefer a
  highlighting approach that ships a small core with lazily-loaded languages; if
  the smallest honest option is still heavy, skip it and keep fenced blocks
  monospaced. Flag the measured size in the outcome either way.

## Fix

1. `Toolbar.tsx` with selection-aware `applyMarker` helpers operating on the
   textarea value/selection (pure functions, unit-testable), plus a keymap
   scoped to the top window (`ui-conventions.md` §28) so two open editors do not
   fight.
2. `useScrollSync(editorRef, previewRef, headings)` — build the heading map when
   the parsed tree changes; drive the passive pane; disable in single-pane modes.
3. Draggable divider + persisted ratio.
4. `Outline.tsx` from the heading list, click to scroll both panes.
5. Image paste/drop handler → upload → insert relative link; guard on unsaved
   documents.

## Must preserve (regression surface)

- **No raw HTML rendering** — a document containing `<script>` or
  `<img onerror>` must still render inert. Keep a test that asserts this.
- remark-gfm behaviour: tables, strikethrough, task lists, autolinks.
- The save spine and the `.md`/`.markdown` reroute from Notepad on any root.
- All three view modes still work, and the toolbar is not rendered in
  preview-only mode where it would do nothing.
- The `<Tooltip>` usages at `:116,131` keep working after the 2026-07-31 core
  Tooltip fix.

## Verify bar

`turbo typecheck`, add-on lint + format green, `turbo build` ok. Unit tests for
every marker helper (apply, toggle off, empty selection, multi-line selection)
and an XSS test asserting raw HTML stays inert.

**Verified in a browser**: write a document using only the toolbar; scroll in
split mode and confirm the panes track; drag the divider and reload; jump via
the outline; paste an image and confirm the file lands next to the document and
the link resolves in preview.

## Out of scope

WYSIWYG editing, Mermaid, export to HTML/PDF, footnotes/citations, front-matter
editing, and multi-document tabs.
