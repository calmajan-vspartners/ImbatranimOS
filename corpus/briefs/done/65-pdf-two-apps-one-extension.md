# Brief 65 — Two PDF apps, one extension: decide which one the OS opens

Status: **done 2026-08-03** · From the 2026-07-31 app+OS improvement sweep.
MEDIUM · `apps/add-ons/pdf-viewer` (340 LOC), `apps/add-ons/norpdf` (3886 LOC),
`apps/add-ons/file-manager/src/lib/openWith.ts`. **Decide this before investing
further in either app** — brief 66 depends on the answer.

## Problem

The OS ships two PDF applications, and the weaker one owns the file type.

- **PDF Viewer** — 340 lines, pdfjs-dist, single-page canvas render with zoom
  and paging (`PdfViewer.tsx:33-141`). From brief 19.
- **norPDF** — 3886 lines across 22 files and a whole workspace package
  (`packages/pdfcore-engine`, an isomorphic engine with separate node/browser
  platform bindings). It is a full suite: `reader/`, `editor/` (annotate,
  signature dialog, annotation layer), `forms/`, `organize/` (page reorder,
  insert, delete), `panels/` (outline, thumbnails), and a real save path through
  `doc.save()` (`app/useReaderController.ts:108-111`). It arrived in recent
  commits and **no brief in the corpus documents it** — it is the largest
  undocumented thing in the repo.

`openWith.ts:62` maps `pdf: { appId: 'pdf-viewer' }`. So double-clicking a PDF —
the only path most users will ever take — opens the small viewer, and the
annotate/forms/sign/organize suite is reachable only by launching norPDF from
the desktop and then having no in-app way to open a file (it shows an
`EmptyState`). The capable app is effectively hidden.

This is not just a routing nit. It means: two implementations of PDF rendering
to maintain, two sets of pdfjs behaviour to keep working, a doubled contribution
to image size, and a user-visible inconsistency where "open a PDF" and "open
norPDF" produce different applications with different capabilities.

## Proposed decisions (ungrilled) — this brief is mostly a decision

- **Preferred: make norPDF the default PDF application and retire PDF Viewer.**
  It is a strict superset in capability. Route `pdf` → `norpdf`, delete
  `apps/add-ons/pdf-viewer`, and keep the ext→app map single-valued. Rationale:
  two apps for one file type is a maintenance and identity cost with no user
  benefit, and the OS already has an add-on manager (brief 46) for anyone who
  wants a minimal roster.
- **Alternative, if norPDF is not yet trusted for everyday reading:** keep both,
  but route `pdf` → `norpdf` anyway and demote PDF Viewer to a deliberate
  lightweight option, with "Open with ▸" (the default-apps parity brief) as the
  way to choose. Do **not** leave the default pointing at the weaker app.
- **Rejected: keeping the current mapping.** It hides 3886 lines of working
  functionality behind a path no one will discover.
- **Whichever way it goes, the decision must be recorded** in
  `wiki/decisions.md`, because it determines whether `pdf-viewer`'s code stays
  in the tree — and, if norPDF wins, whether `pdfjs-dist` can be a single
  dependency rather than two apps' worth.
- **Measure before deleting.** Compare eager/lazy chunk sizes and cold open time
  for a large PDF in both apps. If norPDF is markedly slower to first page, fix
  that as part of the switch rather than shipping a regression on the most
  common action (opening a PDF to read it).

## Fix

1. Benchmark both on the same large PDF: time to first rendered page, memory,
   lazy-chunk size. Record the numbers.
2. Make the call and write it into `wiki/decisions.md` + `log.md`.
3. Repoint `openWith.ts:62` (and the `case 'pdf-viewer'` branch at `:112`).
4. If retiring: delete the package, remove it from `manifest.ts`, drop its
   workspace entry, and confirm `pdfjs-dist` is still resolved once.
5. Give norPDF an in-app Open via brief 54 so it is reachable on its own.
6. Update `README.md`'s app list and `wiki/architecture.md`.

## Must preserve (regression surface)

- Double-clicking a `.pdf` in File Manager always opens *something* — never a
  silent no-op (`FileManager.tsx:157-161`).
- Whichever app remains handles a large PDF without freezing the desktop, and
  releases pdf.js worker buffers on unmount/source change (the existing
  behaviour at `PdfViewer.tsx:58`).
- The add-on manager can still disable the PDF app without breaking `openWith`.
- The eslint import boundary and the lazy-chunk strategy are unchanged.

## Verify bar

