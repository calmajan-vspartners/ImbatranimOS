# Brief 67 — Image Viewer: pan, browse, and act on the file

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
EASY/MEDIUM · add-on `apps/add-ons/image-viewer` (438 LOC, zero non-core deps).
Depends on brief 54 for Open.

## Problem

The app renders an image through the authed `downloadUrl`, with zoom, fit,
rotate and folder prev/next — the right skeleton, and no dependencies, which is
worth preserving. What is missing is what turns a renderer into a viewer:

1. **No pan at zoom.** Zoom in past fit and the off-screen part of the image is
   unreachable — no drag-to-pan, no scroll-to-pan. Zoom is close to useless
   without it, which makes this the first fix.
2. **Rotate is display-only.** Rotating a sideways photo cannot be saved, so the
   photo is sideways again next time. Either offer to write it or say it is
   temporary; silently discarding the user's action is the worst of the three.
3. **No EXIF orientation.** A phone photo whose orientation lives in EXIF will
   display rotated, and the user has no persistent way to correct it (see above).
4. **Prev/next re-lists the directory.** The app does its own `listDir` to walk
   the folder; in a large directory that is a round trip per step.
5. **No thumbnail strip**, so there is no sense of where you are in a folder.
6. **No delete / rename / reveal-in-Files.** Viewing a photo you want to delete
   means switching apps.
7. **Nothing is virtualized or capped for very large images** — a 100 MP image
   is handed straight to an `<img>`.

## Proposed decisions (ungrilled)

- **Pan first**: pointer-drag when zoomed beyond fit, with the cursor
  communicating it, plus wheel-scroll panning and Ctrl+wheel zoom.
- **Rotate becomes a real edit, opt-in.** Rotating sets a dirty state and offers
  Save (re-encode via canvas, write back through `uploadFileBytes`) and Save a
  copy. Until saved it is a view transform. Use the existing dirty/close-guard
  spine so the behaviour matches every other app.
- **Honour EXIF orientation on load.** Read the orientation tag and apply it as
  the initial transform — no dependency needed for the single tag, which is a
  small, well-specified parse.
- **Cache the directory listing** for prev/next and invalidate on window focus,
  rather than re-listing per step.
- **Thumbnail strip, toggleable**, virtualized via `useVirtualList`.
- **File actions: Delete, Rename, Reveal in Files** — Delete through
  `useConfirm({ destructive: true })`, and it should route through the Trash
  once that brief lands rather than growing its own deletion semantics.
- **Rejected — crop/resize/filters.** That is an image *editor*; the parity
  research puts a Paint/editor app in Tier 2 as its own thing. Rotate is the
  exception because it is the one edit a *viewer* is expected to do.
- **Rejected — a slideshow.** Low value for a single-user desktop; revisit if
  asked.
- **Careful with SVG.** It is already rendered via `<img>`, which is the safe
  form (no script execution). Do **not** switch to inlining SVG for any reason —
  say so in the code so a future "make SVGs crisper" change does not open an
  XSS.

## Fix

1. Pan: pointer handlers on the image container with translate state, clamped so
   the image cannot be dragged entirely out of view; reset on fit.
2. EXIF orientation parse on load; apply before user rotation.
3. Rotate → dirty state + Save / Save a copy via canvas re-encode; reuse
   `useUnsavedGuard` and `useSaveHotkey`.
4. Directory listing cached in the app store; prev/next reads the cache.
5. `ThumbnailStrip.tsx`, toggleable and virtualized.
6. Toolbar actions for Delete / Rename / Reveal, using `useConfirm` and
   `openApp('file-manager', …)` for reveal.
7. Guard very large images: report dimensions and, past a threshold, warn before
   decoding at full size.

## Must preserve (regression surface)

- Images load through the authed path; `downloadUrl` stays used only where a
  real navigation/`<img>` needs it, never as a general byte-read.
- The registered extension set (png/jpg/jpeg/gif/webp/bmp/svg/avif/ico) keeps
  routing here, and animated GIF/WebP still animate.
- Zero new dependencies.
- The Tooltip-wrapped toolbar buttons (`ImageViewer.tsx:245-325`) keep working
  after the 2026-07-31 core Tooltip fix.

## Verify bar

`turbo typecheck`, add-on lint + format green, `turbo build` ok. Unit tests for
the EXIF orientation mapping and the pan clamp.

**Verified in a browser**: zoom in and drag to reach every corner; open a photo
with EXIF orientation and confirm it is upright; rotate, save, reopen, and
confirm it persisted; step through a folder of images and confirm no per-step
directory refetch; delete an image with the themed confirm.

## Out of scope

Crop/resize/filters, a full image editor, slideshow, batch operations, RAW
formats, and colour management.

---

## Outcome — 2026-08-04

**Done: pan, rotate-that-persists, and the SVG note.** Three of the seven items
are deliberately deferred, and one of the brief's own proposals was **measured to
be wrong and not implemented**.

### The brief's EXIF item would have made things worse

Item 3 asks for an EXIF-orientation parse "applied as the initial transform".
**That would double-rotate every phone photo.** Measured in the shipped build
against two JPEGs with identical pixels, one carrying `Orientation=6`:

