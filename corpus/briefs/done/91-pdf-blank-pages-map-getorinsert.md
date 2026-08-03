# Brief 91 — Every PDF page rendered blank

Status: **done 2026-08-03** · Found while gathering evidence for the workers/wasm
study (brief 92), not from a brief. SMALL fix, TOTAL breakage · `apps/core`,
`apps/add-ons/pdf-viewer`, `apps/add-ons/norpdf`, `packages/pdfcore-engine`.

## Problem

The PDF Viewer showed a blank page for every PDF, in the shipped production
build, with no error surfaced to the user. The page counter read `1 / 2`, the
toolbar worked, the canvas was the right size — and nothing was drawn on it.

Measured rather than eyeballed: a 595×841 canvas with **zero** non-white pixels
for a document containing a heading, a paragraph and a filled red rectangle.

The cause, from the stack:

```
TypeError: this[#t].getOrInsertComputed is not a function
    at #s                      (pdf-*.js)
    at Ir.getOptionalContentConfig
    at e.render                ← PDFPageProxy.render()
    at PdfViewer-*.js
```

pdf.js 6.1 calls `Map.prototype.getOrInsertComputed`. It is a TC39 proposal that
shipped in Chrome 142; the browser under test was **Chromium 141** — released
weeks earlier and entirely current — where both `getOrInsert` and
`getOrInsertComputed` are `undefined`. `getOptionalContentConfig` runs on every
`render()`, so the throw is per-page and unconditional.

This is not an old-test-browser artifact. Anyone not on the newest Chrome, and
any browser whose engine has not shipped the proposal, gets a PDF viewer that
displays nothing. The OS also ships its own kiosk browser, so the version is not
purely the user's choice.

All three PDF surfaces share the library, so all three were affected:
`pdf-viewer`, `norpdf`, and `packages/pdfcore-engine`.

## Decisions

- **Polyfill, not a downgrade.** The semantics are small and specified, so a
  polyfill is a faithful implementation rather than a guess. Pinning pdf.js back
  would trade ten lines for every fix since. Installed additively, so it becomes
  a no-op and then irrelevant as engines catch up.
- **Duplicated into `pdfcore-engine` on purpose.** That package is standalone by
  design — its consumers are this OS's add-on *and* a separate web demo — and a
  render path that only works inside one host is not a rendering engine.
- **`has` then `get`, never `get() ?? insert`.** A stored `undefined` is a
  present entry; pdf.js stores optional-content values, so overwriting one is a
  real failure mode rather than a theoretical one.
- **Rejected — requiring Chrome 142+.** The OS is meant to be reachable from any
  machine.

## Fix

1. `apps/core/src/lib/mapGetOrInsert.ts` — `installMapGetOrInsert()`, idempotent,
   non-enumerable, exported from core. 9 tests, which exercise the polyfill
   itself (Node 24.18 does not have the methods either).
2. Called before `import('pdfjs-dist')` in the pdf-viewer bridge, at module scope
   of norPDF's lazy chunk, and from `ensureBrowserWorker()` in
   `pdfcore-engine` (which every render already goes through).

## Known remaining gap

pdf.js also calls these **inside its worker** — chunked byte-range requests and
AcroForm field parsing. The worker is loaded from a vendored URL, so a
main-thread polyfill cannot reach it. Those paths are conditional rather than
per-render, and none of them is this bug. If a PDF with form fields or a
range-request fetch ever reports the same `TypeError`, the fix is a shim worker
module that imports the polyfill and then the real worker, pointed at by
`GlobalWorkerOptions.workerPort`.

## Verify bar

`turbo typecheck`, lint + format green, `turbo build` ok.

**Verified in the shipped production build**, by counting pixels rather than
looking: the same canvas that had 0 non-white pixels now has **17,822**, and the
page error is gone.

## Out of scope

The worker shim (above), JPEG2000/JBIG2 decoding (see brief 92 — the wasm
decoders are unreachable under the current CSP anyway), and which PDF app wins
(brief 65).
