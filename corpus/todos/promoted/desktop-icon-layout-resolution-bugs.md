---
title: Desktop icon layout bugs — icons under the taskbar + drag doesn't clamp
created: 2026-07-19
status: open
tags: [core, desktop, ui, bug]
---

# Desktop icon layout bugs — icons under the taskbar + drag doesn't clamp

Two related desktop-icon bugs, both reproduced live in a headless Chrome at
1280×577 on 2026-07-19:

1. **Icons render under / below the bottom taskbar on shorter viewports.** With
   23 apps, 8 icons had their bottom edge below the taskbar top (Terminal, File
   Manager, System Monitor, Calculator, Clock, Calendar, REST Client, Archive
   Manager) and 5 of those were entirely off-screen below the viewport (File
   Manager, System Monitor, Clock, Calendar, Archive Manager) — unreachable.
2. **Dragging an icon doesn't clamp its persisted position**, so an icon can be
   dropped under the taskbar or off-screen and stay there across reloads.

## Context

Both live in
[Desktop.tsx](../../../apps/core/src/shared/components/desktop/Desktop.tsx) +
[DesktopIcon.tsx](../../../apps/core/src/shared/components/desktop/DesktopIcon.tsx),
with positions persisted in
[desktopStore.ts](../../../apps/core/src/shared/store/desktopStore.ts)
(zustand `persist`, localStorage key `desktop-storage`).

**Bug 1 — hardcoded 8-rows-per-column layout ignores viewport height.** The
initial layout in `Desktop.tsx` uses `col = Math.floor(index / 8)` /
`row = index % 8` with `ICON_HEIGHT=80`, `GRID_GAP=16`, `PADDING=16`. That
forces 8 rows per column = `16 + 8×96 ≈ 784px` of vertical space, but the icon
container is `bottom-[44px]` (taskbar is `TASKBAR_HEIGHT = 44`). So on any
viewport shorter than ~828px tall, the bottom rows fall under/below the
taskbar. Nothing re-flows the grid to the actual available height, and nothing
recomputes on window resize.

**Bug 2 — positions persist, and drag stores an unclamped value.**
`DesktopIcon`'s `onDragEnd` writes `{ x: position.x + info.offset.x, y: ... }`.
`info.offset` is framer-motion's *raw unconstrained pointer delta* from drag
start — it is NOT clamped to `dragConstraints`. So even though the visual drag
is clamped to the desktop, the *stored* position isn't; the next render's
`animate={{ x, y }}` then places the icon at the unconstrained coordinate,
which can be under the taskbar or off-screen. Because positions persist in
localStorage, a bad drop (or a layout initialized on a tall screen) sticks
forever, and moving to a smaller screen never re-flows.

**Things to decide when this is grilled into a brief:**
- Compute rows-per-column from the *live* container height (viewport −
  taskbar − padding), and re-flow on resize — instead of the hardcoded `8`.
- On drag end, clamp the stored position to the desktop bounds (or snap to a
  grid cell). Consider snap-to-grid + a "clean up icons" / auto-arrange action.
- Add a one-time migration / self-heal: any persisted position outside the
  current bounds gets clamped back on load, so existing `desktop-storage`
  blobs recover instead of hiding icons.
- Related but separate: app **windows** also open at a default size that spills
  under the taskbar on short viewports (e.g. the Calculator's `=` row is
  hidden) — captured in [app-walkthrough-bugs](app-walkthrough-bugs.md); decide
  whether the "clamp to desktop bounds" fix is shared between icons and windows.

From the 2026-07-19 headless-browser test pass (measured, not guessed).

> **SUPERSEDED 2026-07-31** by [brief 53](../../briefs/done/53-desktop-icon-layout.md),
> which found the cause was worse than described: icons *overlapped* each other
> at short viewports, not merely overflowed, so some apps could not be launched
> at all. Kept for history.
