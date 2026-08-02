# Brief 90 — Office: medium-level Word / Excel / PowerPoint parity

Status: **todo (user-requested 2026-08-02)** · HARD · add-ons `docs`, `sheets`,
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
