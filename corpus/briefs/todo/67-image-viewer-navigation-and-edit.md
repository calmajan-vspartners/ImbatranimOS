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