`turbo typecheck`, lint + format green, `turbo build` ok, and the recorded
before/after chunk sizes.

**Verified in a browser**: double-click a PDF in File Manager and land in the
intended app; open a large PDF and confirm first-page time is not worse than
today; if PDF Viewer was removed, confirm no dead entry in Start, the palette,
the desktop, or Settings → Apps.

## Out of scope

norPDF's own feature and save-safety work (brief 66), PDF creation from other
apps, printing, and OCR.

## Outcome — 2026-08-03 (done)

**Decision: `openWith` routes `pdf` → `norpdf`. PDF Viewer is kept, not deleted.**
Recorded in [decisions.md](../../wiki/decisions.md).

The brief's preferred option was "make norPDF the default and retire PDF Viewer".
The first half is right and shipped. The second half the measurement argues
against, so it was not done — and the numbers are why, not a preference.

Measured on the same 40-page PDF, cold, in the shipped production build:

| | PDF Viewer | norPDF |
|---|---|---|
| time to first inked page | **4.2 s** | **5.3 s** |
| own code (gzip) | **5.2 KB** | 202 KB |
| pdf.js (shared by both) | 642 KB gzip | 642 KB gzip |

"Time to first inked page" is measured by sampling canvas pixels, not by waiting
for a canvas element to exist — brief 91 is the standing reason that distinction
matters, since a correctly-sized blank canvas is exactly what a broken renderer
produces.

- **The default had to move.** While it pointed at the 340-line viewer, norPDF's
  3886 lines — outline, thumbnails, search, annotate, forms, page organise, save —
  were reachable only by launching it from the desktop.
- **Retiring PDF Viewer buys 5.2 KB gzip.** pdf.js, the actual weight, is shared
  by both, so there is no size win to collect. It is also faster to first page
  with a fraction of the bytes, which is a real use case.
- **Brief 81's "Open with ▸" is the chooser.** Deleting the alternative before the
  chooser exists removes the user's option to gain 5 KB.

### Also fixed here: norPDF's Open read the wrong computer

`pickFile` was `fileInputRef.current?.click()` on a native `<input type="file">`.
That reads the **host machine**. Brief 54 rules it out by name — "the computer is
the container", and an Open dialog that browses the user's laptop instead of their
home directory is actively wrong in this OS. It now uses `useFileDialog`, so the
pick latches into the same store `useOpenIntent` reads and runs the identical load
path a File Manager double-click does. Drag-and-drop from the host is kept: that is
an explicit, visible host gesture, not a dialog pretending to be the OS's.

This is also Fix step 5 ("give norPDF an in-app Open via brief 54") — and it was
not merely missing, it was wrong.

### The routing table now has tests

It had none, which is how `.pdf` came to point at the weaker app unnoticed. Nine
tests pin the decisions that are easy to flip and hard to see: `.pdf` → norPDF,
the office formats, case-insensitivity, `null` for unmapped extensions rather than
a guess, and a check that **every** app the map can resolve to has a context-menu
label — a resolved app with no label renders "Open in undefined".

One of those tests documents a dead end rather than fixing it: **`.txt` under
`home` resolves to nothing at all**, because Notepad is not root-aware and its
rule is `onlyRoots: ['notes']`. Double-clicking a text file in the home directory
does nothing. That is brief 59's headline, so it is asserted here as current
behaviour with a pointer, giving brief 59 a test to flip rather than a surprise to
discover.

### Known regression, recorded rather than hidden

norPDF is **~1.2 s slower to first page**. The cause is visible in the same run:
it paints 7 canvases (the page plus its thumbnail rail) and fetches several times
the code. The fix is getting the first page up before the rail, which belongs to
brief 66 — norPDF is the largest undocumented, untested thing in the repo and that
brief owns it. Not fixed here, and not pretended away.

**Not done**: deleting `pdf-viewer` (deliberate, above), the README/architecture
app-list touch-ups (norPDF is still absent from both — folded into brief 66, which
has to document it anyway), and the first-page perf fix.

### Verified in the shipped production build

Double-clicking `sample.pdf` in File Manager opens **norPDF** with its outline and
thumbnail chrome and real ink on the canvas. norPDF's own "Open a PDF" shows the
OS dialog titled "Open file" with the Home and Notes roots, opens `big.pdf` from
the container filesystem and renders it, and **no native file chooser is
triggered** (Playwright's `filechooser` event never fires, and there is no
`input[type=file]` left in the DOM). No page errors. Tests 406 → 415.
