---
title: Image viewer add-on
created: 2026-07-17
status: promoted
tags: [add-on, normal-user, media]
---

# Image viewer add-on

A proper image viewer: open an image from Files, next/prev through the folder,
zoom/fit/rotate. Light editing (crop, rotate, annotate) is a natural extension.

## Context

Today images only show in the preview pane / metadata card — no dedicated
viewer. The Snipping Tool already has an annotation stack (region select, 5
annotation tools, undo) that a light editor could reuse rather than rebuild.

**Constraints to respect when this is grilled into a brief:**
- Register in the file-manager ext→app map (`lib/openWith.ts`) so double-click
  on an image opens it.
- Reuse the shared add-on kit + Snipping Tool annotation code where sensible.
- Lazy-load any rasterization/editing deps.

From the 2026-07-17 daily-driver research pass.
