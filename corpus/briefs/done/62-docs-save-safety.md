# Brief 62 — Docs: make a failed save impossible to miss, and widen the normalizer

Status: **done 2026-08-03** · From the 2026-07-31 app+OS improvement sweep.
MEDIUM · add-on `apps/add-ons/docs` (402 LOC, SuperDoc + a docx normalizer).
Standalone. Shares its headline with briefs 63 and 64 — fix the shared pattern
once and adopt it in all three.

## Problem

**A failed save is silent.** `Docs.tsx` reports both open and save failures into
local component state plus `console.error` (`:87`, `:100`, `:128-132`). There is
no `notify()`. So if a save fails — permissions, a full volume, a backend
restart, an oversized upload — the user sees an inline banner *in a window they
may not be looking at*, the dirty marker behaviour is the only other hint, and
they will close the window believing the document is written. For a word
processor that is the worst possible failure mode, and `notify()` has existed
since brief 34 specifically so background failures surface.

This matters more here than anywhere because Docs already had one silent
data-loss defect: SuperDoc exported the **original bytes** for a `.docx` missing
optional OOXML parts, which brief 20 root-caused and fixed with an open-time
normalizer. That fix proved the class of bug exists in this pipeline; the
normalizer's coverage has not been revisited since, and nothing tells the user
when a document round-trips imperfectly.

Also missing for an app people will treat as Word: no print / export to PDF, no
find-and-replace, no page/zoom control, no recovery of an unsaved document after
an accidental close, and no clear message for a format SuperDoc cannot open
(`.doc`, `.odt`, `.rtf`) — it fails like a broken app rather than an unsupported
file.

## Proposed decisions (ungrilled)

- **Every save/open failure raises `notify({ level: 'error', appId: 'docs' })`.**
  Errors are sticky in the notification centre by design, so a background
  failure survives until acknowledged. Keep the inline banner as well — it is
  the right *in-view* signal (`ui-conventions.md` §23) — but it is not
  sufficient alone.
- **Never clear the dirty flag unless the write actually succeeded.** Audit the
  save path so a rejected upload leaves the document dirty and the close guard
  armed. This is the difference between "you lost work" and "you were told".
- **Audit the normalizer's coverage and record it.** Enumerate which OOXML parts
  it repairs and which fall through, as a comment and a test matrix. If a part
  is known-unsupported, warn on open rather than discovering it at save.
- **Refuse unsupported formats clearly.** Detect `.doc`/`.odt`/`.rtf` up front
  and say "not supported — this app reads .docx", instead of surfacing an engine
  error. Do **not** add a converter: that is a large dependency for a rare case.
- **Print / export to PDF is deferred to a platform capability**, not built per
  app. Three apps want it; solving it once (a print stylesheet plus
  `window.print()`, or an engine export) belongs in its own brief.
- **Rejected — autosave.** Same reasoning as Notepad: the OS has one explicit
  save spine, and there is no Trash or version history yet to make silent writes
  recoverable. Revisit once both exist.
- **Deferred — track changes and comments.** SuperDoc supports some of this;
  it is a genuine feature, but it is a product decision and a much larger
  surface than this brief.

## Fix

1. Route every `catch` in `Docs.tsx` (`:87`, `:98-100`, `:128-132`) through
   `notify()` with a human message, keeping the inline banner.
2. Re-read the save path and make the dirty-clear strictly conditional on a
   resolved write; add a test that a rejected upload leaves `dirty === true`.
3. Normalizer: document the repaired parts; add fixtures for a document missing
   each optional part it claims to fix; assert byte-level round-trip stability
   for a document that needs no repair (open→save with no edits must not
   rewrite content).
4. Unsupported-extension guard before the engine loads, with the house empty
   state and a clear message.
5. Adopt brief 54's Open/New so the app is reachable without File Manager.

## Must preserve (regression surface)

- The brief-20 normalizer keeps fixing the original defect — the regression
  fixture for "docx missing optional parts saves real edits, not original bytes"
  must stay green.
- The dirty-flag race fixed in the 2026-07-17 review pass stays fixed.
- The shared spine: `useOpenIntent`, `useSaveHotkey`, `useUnsavedGuard`,
  `createOpenedFileStore`, `fetchFileBytes`/`uploadFileBytes` including
  `UploadTooLargeError`.
- AGPL obligations around SuperDoc are unchanged by this work.
- The engine stays a lazy chunk; the eager bundle does not grow.

## Verify bar

`turbo typecheck`, add-on lint + format green, `turbo build` ok. Tests: rejected
save leaves the document dirty and emits an error notification; no-edit
round-trip is byte-stable; each normalizer fixture opens and saves with content
intact; an `.odt` produces the friendly refusal.

