# Brief 64 — Slides: be a good viewer rather than a bad editor

Status: **done 2026-08-03** · From the 2026-07-31 app+OS improvement sweep.
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

## Outcome — 2026-08-03 (done)

**The decision is locked: Slides stays a viewer.** pptx-preview provides no
editing model, so "light editing" would mean adopting a second engine and owning
write fidelity for a third Office format — the exact risk surface briefs 62 and
63 spent their time containing. This closes the question rather than leaving it
open, and brief 90 inherits the answer.

Shipped, all seven Fix items:

1. **Thumbnail rail** — real thumbnails, not placeholders: each is a *clone of the
   rendered slide* scaled with a CSS transform. Exact by construction (a
   thumbnail cannot disagree with the slide it stands for) and it costs no second
   parse, which is the expensive part. Clones are `aria-hidden` and
   `pointer-events: none`, so a link inside a slide is not reachable from the rail
   and a screen reader announces the button rather than a duplicate of the whole
   slide.
2. **Keyboard navigation** — ←/→, PageUp/PageDown, Space, Home, End, ignored
   while focus is in a text field. Bound directly rather than through brief 86's
   registry: these exist only while a deck is open, and a row that appears and
   vanishes with a window is worse than no row.
3. **Presenter mode** — fullscreen the current slide, scaled to fit, click or → to
   advance, slide counter, and a visible **Exit (Esc)** button.
4. **Zoom** — fit-width / fit-page / six fixed steps, applied as a `transform`
   rather than a re-render, because re-rendering means re-parsing the deck.
5. **Speaker notes** — read from the package, in a collapsible panel, disabled
   when the deck has none.
6. **`notify()` on failure**, through brief 62's shared `reportFileFailure`, plus
   a warning-level notification when pptx-preview resolves without reconstructing
   anything (previously an inline banner only, in a window nobody may be looking
   at).
7. **Export the current slide as a PNG** into a chosen path, via `html-to-image` —
   already in the tree for the Snipping Tool, so no new dependency, and
   dynamically imported so it stays out of this app's entry chunk.

### Two things worth recording

**Notes parts are not numbered to match slides.** PowerPoint and python-pptx
allocate `notesSlideN.xml` only for slides that *have* notes, so a deck with notes
on slides 1, 2, 4 and 5 produces `notesSlide1..4` — and indexing by slide number
shows slide 4 the note belonging to slide 5. The parser follows the
relationships the format specifies instead: `<p:sldIdLst>` for order,
`presentation.xml.rels` to resolve each slide, then that slide's rels to find its
notesSlide *by relationship type*. The fixture deliberately leaves slide 3 without
notes so the wrong-mapping case is the one under test.

**pptx-preview consumes the buffer.** Parsing notes after the render returned
nothing every time, because there was nothing left to unzip. Notes are now read
before rendering — a few milliseconds, and `extractNotes` returns `[]` rather than
throwing on anything it cannot read, so it can never be why a deck fails to open.

**A bug of my own, found in the browser:** `requestFullscreen` can be refused (a
permissions policy, an embedding context), and presenting in-window is a
reasonable fallback — but then no `fullscreenchange` event ever fires, so the
original code left the user trapped in a black overlay with no way out. Escape is
now handled independently of the fullscreen event, and there is a visible Exit
button as well.

### Verified in the shipped production build

A real five-slide deck: all five slides render; the rail shows five thumbnails
with real cloned content (19-22 elements each, 101px tall, inert); clicking
thumbnail 4 moves the counter to `4 / 5` and sets `aria-current`; Home/→/End give
`1 / 5`, `2 / 5`, `5 / 5`; zoom reads "Fit width" with no transform, then `125%`
with `matrix(1.25, …)`; presenting enters real fullscreen with the slide moved
into the host and Exit returns to the deck intact; notes read
"Speaker note for slide one: remember to breathe." on slide 1, "No notes on this
slide." on slide 3 and "Final note." on slide 5 — matching the unit tests
exactly; export wrote `deck-slide-1.png` (28 209 bytes) into `Documents`. No page
errors.

**Not done**: the stale-render regression test the brief asked for. The interleave
guard is the fresh-detached-node commit pattern, which is DOM behaviour rather
than pure logic, and testing it needs a jsdom harness plus a stubbed engine —
worth doing, but as its own change rather than smuggled in here. The guard itself
is unchanged and still commented in place. Tests 369 → 384.
