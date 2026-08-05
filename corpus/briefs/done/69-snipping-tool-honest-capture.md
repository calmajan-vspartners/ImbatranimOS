# Brief 69 — Snipping Tool: say what it can capture, add redaction, stop hijacking the screen

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
MEDIUM · add-on `apps/add-ons/snipping-tool` (851 LOC; `html-to-image`).
Standalone.

## Problem

**1. It captures the DOM, not the screen — and never says so.** The rasterizer is
`html-to-image`, which serialises the DOM into an SVG `foreignObject` and draws
it to a canvas. That means anything not expressible that way is missing or wrong
in the "screenshot": `<canvas>` content, `<video>` frames, cross-origin images,
and — most importantly here — **the Terminal**, which xterm may render to a
canvas. The brief-21 spike is recorded as passing on xterm content, so it may
work today, but it is contingent on xterm's renderer choice, not guaranteed. A
screenshot tool that silently omits part of the screen is worse than one that
refuses.

**2. Opening the app immediately takes over the screen.** Verified during the
automated walkthrough: launching Snipping Tool drops a full-screen capture
overlay that swallows every subsequent click — the harness could not open any
further app until it pressed Escape. As a user experience, an app that seizes
the whole desktop the instant it launches, with no visible way back, is
startling; Escape works but nothing says so.

**3. No redaction.** Five annotation tools exist, but not the one with a real
purpose: blurring or blacking out a password, token or email before sharing.
This is the highest-value missing tool by a distance.

**4. No delay/timer capture**, so you cannot capture a menu, a hover state, or a
context menu — they close when you click the capture button.

**5. `AnnotationStage.tsx:415` uses `calc(100vh - 140px)`**, treating the window
as the viewport (`ui-conventions.md` §16). Wrong in a windowed OS and broken at
short heights.

**6. No re-open of a saved capture** to keep annotating, and no explicit
copy-to-clipboard reliability story.

## Proposed decisions (ungrilled)

- **State the capture model in the UI, and detect the gap.** Before capture,
  check for `<canvas>`/`<video>` elements in the region and warn that their
  content may not be captured. Honesty beats a silently wrong image.
- **Evaluate `getDisplayMedia` as an alternative path, do not adopt blindly.**
  It captures what is actually on screen — including canvas and video — but it
  captures the *host* browser surface, requires a user permission prompt each
  time, and may include browser chrome. Proposal: keep DOM rasterization as the
  default (no prompt, exactly the OS surface, already working) and offer
  `getDisplayMedia` as an explicit "capture exactly what's on screen" mode for
  when the DOM path is known to be lossy. Grill this — it is the one genuinely
  contested call in the brief.
- **Do not auto-arm capture on launch.** Open to a small launcher with the modes
  (Region / Window / Fullscreen / Delay) and a visible Escape hint; arm on
  choice. This fixes the hijack without removing the fast path.
- **Add redaction**: a filled-rectangle tool (opaque, not a blur) — opaque is the
  correct default because a blur can sometimes be reversed, and the user's
  intent is to destroy the content.
- **Add delay capture** (3s / 5s) so transient UI can be captured.
- **Rejected — screen recording.** `getDisplayMedia` video records the host
  screen, not the container; recording your own browser from inside it inverts
  "the tab is the display". The parity research rejects it for the same reason.

## Fix

1. Launcher view on open; arm capture only on mode selection; persistent Escape
   hint while armed.
2. Pre-capture scan for `<canvas>`/`<video>`/cross-origin `<img>` in the target
   region → one-time warning with a "capture anyway" action.
3. Redaction tool in the annotation toolbar; renders as an opaque rect and is
   flattened into the exported image, not stored as a removable layer.
4. Delay capture with a visible countdown.
5. Replace `calc(100vh - 140px)` at `AnnotationStage.tsx:415` with flex sizing
   (`h-full` + `min-h-0`) per §16/§18.
6. Optional `getDisplayMedia` mode behind an explicit control, with the
   permission failure handled via `notify()`.
7. "Open a saved capture" to resume annotating, via brief 54's picker.

## Must preserve (regression surface)

- Region select with the dim + crosshair flow, Enter/Escape semantics.
- The five existing annotation tools and undo.
- Save to `~/Pictures/Screenshots`, Copy, Download — including the filename
  collision fix from the 2026-07-17 review.
- The rasterizer stays a lazy chunk; the eager bundle does not grow.
- Escape always returns to a usable desktop, from any capture state.

## Verify bar

