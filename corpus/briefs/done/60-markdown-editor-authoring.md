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

---

## Outcome — 2026-08-05

Done, all six problems closed. **This is the first brief in this run whose problem
list was accurate** — five apps in a row had briefs that misdescribed their own
code. What this one got wrong was smaller and in one direction: it treated images
as a missing *input*, when the *output* path was broken too.

### Relative image links had never rendered at all

The brief's fifth problem is "no image support into the real FS" — meaning you
cannot paste one in. True, and the more embarrassing half is that a document which
*already* had images did not show them: `![](docs/shot.png)` was handed to the
browser as-is, so it asked the **web origin** for `docs/shot.png` and drew a broken
image. In an OS whose selling point is that the files are real, the markdown app
could not see them.

`img` now resolves a relative or root-relative `src` against the document's
directory and the document's FS root, and fetches it through the authed download
endpoint. Measured in the shipped bundle: `naturalWidth === 1200` for a seeded PNG,
i.e. the bytes really arrived under the real CSP, not just that an `<img>` exists.

Two neighbouring findings came out of the same work:

- **Remote images are refused by the CSP** (`img-src 'self' data: blob:`), so a
  README with badges showed broken-image icons and no reason. They now render as a
  labelled chip that says the policy blocked it, with the URL still reachable in a
  new tab.
- **Inline `data:` images rendered as nothing at all** — react-markdown's own
  `defaultUrlTransform` strips the scheme. `data:image/*` is now permitted on an
  image `src` and nowhere else; `data:text/html` in an `href` stays stripped, and a
  test pins both halves.

### Links in the preview navigated the whole desktop away

Not in the brief. An `<a href>` inside the preview is a live link in the
single-page app that hosts the entire OS, so clicking one in a document replaced
the desktop — unsaved buffer included. External links now open in a new tab with
`noopener` (this page holds an authenticated session), in-document `#anchors`
scroll the preview's own container, and relative links are intercepted: `.md`
opens in a new Markdown Editor window, anything else explains itself. Headings also
get `id` slugs now, so a document's own table of contents works.

### Anchors on every block, not just headings

The brief proposed "scroll sync by heading anchors". Implemented on **every** block
element (`data-src-line` from the mdast position), because a document with no
headings — a checklist, a changelog, a wall of prose — would otherwise get no sync
at all, and between two distant headings the interpolation is only as good as its
endpoints.

The half the brief does not mention is the editor side: a textarea exposes
`scrollTop` and nothing else, and `line * lineHeight` is wrong the moment a line
wraps, which in prose is every line. Line tops are therefore **measured** with a
mirror element (`useLineTops`), the technique caret-position libraries use, and
capped at 4000 lines rather than paid for on a huge file.

Measured on a ~2800px document containing one full-width image: anchored sync put
the target heading **0px** from the top of the passive pane, and a proportional
`scrollTop/scrollHeight` sync would have been **140px** out — a fifth of the
viewport, enough that the heading being edited is not the heading shown. On pure
prose the two agree closely, which is exactly how this gets shipped broken.

### The undo stack, and why the toolbar does not use React state

The obvious implementation — compute the new text, `setText` — **destroys the
textarea's undo history**, because assigning `value` clears it. One Bold click would
cost the user every undo step they had accumulated. Edits are therefore applied as
a selection plus `execCommand('insertText')` over the minimal changed span
(`minimalEdit`, tested), which keeps them inside the browser's own undo stack;
`setText` remains the fallback if the command is unavailable.

Measured: after a toolbar edit, Ctrl+Z reverses it and **keeps going** into the
typing that preceded it.

### Ctrl+K opened the command palette on top of the link

Found in the browser, not in review. The shell binds `mod+K` globally to the
command palette on `window`, so Ctrl+K in the editor inserted a link *and* opened
the palette over it. Fixed with `stopPropagation` (React attaches at the root
container, so the window listener never sees it) — a deliberate shadowing, and it
is now a documented row in the shortcut registry with the same
"only while X has focus" note File Manager's `mod+H` carries.

The keymap is bound on the textarea's own `keydown` rather than the brief's
"scoped to the top window": focus scoping is strictly tighter — two visible editors
cannot fight — and an unbound combination keeps its normal browser meaning.
Headings are on `mod+shift+1..3`, not `mod+1..3`, because `Ctrl+1..9` is a reserved
browser accelerator a page handler cannot cancel; shifted digits are matched on
`event.code`, since `Ctrl+Shift+8` arrives as `key: '*'`.

### Syntax highlighting: adopted, with the numbers

The brief said "adopt only if cheap … flag the measured size either way". Measured
against the production build:

