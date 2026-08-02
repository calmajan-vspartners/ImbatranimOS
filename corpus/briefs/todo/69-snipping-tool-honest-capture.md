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