`turbo typecheck`, add-on lint + format green, `turbo build` ok. A test that the
redaction rect is flattened into the output (the covered pixels are actually
replaced, not layered).

**Verified in a browser**: launch the app and confirm the desktop stays usable
until a mode is chosen; capture a region containing the Terminal and inspect
whether its content is present — record the answer, since it determines how
loud the warning needs to be; redact a region and confirm the pixels are gone in
the saved PNG; use delay capture to grab an open context menu; check the stage
at 1280×577.

## Out of scope

Screen recording, GIF capture, OCR of a capture, cloud upload/sharing, and a
screenshot history/gallery.

---

## Outcome — 2026-08-05

Done. Four of the six problems were real as stated, one was wrong, and the brief's
"one genuinely contested call" is resolved as a **rejection** with the reasons on
the record.

### The question the brief asked to be answered: is the Terminal captured?

**Yes.** Measured against ground truth rather than asserted: the browser's own
screenshot of a rectangle over a Terminal full of text, compared with the tool's
capture of the same rectangle. The per-row ink profiles correlate **0.986 at a 0px
offset** — the glyph rows are in the same places — with total ink 31% against 39%,
a gap that is subpixel versus grayscale antialiasing, not missing characters. The
pair is in `shots/md69-terminal-capture.png` and reads identically by eye.

It is also **contingent**, exactly as the brief suspected: xterm is running its DOM
renderer here (measured: `0` canvases inside `.xterm`), and adding
`@xterm/addon-webgl` would silently invert this answer. That is why the detection
below is written against what is actually in the region rather than against a list
of apps.

Two probe bugs on the way to that number, both worth remembering because both
produced a confident wrong answer first: opening a Terminal window does **not**
focus xterm's textarea, so the first run compared two images of an empty prompt;
and taking the ground-truth screenshot *after* launching the tool put the tool's
own launcher window inside the rectangle, so the two images were of different
desktops and the correlation duly collapsed to 0.5.

### Item 3 was wrong: redaction already existed

The brief says "Five annotation tools exist, but not the one with a real purpose:
blurring or blacking out a password". The fifth tool **was** the redaction tool —
`pixelate`, labelled "Pixelate (redact)", sampling from the pristine base image so
the mosaic is baked into the export.

But the brief's *reasoning* survives its own error and points at a real gap: it
argues for an opaque fill because "a blur can sometimes be reversed". So can a
mosaic — recovering short strings from pixelated text is a solved exercise
(Unredacter did it against exactly this pattern), and the old block size of `8×`
the device ratio is squarely in the recoverable range. So:

- **Black out** is a new tool: a flat opaque fill, first of the two in the toolbar,
  with a fixed colour. Not a swatch choice — a redaction exists to destroy content,
  and a semi-visible box in whatever colour happened to be selected undermines the
  only thing it is for.
- **Pixelate stays** and its blocks are now much coarser (`max(14, 16×ratio)`), with
  the reason and the attack named at the function.
- The two labels say which is which: "destroys the pixels — use this for secrets"
  against "scrambles; recoverable on small text".

### `getDisplayMedia`: rejected, not deferred

The brief flagged this as the contested call and asked for it to be grilled.
Rejected, for three reasons that compound:

1. **It captures the wrong surface.** It records the *host browser* — its chrome,
   its other tabs, whatever the user picks in the browser's own source picker. The
   illusion this project is built on is that the tab *is* the display; a capture
   tool that reaches outside the tab breaks the same rule that got PiP rejected in
   brief 68 and screen recording rejected in this one.
2. **It needs a permission prompt per capture** — which is precisely the "an app
   seizes the screen the moment you launch it" complaint that item 2 exists to fix.
3. **The gap it would close is now visible instead.** The DOM path is lossy for
   canvas, video and cross-origin images, and those are detected and named on the
   capture itself.

Honesty about the model is delivered by the second half rather than by a second
capture path: `capture/lossy.ts` scans the region before the raster and the
annotation stage carries a dismissible banner — "This region contained 1 canvas
element. Their content may not appear in the image — a DOM capture re-renders the
markup rather than reading the screen." Deliberately "may not": whether a given
element survives depends on the browser and on how the element draws itself, and
claiming certainty in either direction would be wrong.

One deviation from the brief's Fix: the warning fires **after** the capture, next
to the image, instead of as a pre-capture modal with a "capture anyway" button. The
user can then see whether anything is actually missing, which is strictly more
information than a prediction, and it keeps the fast path fast.

