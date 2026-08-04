# Brief 90 — Office: medium-level Word / Excel / PowerPoint parity

Status: **done 2026-08-03** · HARD · add-ons `docs`, `sheets`,
`slides`. **Sequenced after briefs 62–64** (save-safety), which stay separate:
there is no point adding features to a pipeline that can still lose a file.

## Problem

The user asked for compatibility with Word, Excel and PowerPoint, with those
programs' capabilities implemented "at a medium level". Today:

- **Docs** (SuperDoc) opens and saves `.docx` but exposes almost no editing
  surface — no find/replace, no styles UI, no tables, no print.
- **Sheets** (Univer + an ExcelJS bridge) has a grid, but nobody knows what the
  bridge drops on write (brief 63), and there is no CSV.
- **Slides** (pptx-preview) is **viewer-only and cannot edit at all** — the
  engine provides no editing model.

"Medium level" has to be defined against what each engine can actually do,
otherwise this becomes an unbounded rewrite.

## Decisions — what "medium" means here, per app

- **Docs — real editing, medium formatting.** Bold/italic/underline, headings and
  paragraph styles, lists, alignment, tables (insert/delete row-column), find &
  replace, undo/redo, word count, and print/export to PDF via the browser. Not:
  track changes, comments, mail merge, macros.
- **Sheets — real spreadsheet basics.** Formula editing with the function set
  Univer already ships, cell formatting (number/date/currency/percent), borders
  and fills, multiple sheets, freeze panes, sort and filter, CSV import/export,
  and find. Not: pivot tables, macros, or chart *authoring* — charts must at
  least survive a round-trip (brief 63) before anyone edits them.
- **Slides — stays a viewer, gains presentation.** This is the honest call and it
  is the one to argue about: pptx-preview has no editing model, so "medium
  PowerPoint editing" would mean adopting a second engine and owning write
  fidelity for a third format. Brief 64 already decided viewer + thumbnails +
  presenter mode. **Recommendation: keep that**, and revisit editing only if the
  user says slide authoring specifically matters.
- **Fidelity is the constraint, not the feature list.** Every feature added must
  survive `open → edit → save → reopen` in the *real* Office format. A feature
  that renders but does not round-trip is worse than an absent one, because it
  silently damages the user's file. Each item below ships with a round-trip
  fixture.
- **Rejected — building an office suite from scratch, or swapping engines
  again.** SheetJS CE already failed a styling spike and the ExcelJS bridge was
  the approved answer (brief 20). Work inside the chosen engines.
- **Rejected — real-time collaboration.** Single-user OS.

## Fix (sequenced; each stage independently shippable)

1. **Gate on 62–64.** Save-failure visibility and the fidelity matrix land first.
2. **Docs**: toolbar (styles, marks, lists, alignment), find & replace, tables,
   word count, print-to-PDF. Round-trip fixture per feature.
3. **Sheets**: number/date/currency formats, borders/fills, freeze panes,
   sort/filter, multi-sheet management, CSV in/out, find. Round-trip fixture per
   feature, extending brief 63's matrix.
4. **Slides**: brief 64's viewer depth. Re-open the editing question only on an
   explicit user call.

## Must preserve (regression surface)

- The brief-20 docx normalizer fix (silent original-bytes save) stays fixed.
- The shared-formula fix in the xlsx bridge stays fixed.
- Every engine stays a lazy chunk; the eager bundle does not grow.
- The ExcelJS round-trip stays off the main thread in its worker (brief 32).
- AGPL obligations around SuperDoc are unchanged.

## Verify bar

`turbo typecheck`, lint + format green, `turbo build` ok. **A round-trip fixture
test per feature added** — open a real Office file, apply the feature, save,
reopen, and assert both the change *and* that unrelated content survived.

**Verified in a browser**: edit a real `.docx` in Docs and reopen it in the same
app with formatting intact; apply number formats and a filter in Sheets, save,
reopen; confirm a workbook containing a chart still warns before saving.

## Out of scope

Track changes, comments, macros/VBA, pivot tables, chart authoring, mail merge,
collaboration, `.doc`/`.odt`/`.rtf` conversion, and PowerPoint editing unless
explicitly requested.

## Outcome — 2026-08-03 (done)

**The brief's premise was wrong about where the gap was, and finding that out is
most of what this brief produced.** It said Docs "exposes almost no editing
surface — no find/replace, no styles UI, no tables". That was measured against
the app's *own* toolbar. SuperDoc mounts its own, and it has **31 controls**:
undo/redo, accept/reject tracked changes, zoom, font family, font size, bold,
italic, underline, strikethrough, colour, highlight, image, **table + table
actions**, text align, bullet and numbered lists with options, indents, line
height, **linked styles** (paragraph styles), copy/clear formatting, and document
mode.

So almost the whole Docs feature list was already shipped. Building a second
toolbar would have duplicated it worse.

