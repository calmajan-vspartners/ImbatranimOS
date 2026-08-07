---
title: Desktop drag-selection (Windows-style marquee/rubber-band)
created: 2026-07-19
status: promoted
tags: [core, desktop, ui]
---

# Desktop drag-selection (Windows-style marquee/rubber-band)

> **Promoted and shipped** as part of
> [brief 106](../../briefs/done/106-desktop-interaction-pack.md), 2026-08-07:
> press-drag on empty wallpaper draws the band, intersected icons highlight
> live, Ctrl+drag adds, Enter opens the whole set, a background click clears.
> Selection lifted to `Desktop` component state and stayed ephemeral, exactly
> as this note argued.

Add a Windows-style rubber-band selection to the desktop: press-and-drag on
empty desktop background draws a selection rectangle, and every desktop icon
whose box intersects that rectangle becomes selected. Clicking empty background
clears the selection. Ideally the selected set can then be acted on together
(open, and later move/delete once those exist).

## Context

Today selection is per-icon and local-only. Each
[DesktopIcon](../../../apps/core/src/shared/components/desktop/DesktopIcon.tsx)
owns a `useState(selected)` toggled on click and cleared on `blur` — there is
no marquee, no multi-select, and clicking the empty
[Desktop](../../../apps/core/src/shared/components/desktop/Desktop.tsx) background
does not clear a selection. So this is a genuinely missing feature, not a
regression.

**Reusable prior art already in the repo:** the Snipping Tool add-on already
implements a full-desktop drag-to-select-region overlay — opening it shows
*"Drag to select a region · Enter for the whole desktop · Esc to cancel"* and
lets you rubber-band a rectangle over the whole desktop. That marquee math
(pointer down → track rect → hit-test) is the same primitive this feature
needs; lift/share it rather than reinventing. See
[apps/add-ons/snipping-tool/](../../../apps/add-ons/snipping-tool/).

**Constraints to respect when this is grilled into a brief:**
- Selection state should live at the desktop level (lifted out of per-icon
  `useState`), so a marquee can set/clear many icons at once. Decide whether it
  belongs in [desktopStore](../../../apps/core/src/shared/store/desktopStore.ts)
  (persisted) or ephemeral component state (probably ephemeral — selection
  shouldn't survive reload).
- The marquee must not start when the press begins on an icon (that's a drag,
  see [desktop-icon-layout-resolution-bugs](desktop-icon-layout-resolution-bugs.md))
  — only on empty background.
- Rectangle hit-test uses icon boxes; coordinate space must match the icon
  positioning model (absolute x/y within the desktop container).
- Keep it inside the desktop bounds — the container is `bottom-[44px]` (above
  the taskbar); the marquee shouldn't paint over or under the taskbar.
- Ctrl/Shift-click to add/remove from selection is a natural follow-on; decide
  whether it's in-scope for v1 of this feature.

From the 2026-07-19 browser test + feature-request pass.