- `imageOrientation` computes to `from-image` — the CSS default.
- The oriented file reports `naturalWidth/naturalHeight` as **200×400** where the
  plain one reports 400×200. The browser hands us *oriented* dimensions, so the
  fit math was already correct.
- `drawImage` receives the **already-rotated** pixels: the top-left of the canvas
  samples white where the raw bitmap has a red bar.

So the browser has honoured EXIF orientation all along, and a canvas re-encode is
naturally orientation-safe — it bakes in what the user sees and writes no EXIF at
all, so the output cannot disagree with itself. Recorded in `lib/encode.ts`.

### Four bugs found by measuring, three of them pre-existing

The verification method was the one that keeps paying: build the production
bundle, serve it through the real backend, and **measure pixels**.

1. **"Fit to window" had never fit anything, in three apps.** Image Viewer, PDF
   Viewer and Slides had each hand-rolled the same wiring:

   ```tsx
   useEffect(() => {
     const el = scrollRef.current
     if (!el) return    // ← null on the first commit…
     observer.observe(el)
   }, [])               // ← …and never retried
   ```

   All three early-return an "Nothing open" tree until `useOpenIntent` drains the
   intent in an effect, so the measured pane does not exist on the first commit.
   The size stayed at its initial value for the window's whole life:
   Image Viewer showed every image at 100% (a large photo simply cropped by the
   frame), PDF Viewer's `containerWidth` stayed `null` so "Fit width" fell back to
   100% zoom (measured: canvas 595px in a 718px pane, vs 686px after), and Slides'
   fit target was `{0,0}` so `resolveScale` returned its degenerate-input fallback
   of 1 and the slide overflowed the pane.

   Fixed once, in core, as **`useElementSize`** — a ref callback, which binds
   whenever the node attaches and has no dependency array to get wrong. All three
   apps now use it.

2. **Image Viewer's scale was applied twice.** The `<img>` is a flex child, so its
   layout box was already shrunk to the pane before any transform ran, and
   `scale(fitScale)` then shrank the shrunken box — fit came out at a third of the
   right size and "100%" showed 638px of a 2000px photo. Now sized explicitly, with
   the transform reserved for rotation and pan; the pane is `overflow-hidden` so
   panning is the single way to move the image rather than competing with native
   scrollbars.

3. **Slides had a second instance of the same class**, independent of the pane:
   `slideBox` took one `offsetWidth` reading in an effect keyed on `[slideCount]`,
   which commits as soon as pptx-preview returns — while the slides are still being
   laid out. The reading landed on 0 or an intermediate width and was never
   retried. This one was *flaky*, not consistently broken: the same build measured
   0.84 on one run and 1 on the next. Now observed. (Those nodes are created by
   pptx-preview, not React, so there is no ref to attach the hook to.)

4. **A Tooltip on a disabled button never opens**, so the reason Save was greyed
   out for a `.gif` was unreachable. There is now no dead Save button at all for
   formats that cannot take a rotation — the reason is inline text instead.

### Also fixed: navigating away discarded the rotation silently

`useUnsavedGuard` only guards *closing* a window. An arrow key to the next image
reset every per-image piece of state, so an unsaved rotation vanished without a
word — the same defect as rotate not persisting at all, just harder to notice.
Navigation now asks first, through the same `window.confirm` spine as the close
guard.

### What shipped

- `lib/pan.ts` — `clampPan` / `canPan` / `renderedSize`; the clamp keeps part of
  the image on screen always, pins to centre on any axis where the image is
  smaller than the pane, and a quarter turn swaps the axes so the bounds are right
  in exactly the case the user rotated to fix.
- `lib/encode.ts` — `encodeMime`, `canSaveInPlace`, `noSaveReason`, `copyName`,
  `rotatedCanvasSize`, and an `extensionOf` that fixes a real trap:
  `'png'.split('.').pop()` returns `'png'`, so a dotless file named `png` would
  have been overwritten as a PNG.
- Rotate → dirty title marker + Save (re-encode in place) and Save a copy (always
  PNG). GIF / ICO / SVG refuse in-place save with the reason on screen, because
  losing a GIF's animation without saying so is brief 63's defect class.
- 24 unit tests; zero new dependencies; SVG still goes through `<img>` and the
  code says why not to inline it.

**Measured in the shipped bundle** (`uitest/img67*.mjs`, `uitest/fitsweep2.mjs`):
pan tracks the pointer to the pixel (60/40 px drag → 60.0/40.0 px move), a
4000px drag stays clamped in reach, the cursor is `grabbing` mid-drag, a 2000×1000
photo fits exactly and is not pannable, 100% is genuinely 1:1 and *is* pannable,
rotate → Save swaps the dimensions **on disk** (400×200 → 200×400), the title's
dirty marker appears and clears, and zero CSP refusals.

### Deliberately deferred

- **Listing cache** (item 4). The app lists the folder **once** per window, not
  per step — prev/next already only moves a local index. The brief's premise is
  wrong; there is no per-step refetch to remove.
- **Thumbnail strip** (5) — real, but it is the largest item here and buys the
  least next to pan and a rotation that survives.
- **File actions: delete / rename / reveal** (6). Wants Trash routing and the
  themed confirm; belongs with the `system` seam rather than a fourth copy of
  delete semantics.
- **Large-image guard** (7) — no threshold measured yet, and a guess would either
  warn on ordinary photos or never fire.
