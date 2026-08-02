# Brief 66 — norPDF: document it, test the write path, protect the original

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
MEDIUM/HARD · add-on `apps/add-ons/norpdf` (3886 LOC / 22 files) +
`packages/pdfcore-engine`. Depends on brief 65 (whether norPDF becomes the
default PDF app).

## Problem

norPDF is the largest application in the OS and the corpus does not describe it
anywhere: no brief, no `wiki/` page, no row in `wiki/status.md`. It arrived
across a few recent commits (`feat(norpdf): … part A/B`, `feat(core): register
norPDF`), one of which is titled `save`. The knowledge exists only in the code,
which is exactly the failure mode `corpus/CLAUDE.md` exists to prevent.

What it actually is, from the source:

- `reader/` (Reader, PageView), `panels/` (Outline, Thumbnails), `shell/`
  (TopBar, SidePanel), `app/` (controller + context) — a real reader.
- `editor/` — annotation layer, annotate toolbar, signature dialog.
- `forms/` — form-field panel. `organize/` — page reorder/insert/delete.
- Built on `@pdfcore/engine`, a workspace package with a neutral entry plus
  `index.node.ts` / `index.browser.ts` platform bindings, where `doc.render`
  throws `UnsupportedPlatform` until a platform is bound.
- Saves by producing bytes from `doc.save()`
  (`app/useReaderController.ts:108-111`), after which the controller must
  `reloadDocument()` because the engine's read caches (render/text/outline) are
  stale (`:9-11`).

That last detail is the risk. **This app writes PDFs** — annotations,
signatures, form values, page reordering — over the user's original file. A
write path that produces a structurally valid but lossy PDF is the same class of
defect as the SuperDoc silent-save-loss (brief 20) and the ExcelJS shared-formula
corruption (2026-07-17 review), both of which were real in this repo. Unlike
those, this one has:

- **no tests in the add-on** (the engine package has `src/__tests__/`, the app
  does not), and
- **no backup of the original** before overwriting.

Two smaller items: `editor/SignatureDialog.tsx:186` uses a literal colour and
`editor/AnnotateToolbar.tsx:109,157` carry dead `rounded-*` classes
(`ui-conventions.md` §46); and `defaultSize.height` is 720, which cannot fit a
short viewport (§20).

## Proposed decisions (ungrilled)

- **Write the missing documentation first.** A `wiki/` page describing norPDF and
  `@pdfcore/engine` — what each module owns, the engine's platform-binding
  model, the save/reload contract, and what is and is not supported — plus a
  `wiki/status.md` row. Without this, the next session re-derives 3886 lines.
- **Prove the write path with fixtures.** For each write feature (annotate,
  sign, fill a form, reorder/insert/delete pages), a fixture PDF, a write, and a
  re-parse asserting the change is present *and* that unrelated structure —
  existing annotations, outline, form fields, metadata, page count — survived.
  This is the single highest-value change in the brief.
- **Never overwrite the original in place without a recoverable copy.** Until
  the Trash brief lands, write via a temp file and atomic rename so an
  interrupted save cannot truncate the user's PDF; and default destructive
  structural edits (page delete) to requiring an explicit save rather than
  silently mutating.
- **Warn on unsupported constructs at open**, mirroring brief 63's stance: if
  the engine cannot round-trip encrypted PDFs, XFA forms, or attachments, say so
  before the user invests edits.
- **Surface failures through `notify()`**, consistent with 62/63/64.
- **Rejected — OCR.** A large dependency (a bundled engine plus language data)
  against the slim-image identity, for a feature nobody has asked for.
- **Rejected — a second rendering path.** Whatever brief 65 decides, there is
  exactly one PDF renderer in the OS afterwards.

## Fix

1. `corpus/wiki/norpdf.md` (or a section in `architecture.md` if it stays short)
   + a `status.md` row. Include the save→`reloadDocument()` cache contract,
   since it is easy to break and currently only a comment.
2. Fixture-based tests for every write feature, asserting preservation as well
   as the intended change. Put engine-level cases in
   `packages/pdfcore-engine/src/__tests__/` next to the existing ones; keep
   app-level flow tests in the add-on.
3. Atomic save: write to a temp path in the same directory, then rename.
4. Open-time capability scan → one-shot warning for encrypted / XFA / attachment
   cases the engine cannot preserve.
5. Route failures through `notify({ appId: 'norpdf' })`.
6. Style cleanups: token instead of the literal at `SignatureDialog.tsx:186`;
   drop the dead radius classes; honest `defaultSize`/`minSize`.

## Must preserve (regression surface)

- The engine's platform-binding model: the browser build must not pull the node
  entry, and `doc.render` must keep throwing `UnsupportedPlatform` from the
  neutral entry rather than silently half-working.
- The save→reload contract: after a structural edit and save, render/text/
  outline caches are refreshed (`useReaderController.ts:9-11`).
- Outline, thumbnails, forms and organize keep working after a save.
- Lazy loading: the engine and pdfjs stay out of the eager bundle.
- The eslint import boundary — the add-on imports `@imbatranim/core` and
  `@pdfcore/engine` only.

## Verify bar

`turbo typecheck`, add-on + package lint/format green, `turbo build` ok, and the
new fixture tests. `packages/pdfcore-engine` keeps its existing tests green.

**Verified in a browser**: annotate a PDF, save, reopen, and confirm the
annotation persists and the outline still resolves; fill a form field and
re-read it; reorder pages and confirm page count and content; interrupt a save
(stop the backend mid-write) and confirm the original file is still intact and
readable.

## Out of scope

OCR, PDF creation from other apps, printing, digital-certificate signing
(the signature dialog draws a signature; cryptographic signing is a different
feature), redaction, and the default-app routing decision (brief 65).
