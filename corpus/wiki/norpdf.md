---
summary: norPDF (the OS's PDF application, ~3900 LOC) and @pdfcore/engine (its isomorphic engine) — what each module owns, the platform-binding model, the save→reload cache contract, what the write path is proven to preserve, and what is deliberately not supported. Written 2026-08-03 for brief 66; before it, this existed only in the code.
updated: 2026-08-03
---

# norPDF and `@pdfcore/engine`

The largest application in the OS, and until brief 66 the only one the corpus did
not describe anywhere. It arrived across a few commits (`feat(norpdf): … part
A/B`, then one titled `save`) with no brief, no wiki page and no `status.md` row —
the exact failure mode `corpus/CLAUDE.md` exists to prevent.

Since brief 65 it is **the default `.pdf` application**: `openWith` routes `pdf` →
`norpdf`. The small `pdf-viewer` add-on remains as the deliberately light option.

## The split: app vs engine

**`packages/pdfcore-engine`** is a workspace package, not a folder of helpers. It
is the whole PDF capability, isomorphic, with no React in it. It is meant to be
usable outside this OS (a separate web demo consumes it), which is why it does not
import `@imbatranim/core` — see the duplicated `Map.prototype` polyfill in
`adapters/pdfjs/mapGetOrInsert.ts` (brief 91) for the one place that costs
something.

**`apps/add-ons/norpdf`** is the React application around it: windowing, panels,
toolbars, dialogs, and the controller that owns document state.

## Engine: the platform-binding model

Three entry points, and the distinction is load-bearing:

| Entry | Binds | Used by |
|---|---|---|
| `index.ts` | nothing | consumers that only need types |
| `index.browser.ts` | pdf.js render + the browser worker | the OS add-on |
| `index.node.ts` | pdf.js render via `@napi-rs/canvas` | the engine's own tests |

`doc.render` throws `UnsupportedPlatform` until a platform is bound. That is not
defensive noise — it is what keeps the **browser build from pulling the node
entry**, which would drag `@napi-rs/canvas` (a native module) into a web bundle.
The eslint import boundary enforces it.

`ensureBrowserWorker()` (in `adapters/pdfjs/worker.browser.ts`) owns
`GlobalWorkerOptions.workerSrc`, resolved with `new URL("pdfjs-dist/build/…",
import.meta.url)` so the consumer's bundler emits the worker into its own output.
Zero CDN. `configureWorker(src)` is the escape hatch and wins over auto-config.

## Engine: read vs write, and the cache contract

Read capabilities — `render`, `text`, `outline` — read the **current bytes** and
are cached per document.

Write capabilities — `annotate`, `forms`, `pages`, `sign` — mutate in-memory
**models** (`model/annotations.ts`, `model/forms.ts`). Nothing touches the PDF
until `PdfDoc.save()`, which commits every model to real PDF objects and returns
new bytes.

**The contract that is easy to break:** after `save()`, the read caches are stale,
so the app must `reloadDocument()`. It is currently enforced only by a comment in
`app/useReaderController.ts`. Skip it and the reader shows the pre-save render
while the bytes on disk have moved on — a silent disagreement between what the
user sees and what they have.

A second `save()` with no further edits is a genuine no-op: the models track change
sets rather than replaying themselves, so marks are not duplicated on every save.
There is a test for that, because it is the obvious way to get it wrong.

## App modules

| Directory | Owns |
|---|---|
| `app/` | `useReaderController` (document state, open, save, reload), context, `EmptyState` |
| `reader/` | `Reader`, `PageView` — the scrolling page surface |
| `panels/` | `Outline`, `Thumbnails` |
| `shell/` | `TopBar`, `SidePanel` |
| `editor/` | annotation layer, `AnnotateToolbar`, `SignatureDialog` |
| `forms/` | `FormsPanel` — AcroForm field editing |
| `organize/` | `OrganizeView` — page reorder / insert / delete |

## What the write path is proven to preserve

`packages/pdfcore-engine/src/__tests__/preservation.node.test.ts` (brief 66) runs a
deliberately rich fixture — three pages with distinct text, full Info metadata, two
filled AcroForm text fields — through each write and asserts **both** that the
change landed **and** that everything else survived.

Proven for annotate, forms, sign, and page reorder / delete / rotate / extract:

- page count and page order
- every other page's extractable text
- document metadata (title, author, subject)
- pre-existing form field values, including the field that was not edited
- annotations stay on the page they were added to
- a second save does not duplicate annotations
- **saving an untouched document does not damage it** — the cheapest way to lose a
  file is to open it, change nothing, and save

That list exists because this class of bug has been real in this repo three times:
SuperDoc silently exporting original bytes (brief 20), the ExcelJS shared-formula
corruption (2026-07-17), and a merged range written back as N copies of its value
(brief 63).

## Saving is atomic — at the backend, for every app

Brief 66 asked for an atomic save in norPDF. The right place turned out to be the
**backend**, once: `FilesService.uploadFile` was doing `copyFile` straight onto the
destination, and `copyFile` truncates before writing. Any failure part-way — full
disk, OOM kill, container restart — left the user's file truncated with the
original bytes gone, for **every** app in the OS.

It now stages a sibling temp file in the destination's own directory and
`rename`s over it. A rename within one directory is atomic on POSIX: either the
new bytes are fully there or the old file is untouched. Staging beside the
destination rather than in the OS temp dir is what makes that hold — a
cross-filesystem rename is not atomic. The previous file's mode is copied onto the
staged file first, or a rename would silently widen a `0600` file's permissions.

Seven backend tests cover it, provoking failures with real filesystem conditions
rather than by mocking `fs` (its exports are non-configurable in Node 24).

## Not supported, deliberately

- **Cryptographic signing.** `sign` places a *visual* mark — a stamp annotation, or
  an AcroForm signature field's appearance. No PKI. Parked post-v1.
- **OCR.** Rejected in brief 66: a bundled engine plus language data, against the
  slim-image identity, for something nobody asked for.
- **A second renderer.** There is exactly one PDF rendering path in the OS.
- **JPEG2000 / JBIG2 images.** pdf.js decodes these with WebAssembly, and wasm is
  refused outright by the shipped CSP — see [brief 92](../briefs/done/92-workers-and-wasm-study.md).
  A scanned PDF using those codecs renders its images as nothing. Fixing it needs
  a CSP change (human-gated) plus vendoring `pdfjs-dist/wasm/`.

## Known gaps

- **~1.2 s slower to first page than `pdf-viewer`** (5.3 s vs 4.2 s on a 40-page
  PDF, cold). It paints seven canvases — the page plus its thumbnail rail — and
  fetches several times the code. The fix is getting the first page up before the
  rail. Measured and recorded in brief 65; not yet done.
- **No open-time warning for constructs the engine cannot round-trip** (encrypted
  PDFs, XFA forms, attachments). Brief 63's stance applied here would be to scan
  and warn before the user invests edits. Brief 66 listed it; not built.
- **`README.md` and `architecture.md` still do not mention norPDF.**