**Verified in a browser**: edit a document, stop the backend, save — expect a
sticky error toast, a still-dirty document, and a close guard that still fires.
Restart the backend and save successfully. Open a `.doc` and read the message.

## Out of scope

Track changes, comments, print/export-to-PDF (own brief), autosave, format
conversion, collaborative editing, and templates.

## Outcome — 2026-08-03 (done)

The brief's premise was that a failed save was silent. It was — but verifying
that turned up something worse, and it is the headline: **Docs could not open a
single `.docx` in any shipped image, and showed no error while failing.**

### The bug the brief did not know about

`docxNormalize` called fflate's **async** `unzip`/`zip`. fflate spawns its worker
from a `blob:` URL, and this OS's own CSP refuses that — `worker-src` is unset,
so it falls back to `script-src 'self'`, and a blob URL is not `'self'`. The
browser logs:

> Refused to create a worker from 'blob:…' because it violates the following
> Content Security Policy directive: "script-src 'self'". Note that
> 'worker-src' was not explicitly set…

fflate 0.4.8 then throws inside its **own** error handler (`cbl` dereferences
null) rather than calling our callback, so the promise never settled. No
rejection, no timeout, no notification: the window sat on "Loading document…"
forever. Confirmed against the real production build served by the real backend
with the real CSP, and reproduced identically on `HEAD` before any of this
brief's changes — so it was not introduced here. It failed in dev too, for a
different reason (Vite's optimized fflate dep breaks its own inlined worker
source), which is why it had never been noticed as *environment-specific*.

Fixed by using fflate's **synchronous** API. Identical output, no worker, no blob
URL. A docx is a small zip and this runs once behind the open overlay. If a huge
document ever janks, the fix is our own module worker — the same-origin `?worker`
pattern Monaco and the Sheets ExcelJS bridge already use — not fflate's async
API. That is written into the code as a warning.

### The second find: SuperDoc phones home

SuperDoc defaults to `telemetry: { enabled: true }` and POSTs to
`https://ingest.superdoc.dev/v1/collect` on **every document open**. The CSP
refused it — that refusal is how it was found — but relying on CSP to suppress an
outbound call the app deliberately makes is the wrong layer: a deployment behind
a proxy that relaxes the CSP would start leaking. Now `telemetry: { enabled:
false }`. After the fix the only offsite requests the whole desktop makes are the
Google Fonts stylesheet the CSP already allows.

### What the brief asked for

- **`notify()` on every failure**, via a new core helper
  `reportFileFailure` / `reportFileRefusal` (`apps/core/src/lib/fileFailure.ts`).
  It returns the banner text *and* raises the notification, so the two cannot
  drift and neither can be forgotten — brief 86's `useRegisteredHotkeys`
  reasoning applied to error reporting. Written as shared on purpose: briefs 63
  and 64 adopt the same helper. 12 tests, including that a disk-full 503's
  message (brief 83) is passed through verbatim rather than replaced with a
  generic failure, and that "the backend did not answer" reads differently from
  "the backend said no".
- **Dirty-clear audit.** The condition was already correct; it is now a tested
  pure function (`shouldClearDirty`, 5 tests) instead of the shape of a
  try/catch, because "never clear dirty unless the write succeeded" is one
  accidental `finally` away from being wrong and that mistake loses work
  silently.
- **Normalizer coverage documented and fixtured.** The three parts SuperDoc
  dereferences unguarded are repaired; other optional parts (`numbering.xml`,
  `settings.xml`, `theme1.xml`, headers/footers) are read defensively and need no
  repair. 10 fixtures: one per part, all three at once, the body untouched during
  repair, no duplicate `Content_Types` override, and **byte-stability** — a
  complete document returns the identical array, so open→save with no edits
  cannot rewrite the package.
- **Unsupported formats refused up front**, by name, before the engine loads,
  and always answering "then what does this app read?" — `.doc`/`.odt`/`.rtf`
  name the format; `.txt`/`.md`/`.xlsx`/`.pptx` name the app that owns it. A
  non-zip `.docx` is refused too, using the normalizer's new `readable: false`.
- **Brief 54's Open** was already adopted.

### Verified in the shipped production build

Served by the real backend with the real CSP: `minimal.docx` (missing
`word/styles.xml` *and* `docProps/custom.xml`) opens, its table survives import,
and the repair is logged as both parts. Edit → dirty → save → dirty cleared →
a valid zip on disk. Second edit → upload cut off at the wire → **still dirty**,
inline banner "Could not reach the OS to save this document.", a toast on screen,
and a sticky error in the notification centre naming the file. `.odt` and a
non-zip `.docx` are refused with their own messages plus a warning-level
notification. No page errors.

**Not done**: print/export-to-PDF (the brief defers it to its own brief, since
three apps want it), find & replace and the formatting toolbar (brief 90 stage
2), autosave (rejected), and format conversion (rejected). Tests 283 → 317.