### Where the real gap was: Sheets, and it was silent data loss

Univer ships a full ribbon too — font, size, bold/italic/underline/strike,
colour, fill, **borders**, alignment, wrap, number formats, merge, freeze. And
**this bridge carried none of the new ones.** Univer's `IStyleData` has `ul`,
`st`, `ff`, `fs`, `ht`, `vt`, `tb` and `bd`; the mapping handled only `bl`, `it`,
`cl`, `bg` and `n`. A user could underline a heading, set 18pt Georgia, centre a
column, wrap a cell or draw a border, save, reopen — and every one of those was
gone, with no warning, because the open-time scan (brief 63) only reports what the
*package* holds, not what the *ribbon* can produce.

That is the same class as every other bug in this sweep, and it was reachable from
the toolbar the app already had. Fixed by mapping all eight in **both**
directions: underline, strikethrough, font family, font size, horizontal and
vertical alignment, wrap, and per-edge borders with their styles and colours.

Details that took the time rather than the typing:

- **ExcelJS reports vertical centre as `middle`, not `center`** (xlsx writes
  `center`). Verified against a real file rather than assumed.
- **Borders are per-edge with independent styles.** A cell with a double bottom
  and a dashed left has to come back with both, not one flattened value — there is
  a test that would fail on a mapping that collapses them.
- **Excel's border style vocabulary is wider than Univer's**, so `dashDot`,
  `mediumDashDot` and friends map to their nearest neighbour rather than being
  dropped. Losing the exact dash pattern is visible; losing the border is worse.
- **Univer requires a colour on a border**; Excel's default is black, so that is
  what an uncoloured edge becomes.
- **Wrap and shrink-to-fit are separate in Excel and one strategy in Univer**, so
  wrap wins where both are set. `OVERFLOW` and `CLIP` both mean "do not wrap" in
  xlsx, so only `WRAP` is written back.
- **No style is invented on a plain cell.** Writing an empty font/alignment/border
  everywhere would bloat the file and mark unformatted cells as formatted in
  Excel. There is a test for that too.
- The Univer enum values are numeric literals with the tests pinning them, rather
  than an `@univerjs/core` import — this module is loaded by the worker *and* by
  the test, and importing the engine for six constants would drag it into both.

**A combined-attributes test exists on purpose.** An implementation that assigns
`cell.font` twice, or replaces `cell.alignment` while setting borders, passes
every single-attribute test and loses half of a cell that has everything. So one
cell in the fixture carries bold + italic + underline + strike + Courier New 14 +
green + a fill + centre/middle + wrap + a four-sided medium border + a number
format, and the test asserts all of it.

### Docs: the two things genuinely missing

- **Find** — `Ctrl+F`, a match counter, next/previous with wrapping, Escape to
  close. Built on SuperDoc's own `search()`/`goToSearchResult()`, with the user's
  text **regex-escaped**: unescaped, a search for `a.b` matches `axb`, and a bare
  `(` throws a `SyntaxError` in the middle of typing.
- **Word count** — words, characters and characters-without-spaces, computed from
  the editor's rendered text so the number matches the page. Block tags become
  newlines first, or `end</p><p>Begin` counts as one word. Counts by code point,
  not UTF-16 unit, so an emoji is one character. 16 tests covering hyphenated and
  apostrophised words, punctuation-only runs, CJK and Cyrillic.

**Replace is not built, and will not be until there is an API for it.**
SuperDoc exposes `search` but no replace command — `replaceAll` in its types is a
label for its own search UI, not a document operation. Doing it anyway would mean
driving ProseMirror transactions against the docx model directly and owning mark
and tracked-change correctness by hand, which is exactly the silent-corruption
surface briefs 62 and 63 exist to contain. Recorded as blocked on the engine.

### What was already decided, and stands

- **Slides stays a viewer**, per brief 64. Nothing further here.
- **CSV, freeze panes, sort/filter, multi-sheet** — Univer's ribbon and Data tab
  own these already, and CSV shipped in brief 63.
- **Print/export to PDF** stays deferred to its own brief; three apps want it and
  solving it once is the point.

### Verified in the shipped production build

Sheets: 51 tests, including nine new ones asserting each style survives
parse→serialize→parse against an openpyxl-built fixture. Docs, in a browser:
word count reads **19 words** on open for the fixture (it read "0 words" until
the count moved into `onReady` — `getHTML()` has nothing to give when the engine
object is merely constructed); `Ctrl+F` opens the bar; "Revenue" → `1 of 1`,
"EMEA" → `1 of 1`, nonsense → "No matches"; `a.b` → "No matches" rather than
matching `axb`; a bare `(` does not throw; Next steps `1 of 13` → `2 of 13`; the
bar reads `19 words · 101 characters`. No page errors.

Tests 384 → 406.
