# Brief 95 — Paint (the missing creative app, lifted from the snipping tool)

Status: **todo (ungrilled)** · From the 2026-08-06 feature exploration
([wiki page](../../wiki/feature-exploration-2026-08-06.md)); Tier-2 #1 in
[real-os-gaps.md](../../wiki/real-os-gaps.md) called it "the strongest missing
app category". MEDIUM · one new add-on package, zero new dependencies.

## Problem

The OS can view, screenshot and annotate images, but cannot *make or edit*
one. Every reference desktop — and the Win7 identity specifically — ships
Paint. The snipping tool (brief 69) already built and tested the hard parts:
a canvas annotation layer with tools, undo, and save-to-`~/Pictures`; they are
just welded to the capture flow.

## Proposed decisions (ungrilled)

- **Canvas 2D, zero deps.** No fabric.js/konva — the snipping tool proved the
  in-house layer. If extraction is cheap, share the tool/undo core between the
  two apps (grill: a shared module in one package vs. duplicated-and-diverging
  code, the exact debt brief 23 existed to kill).
- **Tool set v1**: pencil, brush, line, rectangle/ellipse (outline + fill),
  fill bucket, text, eraser, color picker (eyedropper), undo/redo, zoom.
  Colors: the identity palette (brief 72/74's six names) as presets + a free
  color input. Canvas resize + crop-to-selection. Nothing else — no layers,
  no filters, v1 is Paint, not Photoshop.
- **Full save spine**: open via intent/dialog (`useFileDialog`), save/save-as
  PNG (JPEG on save-as), `useSaveHotkey` + `useUnsavedGuard` + dirty dot —
  the norm every editor follows ([ui-conventions](../../wiki/ui-conventions.md)).
- **Open-with**: "Edit" pathway for the image extensions the image viewer
  owns for viewing. Until brief 81 lands the general default-apps chooser,
  this is a context-menu "Edit in Paint" entry in
  `apps/add-ons/file-manager/src/lib/buildMenuItems.tsx` — do not steal the
  double-click default from the viewer.
- **Snipping tool handoff**: an "Open in Paint" action on a finished capture
  (via `openApp` payload) — the two apps become a pipeline instead of
  overlapping.
- **Honest limits stated**: editing re-encodes (PNG lossless, JPEG quality
  choice on save); huge images are clamped to a max canvas with a refusal
  message, not a frozen tab (measure the threshold, state it in-UI).

## Fix

1. New `apps/add-ons/paint` package (manifest, lazy chunk, window sizing per
   the unclamped-defaultSize trap in ui-conventions).
2. Canvas editor with the v1 tool set + keyboard (tool hotkeys registered via
   the shortcut registry, brief 86).
3. Save spine wiring + open-with entry + snipping-tool handoff.
4. Unit tests on the pure parts (geometry, undo stack, fill boundary); the
   package starts with the same zero-test debt every add-on has been paying
   off — do not add to it.

## Must preserve (regression surface)

- The snipping tool's own annotate/save flow unchanged (if the tool core is
  shared, its 69-era behaviour is the contract).
- Image viewer stays the double-click default for images.
- Eager bundle unchanged — Paint is a lazy chunk like everything else.

## Verify bar

`turbo typecheck/lint/build` green; unit tests on undo/fill/crop. **Verified
in a browser**: new canvas → draw with every tool → save to `~/Pictures` →
reopen and continue; open a photo, crop, save-as JPEG; snip → Open in Paint;
unsaved-close guard fires; 1280×577 window fits every control.

## Out of scope

Layers, filters/adjustments, selection-move of pixels (v1 crop only),
animated GIF editing, SVG editing, and any new image format support beyond
what the viewer already maps.
