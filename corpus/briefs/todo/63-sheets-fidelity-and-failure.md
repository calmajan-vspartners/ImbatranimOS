# Brief 63 — Sheets: what the bridge drops, and what happens when the worker fails

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
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
