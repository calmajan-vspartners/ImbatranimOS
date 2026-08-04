# Brief 66 — norPDF: document it, test the write path, protect the original

Status: **done 2026-08-03** · From the 2026-07-31 app+OS improvement sweep.
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

## Outcome — 2026-08-03 (done)

### The atomic-save fix belonged in the backend, not in norPDF

The brief asked for "write via a temp file and atomic rename so an interrupted
save cannot truncate the user's PDF". Chasing that turned up that
`FilesService.uploadFile` was doing `fs.copyFile` **straight onto the
destination** — and `copyFile` truncates before it writes. Any failure part-way
(full disk, OOM kill, container restart) left the user's file truncated with the
original bytes gone.

That is not a norPDF problem. **Every save in the OS goes through that method** —
Docs, Sheets, Slides, Notepad, Code Editor, Markdown, images, norPDF. So the fix
went in once, at the backend: stage a sibling temp in the destination's own
directory, then `rename` over it. A rename within one directory is atomic on
POSIX — either the new bytes are fully in place or the old file is untouched — and
staging *beside* the destination rather than in the OS temp dir is what makes that
hold, because a cross-filesystem rename is not atomic and silently degrades to a
copy. The previous file's mode is copied onto the staged file first, or the rename
would quietly widen a `0600` file's permissions.

Seven tests, provoking failures with real filesystem conditions rather than
mocking `fs` — its exports are non-configurable in Node 24, and a test that cannot
spy is the better test here anyway. Both failure windows are covered: the source
vanishing before the staged copy, and a commit that fails *after* the staged copy
has already succeeded (the half-written window the old code could not survive).

### The write path is now proven to preserve, not just to write

The brief called this "the single highest-value change" and it was right.
`preservation.node.test.ts` runs a deliberately rich fixture — three pages with
distinct text, full Info metadata, two filled AcroForm text fields — through each
write and asserts **both** halves: the change landed, *and* everything else
survived. 12 tests across annotate, forms, sign, and page reorder / delete /
rotate / extract, covering page count and order, every other page's extractable
text, document metadata, the form field the user did *not* edit, that annotations
stay on the page they were added to, that a second save does not duplicate them,
and that **saving an untouched document does not damage it** — the cheapest way to
lose a file.

The brief's claim of "no tests" was about the add-on; the engine already had 70,
including a round-trip that proves the intended change lands. What was missing was
the other half, which is the half that costs a user their file.

**A trap worth recording:** the first draft called `doc.text.extract(p)` with a
bare page number. `extract` takes `{ pages }`, and a number is silently accepted
as an options object with no `pages` — which extracts the *whole document*. Every
per-page assertion was therefore reading all three pages and passing for the wrong
reason. Typecheck caught it, not the test run. The behaviour turned out to be
correct anyway, so the fix changed no expectations — but it is the second time this
session a green test proved nothing.

### The documentation the brief put first

[`corpus/wiki/norpdf.md`](../../wiki/norpdf.md) — the app/engine split and why the
engine does not import `@imbatranim/core`, the three platform entries and why
`UnsupportedPlatform` is load-bearing, a module-by-module table, the read-vs-write
model separation, the **save → `reloadDocument()` cache contract** (previously only
a comment), what the write path is proven to preserve, what is deliberately not
supported, and the known gaps.

### Style and manifest

- `SignatureDialog`'s literal colour: **kept literal**, with the reason written
  down. It is a preview of ink on paper and must match the mark that lands in the
  PDF; a semantic token would show white ink in dark mode for a signature that
  saves black. §46 flagged it as an oversight; it is a decision, and now says so.
- **Dead radius classes removed** — 2 in `AnnotateToolbar`, plus the 2 in
  `CodeEditor` §46 names in the same breath. Confirmed dead rather than assumed:
  `apps/core/src/index.css` has `* { border-radius: 0 !important }`, so every
  `rounded-*` in the tree has no effect. Leaving them tells the next reader the
  swatches are circles.
- `defaultSize.height` 720 → 560 (fits a 720px viewport with the taskbar);
  `minSize` 520×420 → 680×420.

### Not done, and why

- **The open-time capability scan** (encrypted / XFA / attachments). Brief 63's
  stance applied here, and worth doing — but it needs the engine to report what it
  cannot round-trip, which is engine work rather than a scan over the package the
  way brief 63's was.
- **`notify()` routing** was already in place (`NorPdf.tsx` notifies on open
  failure) — the brief listed it, the app already had it.
- **The ~1.2 s first-page regression** measured in brief 65. Cause is known —
  seven canvases painted before the first page is up. Deferred rather than
  attempted, because the fix is inside `useReaderController`'s render scheduling
  and deserves its own change.
- **`README.md` / `architecture.md`** still do not list norPDF. The wiki page now
  exists; wiring it into the top-level docs is a docs pass, not this brief.
- **A `status.md` row** — the page is linked from the index instead; `status.md` is
  at its 200-line cap and adding a row means splitting it, which is a separate
  change.

Also noted while here: **the backend has no `typecheck` script**, so
`apps/backend/test/*.e2e-spec.ts` has never been type-checked and currently has two
pre-existing supertest typing errors. `src/` is still compiled by `nest build`
during `turbo build`, so the gate is not as absent as it looks — but the test
directory is unchecked.

Tests 415 → 439.