| chunk | raw | gzip |
| --- | --- | --- |
| `MarkdownEditor` before | 30.41 kB | 10.82 kB |
| `MarkdownEditor` after (the loader) | 31.08 kB | 11.09 kB |
| `highlight` (lazy, 16 grammars) | 167.79 kB | 53.68 kB |
| `highlight.css` | 0.98 kB | 0.32 kB |

The highlighter is dynamically imported the first time a document turns out to
contain a fence, so a document without code costs 0.26 kB gzipped and no grammars.
Also measured: **dropping eight of the sixteen grammars saved 0.19 kB gzipped** —
essentially all the weight is highlight.js's engine, so a shorter list buys nothing
and extending it later is nearly free. Switching to lowlight's `common` (37) would
not be.

The theme is hand-written against the OS tokens rather than an imported
highlight.js stylesheet: a shipped theme hardcodes its own palette and looks wrong
in half the desktop's themes, and the locked identity is B&W plus one accent, so
structure carries the meaning — comments recede, declarations are bold, literals
take the accent.

### Smaller things

- **Task checkboxes are clickable.** remark-gfm renders them `disabled`, which is
  right for a static preview and useless in an editor; ticking a box is the single
  most common edit anyone makes to a checklist. The click edits that source line
  (`toggleTaskAtLine`), and does nothing when the line is not a task item rather
  than guessing.
- **The brief's "prompt to save first" guard is unreachable** and was not written.
  The app can only ever open a file that already exists — there is no
  new-document path — so the directory to write an image into always exists.
- **`usePaneResize` could not be reused.** The brief calls it "a proven pattern" in
  the file-manager package; add-ons may only import core (enforced by eslint), so
  the divider is 25 lines of its own, with keyboard support the original lacks
  (`role="separator"`, arrows, Home to centre). A candidate for core if a third
  app wants it.
- **`md-preview` was a dead class** — no CSS anywhere in the repo. It is now
  load-bearing: the anchor-scroll lookup and the highlight CSS both scope to it.
- The XSS property is unchanged and now tested three ways (`<script>`, an
  `onerror` attribute, an `iframe`, plus a `javascript:` URL) via
  `react-dom/server` in the existing node test environment — no jsdom, no
  testing-library, no new dev dependency for the one property in this app that is a
  security property rather than a feature.

### Verified in a browser, against the production bundle on the real backend

```
PASS raw HTML stays inert text in the rendered preview
PASS bold wrapped the selection and kept the same word selected
PASS pressing bold again removed the markers instead of stacking them
PASS Ctrl+Z undid the toolbar edit
PASS undo kept going past the toolbar edit into earlier typing — the undo stack survived
PASS Ctrl+K left the placeholder URL selected to type over
PASS ticking a checkbox in the preview rewrote that source line
PASS the outline lists every heading, in source order
PASS no hash inside the js fence leaked into the outline
PASS clicking the outline scrolled the editor and put the caret on that heading
PASS the preview jumped to the same heading (0px from the top)
PASS fenced code is highlighted, and the tokens are visibly distinct
PASS dragging the divider resized the editor pane
PASS the dragged ratio was written to storage and survives a reload (24%)
PASS the relative image resolved against the filesystem and actually loaded (1200px wide)
PASS the remote image says why it is not shown instead of drawing a broken icon
PASS both pasted images were written into the existing assets/ directory, the second
     without overwriting the first
PASS the document directory was not littered — the existing assets/ folder was reused
PASS every image in the document renders from the real filesystem
PASS the preview followed the editor to the same heading (0px off)
MEASURED a proportional sync would have put the preview 140px away from the anchored answer
PASS scrolling the preview moved the editor to the same heading (1px off)
PASS with sync off the panes scroll independently
PASS Ctrl+S wrote the document, image links and all, to disk
PASS editor-only / preview-only / split layouts are each correct
PASS the formatting toolbar is gone in preview-only, where it would act on a hidden textarea
PASS the sync toggle and divider only exist in split view
PASS the view-mode tooltip opens, and the toolbar tooltip names the shortcut
PASS the view mode is remembered
page errors: none
```

Tests: frontend vitest **389 → 492** (103 new in this package, which had none),
backend unchanged at 208 unit + 46 e2e. `turbo typecheck lint test format:check build`
green across 94 tasks.

Out of scope and untouched, as the brief asked: WYSIWYG, Mermaid, export to
HTML/PDF, footnotes, front-matter editing, multi-document tabs, and `rehype-raw`.

Deferred, recorded here rather than done:

- A pasted image is inserted at the caret with no block padding, so pasting two in a
  row puts them on one line. That is what the caret means and what every editor
  does; if it turns out to read badly, `insertBlock` already exists.
- Relative links to non-markdown files explain themselves instead of opening.
  Routing them needs the extension→app table that lives in file-manager; **brief 81**
  is where that becomes a core concern.
- `usePaneResize` now exists twice (file-manager and here). Promote to core on the
  third copy.