### The hijack, and what the brief got slightly wrong about it

Item 2 is real: the app armed capture on mount, dropping a full-screen overlay that
swallowed every click. It now opens to a **launcher** — Select a region / Whole
desktop / Whole desktop after 3s / after 5s / Open a saved capture — and arms only
on a choice. Measured the way it matters: with the tool open, another app can be
launched from the desktop without pressing Escape first.

The brief adds "Escape works but nothing says so", and that half was already false —
the overlay has always carried a centred hint reading "Drag to select a region ·
Enter for the whole desktop · Esc to cancel". What Escape did do wrong is that it
**closed the app**; it now returns to the launcher, so a mistaken mode choice costs
one keystroke rather than a relaunch.

### Delay capture

Whole-desktop capture after 3s or 5s, with a countdown badge that is
`pointerEvents: 'none'` — load-bearing, because the entire purpose is photographing
things that vanish when you click. Measured three ways: the badge's computed
`pointer-events` is `none`, `elementFromPoint` at the centre of the screen returns
the desktop rather than the overlay, and a menu genuinely opens during the
countdown. The badge is tagged `data-snip-overlay`, so it is filtered out of the
shot it is counting down to — confirmed by checking its text is absent from the
capture.

Delay implies whole-desktop rather than region-select-after-delay: the drag needed
to pick a region is itself a click, and the transient UI being photographed would
not survive it.

### The `100vh` line, for a different reason than the brief gives

`AnnotationStage.tsx:415` did use `calc(100vh - 140px)`, and §16's "treating the
window as the viewport" is not quite the fault here — this stage is a full-screen
portal, so `100vh` really is its height. The bug is the hardcoded `140px` of
chrome: the toolbar **wraps**, so at narrow widths it is two or three rows tall and
the canvas ran off the bottom of its own stage. Now `maxWidth`/`maxHeight: 100%`
inside the existing `flex-1 min-h-0` parent. Measured at 1280×577, the brief's own
check: the canvas bottom sits 13px inside the stage instead of overflowing it.

### The rest

- **Reopen a saved capture** via brief 54's picker, decoded through `fetchFileBytes`
  → `createImageBitmap` rather than an `<img>` pointed at the download URL, because
  the point of reopening is to export again and a tainted canvas cannot.
- The rasterizer is still a lazy chunk, still `html-to-image`, and no dependency was
  added. The eager bundle did not grow; `SnippingTool` itself is 7.5 kB gzipped.
- `normalizeRect`, the pixelate block size, and the "was that a real drag or a stray
  click" rule moved into `lib/annotationGeometry.ts` with tests — the last of those
  was five inline branches in a `setDraft` callback, and it now covers the new
  blackout shape by construction.

### Verified in a browser, against the production bundle on the real backend

```
PASS the tool opens to a launcher instead of arming capture over the whole desktop
PASS the desktop stayed usable — another app opened with the tool running
PASS arming shows the dim overlay and says how to get out
PASS Escape returns to the launcher with the window visible, not out of the app
PASS the region was captured (420×160 device px)
MEASURED the Terminal's text IS present in a DOM capture: row ink profiles correlate
       0.986 at a 0px offset with the browser's own screenshot of the same rectangle
PASS no warning for a region with no canvas or video in it
PASS the blackout replaced the pixels on the canvas the export reads
PASS the redacted pixels are gone from the PNG on disk — flattened, not layered
PASS a region containing a canvas is captured AND labelled with what may be missing
PASS the countdown is click-through, so a menu can be opened while it runs
PASS a menu opened DURING the countdown — the desktop is genuinely interactive
PASS the delayed shot is the whole desktop, and the countdown badge is not in it
PASS the canvas stays inside its stage at a short height
PASS a saved capture can be reopened and annotated again
page errors: none
```

The redaction check is the brief's verify-bar item ("a test that the redaction rect
is flattened into the output"), done as a browser measurement rather than a unit
test: the PNG is fetched back off the filesystem, decoded, and the pixel inside the
redacted rect read out. It is `[11, 11, 13]` — the blackout fill — where it was
`[236, 236, 233]` before. A unit test could only have checked a canvas mock; this
checks the file.

Tests: frontend vitest **550 → 568** (18 new in a package that had none), backend
unchanged at 208 + 46. `turbo typecheck lint test format:check build` green across
95 tasks.

Out of scope and untouched: screen recording, GIF capture, OCR, cloud upload, and a
screenshot gallery.
