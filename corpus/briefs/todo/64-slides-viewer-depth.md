# Brief 64 — Slides: be a good viewer rather than a bad editor

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
EASY/MEDIUM · add-on `apps/add-ons/slides` (212 LOC, pptx-preview). Standalone.
Depends on brief 54 for Open.

## Problem

Slides is the smallest document app and deliberately viewer-only. That is a
reasonable position — but it is currently a *thin* viewer, not a good one:

- **No thumbnail rail**, so navigating a 40-slide deck means scrolling blind.
- **No presenter/fullscreen mode.** A presentation app that cannot present is
  the one gap a user will name immediately.
- **No slide-by-slide keyboard navigation** (arrows / PageUp-Down / Home-End),
  the interaction everybody tries first.
- **No zoom-to-fit control**; render width is measured from the scroll viewport
  at render time, so the deck is whatever width the window is.
- **No speaker notes**, though `.pptx` carries them.
- **Failures are silent to the notification centre** — `error` state plus
  `console.error` (`Slides.tsx:25`), the same pattern as Docs and Sheets. A deck
  that fails to render shows a banner and nothing else.
- **No export of a slide as an image**, the one lightweight way to get content
  out of a viewer.

There is also a stale-render interleave that was found and fixed in the
2026-07-17 review; the render effect is keyed on `[source]` with width measured
synchronously (`:30-33`), which is subtle enough to deserve a regression test
rather than a comment.

## Proposed decisions (ungrilled)

- **Invest in viewing, not editing.** A PowerPoint editor is a multi-month
  product and would dwarf every other app in the OS; pptx-preview does not
  provide an editing model at all. Decide this explicitly so it stops being an
  open question: **Slides stays a viewer**, and the work goes into making
  viewing genuinely good.
- **Thumbnail rail + keyboard navigation + fullscreen presenter mode** are the
  three that turn it from a preview into a usable app. Presenter mode uses the
  Fullscreen API on the window's content, with arrows/Escape and a slide
  counter.
- **Speaker notes in a collapsible panel**, read from the deck.
- **Zoom: fit-width, fit-page, and fixed steps**, persisted per window.
- **Export current slide as PNG** via canvas, saved into the real FS through the
  existing upload path — consistent with how Snipping Tool writes to
  `~/Pictures`.
- **Rejected — editing, even "light" editing.** There is no model to edit; any
  attempt means adopting a second engine and owning fidelity for writes, which
  is the whole risk surface briefs 62 and 63 are trying to contain.
- **Rejected — converting to PDF for display.** It would need a converter in the
  image and lose text selection.
- **Deferred — presenting to a second display.** No multi-monitor concept exists
  (the browser tab is the display); revisit only if that changes.

## Fix

1. `ThumbnailRail.tsx` — rendered thumbnails, current-slide highlight, click to
   jump, virtualized if the deck is large.
2. Keyboard: arrows / PageUp / PageDown / Home / End scoped to the top window
   (`ui-conventions.md` §28).
3. Presenter mode: fullscreen the content area, slide counter, Escape to exit,
   notes optionally visible.
4. Zoom control in the toolbar; persist per window.
5. Notes panel from the parsed deck.
6. Route render/open failures through `notify({ appId: 'slides' })` alongside
   the banner.
7. Export-slide-as-PNG into `~/Pictures` (or a chosen path via brief 54's
   save dialog).

## Must preserve (regression surface)

- The stale-render interleave fixed in the 2026-07-17 review must not return —
  add a test that switching source twice in quick succession renders the second
  deck, not the first.
- Re-render on window resize keeps working without re-parsing the deck.
- The engine stays a lazy chunk (brief 19); the eager bundle does not grow.
- `.pptx` continues to route here from `openWith`.

## Verify bar

`turbo typecheck`, add-on lint + format green, `turbo build` ok. A test for the
double-source-switch race; a test that a render failure notifies.

**Verified in a browser**: open a real multi-slide deck; navigate by thumbnail
and by keyboard; enter presenter mode and page through it; read speaker notes;
export a slide and find the PNG in File Manager; resize the window mid-deck and
confirm no re-parse flicker.

## Out of scope

Any editing, transitions/animations, embedded video playback, presenting to a
second display, and PDF conversion.
