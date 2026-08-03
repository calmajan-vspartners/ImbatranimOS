# Brief 63 — Sheets: what the bridge drops, and what happens when the worker fails

Status: **done 2026-08-03** · From the 2026-07-31 app+OS improvement sweep.
MEDIUM · add-on `apps/add-ons/sheets` (612 LOC; Univer grid + an ExcelJS bridge
in a lazy module worker). Standalone.

## Problem

**1. A failed save is silent.** Like Docs, `Sheets.tsx` catches open and save
failures into local state plus `console.error` (`:58-60`, `:89-93`), never
`notify()`. The save round-trip runs inside a worker that reports failures as
`{ id, error }` (`engine/xlsxWorker.ts:224-226`), so the bridge *does* reject
properly — and then the rejection dead-ends in a banner. Save a spreadsheet in a
background window, have the worker fail, and nothing tells you.

**2. Nobody knows what the bridge drops.** The ExcelJS write path is a
translation between Univer's model and a real `.xlsx`. Anything neither side
models is lost on save: charts, pivot tables, conditional formatting, data
validation, defined names, comments, images, macros. A shared-formula corruption
in exactly this bridge was already found and fixed in the 2026-07-17 review, so
the risk is demonstrated, not hypothetical. Today a user can open a colleague's
workbook, change one cell, save, and hand back a file that quietly lost a chart.
There is no inventory of what survives and no warning at open.

**3. The bottom row is clipped** at short viewports (walkthrough, 2026-07-19).
Brief 52 clamps the window; Sheets should also declare an honest `minSize`.

**4. No CSV.** `.csv` is not in the `openWith` map at all, so double-clicking one
does nothing (see brief 54's dead-end note). For a spreadsheet app that is the
most common interchange format there is.

## Proposed decisions (ungrilled)

- **`notify()` on every open/save failure**, sticky by level, with the inline
  banner retained for the in-view case.
- **Dirty stays dirty unless the write resolved.** Same audit as Docs: a worker
  rejection must not clear the dirty flag or disarm the close guard.
- **Inventory the round-trip and warn at open.** Build a fixture workbook
  exercising charts, conditional formatting, data validation, defined names,
  merged cells, frozen panes, number formats and comments; assert in tests what
  survives. Where a feature is known-lossy, **detect it at open and warn once**
  ("this workbook contains charts, which will not be preserved if you save").
  A user who is warned can decide; a user who is not, loses work silently.
- **Consider save-as-copy for lossy workbooks.** If the open-time scan finds
  unsupported content, default the save action to "Save a copy" rather than
  overwriting the original. Grill this: it protects data but adds friction.
- **CSV import/export.** Map `csv` → Sheets in `openWith`, read via the existing
  bridge, and offer CSV on save-as. Cheap, high value, and closes a dead-end.
- **Rejected — replacing the engine again.** SheetJS CE already failed the
  styling spike and the ExcelJS bridge was the user-approved answer (brief 20).
  Do not relitigate; make the current bridge honest instead.
- **Rejected — formula-engine parity with Excel.** Univer computes what it
  computes; chasing full function coverage is unbounded. Do assert that formulas
  are *preserved* on round-trip even when not recalculated.

## Fix

1. Route the `catch` blocks at `Sheets.tsx:58-60` and `:89-93` through
   `notify({ appId: 'sheets' })`; make the dirty-clear conditional on success.
2. Worker error propagation: confirm every rejection path reaches the UI with a
   usable message (the worker already sends `error`; check the bridge does not
   swallow it), including the case where the worker fails to spawn at all.
3. Fidelity test matrix against a fixture workbook; document the results in the
   brief's outcome and in a comment beside the bridge.
4. Open-time capability scan → one-shot warning; optional save-as-copy default.
5. CSV read/write + `openWith` mapping.
6. Honest `minSize`/`defaultSize` in the manifest (`ui-conventions.md` §20).

## Must preserve (regression surface)

- The whole ExcelJS round-trip stays **off the main thread** in the lazy module
  worker (brief 32); `Sheets.tsx` signatures unchanged; exceljs must not
  re-enter the main thread's module graph.
- The shared-formula fix from the 2026-07-17 review stays fixed — keep its
  regression fixture.
- The dirty-flag race fixed in the same pass stays fixed.
- Save writes through `uploadFileBytes` with `UploadTooLargeError` handled.
- Univer's grid behaviour, multiple sheets, and existing number formats.

## Verify bar

`turbo typecheck`, add-on lint + format green, `turbo build` ok. Tests: the
fidelity matrix; a rejected worker save leaves the document dirty and notifies;
formulas survive an open→save round-trip; CSV round-trips.

**Verified in a browser**: open a workbook with a chart and confirm the warning
appears; edit a cell, kill the backend, save, and confirm a sticky error plus a
still-dirty document; open a `.csv` by double-click from File Manager; check the
bottom row is reachable at 1280×577.

## Out of scope

Charts as an editable feature, pivot tables, macros, collaborative editing,
Excel formula parity, and engine replacement.

## Outcome — 2026-08-03 (done)

The brief asked "nobody knows what the bridge drops". Measuring it turned up two
bugs and one silent corruption, all of which mattered more than the inventory.

### Sheets could not open a workbook containing a chart. At all.

`ExcelJS.xlsx.load` reconciles drawings against their rels and reads
`drawing.anchors`, but its drawing transform only builds anchors for `<xdr:pic>`
(images) — a chart's `<xdr:graphicFrame>` leaves the model empty, so `anchors` is
`undefined` and it throws `TypeError: Cannot read properties of undefined
(reading 'anchors')`. Verified with **both** absolute (`/xl/charts/chart1.xml`)
and Excel-style relative (`../charts/chart1.xml`) rel targets, so it is not a
writer quirk: any `.xlsx` with a chart in it failed to open, and charts are one of
the most common things in a real workbook.

### Comments broke for anything not written by Excel

ExcelJS keys parsed comments by `../commentsN.xml` and only matches
`xl/commentsN.xml` at the package root. Excel's own layout loads; openpyxl's
(`xl/comments/comment1.xml`, absolute rel target) throws `reading 'comments'`. A
workbook out of a Python pipeline failed where the same workbook out of Excel
succeeded — the kind of asymmetry that gets reported as "your app is broken".

Both are fixed the same way, in the pass that already had to unzip: strip
`xl/drawings/`, `xl/charts/`, `xl/media/`, `xl/comments*` and
`xl/threadedComments/`, prune the rels that point at them, drop the sheet's
`<drawing>`/`<legacyDrawing>` elements and the dangling `[Content_Types]`
overrides, and hand ExcelJS a package it can read. The stripped copy lives only
in memory as ExcelJS's input; the saved file is built fresh by `serialize`, so
nothing here reaches disk. Byte-stable when nothing needed removing, the same
discipline as brief 62's docx normalizer. And stripping is not hiding: the
open-time warning still names charts and comments among the losses.

### A merged range was being multiplied, not dropped

Found by looking at a screenshot rather than a test. ExcelJS reports the
**master's value for every cell in a merged range**, so `A8:D8` came back as four
copies of "merged header" and a save wrote four copies into the file — data it
never contained. Losing the merge is acceptable and is warned about; inventing
three cells is not. Now only the master cell is read.

### The inventory the brief actually asked for

`xlsxScan.ts` reads the package rather than asking ExcelJS, because ExcelJS drops
most of the evidence during its own load — by the time there is a `Workbook`
there is no chart left to notice. It reports 13 features, split by whether losing
them costs *content* or only the *view*, because "your chart is gone" and
"re-freeze the header row" are not the same sentence and merging them makes the
first easy to skim past. Excel's own `_xlnm.*` bookkeeping names are excluded, so
turning on a filter does not produce a "named ranges" warning on every sheet.

**The matrix is a test, not a paragraph.** `fidelity.test.ts` runs a fixture
built with openpyxl — an independent writer, so it is not our own bug reflected
back — carrying charts, conditional formatting, data validation, defined names,
comments, merges, frozen panes, autofilter, hyperlinks, percent and currency
formats, styled headers, formulas and two sheets.

Survives: cell values, formulas (preserved, not recalculated by the bridge),
number formats including currency and percent, bold, italic, font colour, solid
fill, sheet names and order.

Lost: everything the scan reports. The test asserts *both* directions — every
feature present before is absent after — so the warning list is exactly the loss
list rather than an approximation of it, and a mapping that ever gains a feature
fails the test until the warning is updated with it.

### Everything else in the Fix list

- **`notify()` on open and save failures**, through brief 62's shared
  `reportFileFailure`, with the dirty flag deliberately untouched on failure.
- **A request timeout in the bridge** (120s). `onerror`/`onmessageerror` catch a
  worker that fails loudly, not one that is alive and silent — and brief 62's
  fflate hang is the standing lesson that an unsettled promise is a spinner
  forever with nothing to report.
- **The lossy warning is a standing banner, not only a toast.** The moment it
  matters is the moment the user reaches for Save, which can be an hour after a
  toast has gone. Dismissable.
- **CSV in and out**, no dependency, plus `csv → sheets` in `openWith` — it was
  not mapped at all, so double-clicking one did nothing. Three refusals to coerce
  are deliberate and tested: a leading zero stays text (`01234` is a postcode, and
  coercing it makes the save write `1234`), more than 15 significant digits stays
  text (a double cannot hold them, so the save would corrupt a long identifier),
  and a field starting with `=` stays a literal string rather than becoming a
  formula. Export writes the cached value, because CSV has no formulas.
- **Honest manifest sizes**: `defaultSize.height` 640 → 560 so it fits a 720px
  viewport with the taskbar, `minSize` 480×360 → 600×380.
- **Save-as-copy for lossy workbooks: not built.** The brief said to grill it. The
  warning is now permanent and in view at the moment of saving, which is the
  information the decision needs; defaulting to a copy would also mean inventing
  a Save As that Sheets does not otherwise have, and pushing a filename decision
  onto every user who opens a filtered spreadsheet. Revisit with brief 90's
  toolbar, where Save As earns its place anyway.

**Verified in the shipped production build**: `charts.xlsx` (the fidelity
fixture) opens with all cells, formulas recalculated by Univer (250/205/380),
`12.34%` and `$1,234.50` formatted, blue bold headers, both sheet tabs, and a
banner reading "This workbook contains charts, conditional formatting, data
validation, comments, named ranges, merged cells and hyperlinks, which Sheets
cannot save…" plus the matching sticky notification. `import.csv` double-clicked
from File Manager routes to Sheets and parses. No CSP refusals, no page errors.

Tests 317 → 360.
