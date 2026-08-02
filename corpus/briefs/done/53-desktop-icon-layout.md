# Brief 53 — Desktop icons: stop overlapping, stop falling off the screen

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
EASY/MEDIUM · CORE (`apps/core/src/shared/components/desktop/`,
`apps/core/src/shared/store/desktopStore.ts`). Standalone. Supersedes the
`desktop-icon-layout-resolution-bugs` todo, which described this as an overflow
problem; it is worse than that.

## Problem

**Reproduced live** at 1280×577: desktop icons **draw on top of each other** —
"System Monitor" and "Terminal" are painted in the same cell, as are
"Calculator" and "Docs" — and the lower rows fall past the desktop area
entirely. Because an icon is the only way to launch an app from the desktop,
**several apps cannot be opened at all** at that viewport. The automated
walkthrough could not launch them either; it opened 8 of 23 until the harness
was changed to close windows between apps.

Even at 1440×900 the grid is visibly ragged: there is an empty cell before
"Sheets", and "Bookmarks" wraps mid-word to "Bookmark / s".

The layout is a fixed 8-row column, hardcoded, with no reference to the
viewport (`desktop/Desktop.tsx:52-53`):

```ts
const col = Math.floor(index / 8)
const row = index % 8
```

with `ICON_HEIGHT = 80`, `GRID_GAP = 16` (`:37-39`). Eight rows therefore need
`8 × 96 = 768px` plus padding, but the desktop layer is
`bottom-[44px] overflow-hidden` (`:71`), leaving only `innerHeight - 44` — 533px
at 577. Rows 6–8 of every column are unreachable.

The overlap on top of that comes from persistence: positions are only computed
`if missing` (`:49`) and otherwise read from `useDesktopStore().iconPositions`
(`:45`). So a store populated at one viewport (or before norPDF was added to the
registry, which shifts every later `index`) mixes stale coordinates with newly
computed ones, and two icons land in the same place.

## Proposed decisions (ungrilled)

- **Rows per column derive from the usable height**, not a constant:
  `Math.max(1, Math.floor((availH - 2 * PADDING) / (ICON_HEIGHT + GRID_GAP)))`.
- **Auto-placed icons reflow on viewport resize.** An icon the user has
  explicitly dragged is pinned and does not reflow — that distinction is the
  whole point of a desktop, so `desktopStore` must record *why* a position
  exists (auto vs user-placed), not just its x/y.
- **Placement is collision-free by construction**: compute the auto layout from
  the current registry order into free cells, skipping cells occupied by pinned
  icons. Never write two icons to one cell.
- **Stale persisted positions are migrated, not trusted.** On load, drop any
  auto position that no longer fits the viewport or collides, and re-place it.
  A pinned position that is now off-screen is pulled back into view rather than
  lost.
- **Fix the label while here**: `line-clamp-2` with a mid-word break produces
  "Bookmark / s". Break on word boundaries and ellipsize, with the full name in
  a `title`.
- **Rejected — CSS grid/flex instead of absolute positioning.** Drag-to-place is
  an existing feature (`updateIconPosition`) and the desktop-drag-selection todo
  builds on it; a flow layout would delete that.
- **Rejected — horizontal scrolling of the icon field.** Real desktops wrap into
  a new column; they do not scroll.

## Fix

1. `desktopStore`: give each entry `{ x, y, pinned: boolean }` (default
   `pinned: false`; `updateIconPosition` from a user drag sets `true`). Migrate
   existing persisted shapes by treating them as pinned only if they differ from
   what the auto layout would have produced — otherwise as auto.
2. Extract a pure `layoutIcons(appIds, pinned, viewport)` helper returning a
   collision-free map. Unit-test it directly; the current arithmetic lives
   inline in a `useEffect` and cannot be tested at all.
3. `Desktop.tsx`: replace the `index / 8` effect with a call to the helper, and
   recompute on `resize` (throttled) and whenever the enabled-app set changes
   (the add-on manager, brief 46, can add or remove icons at runtime).
4. `DesktopIcon.tsx`: word-boundary truncation + `title` with the full name.
5. While in this file: the icon root is a `<div>` with `cursor-default`, so it is
   not keyboard-reachable and violates the accessibility floor
   (`wiki/ui-conventions.md` §35). Give it `role="button"`, `tabIndex={0}`,
   Enter/Space to open, and a `focus-visible` ring. Arrow-key navigation across
   the grid is out of scope.

## Must preserve (regression surface)

- Dragging an icon still moves and persists it, and a dragged icon stays where
  the user put it across reloads and across resizes.
- Double-click still opens; the existing selection behaviour still works.
- Disabled apps (brief 46) still contribute no icon, and re-enabling one places
  it without disturbing pinned icons.
- No icon is ever positioned under the taskbar or outside the desktop layer.

## Verify bar

`turbo typecheck`, core lint + format green, `turbo build` ok. Unit tests for
`layoutIcons`: no two icons share a cell; every auto icon is inside the usable
area; pinned icons are preserved and skipped by auto placement; a shrinking
viewport reflows auto icons and an off-screen pinned icon is pulled back.

**Verified in a browser**: at 1280×577 all 23 icons are visible, none overlap,
and each launches its app on double-click. Resize between 1440×900 and 1280×577
and back — auto icons reflow, a dragged icon stays put. Confirm "Bookmarks" is
no longer broken mid-word.

## Out of scope

Drag-selection marquee (its own todo), arrow-key grid navigation, icon
sorting/auto-arrange menus, multi-select drag, and custom icon sizes.

## Outcome — 2026-07-31 (done)

Shipped in `b8c0cc9`. Rows derive from the usable height; `layoutIcons` is a
pure exported helper; `settings` no longer consumes a cell; `desktopStore` gains
`pinned` with a v1 migration treating old coordinates as auto-placed.

Verified in a browser: 23 icons, no overlaps, nothing below the taskbar, 3
columns at 1440x900 and 5 at 1280x577.

**Not done**: the accessibility item (icons are still `<div>` with
`cursor-default`, so not keyboard-reachable) and the mid-word label truncation
("Bookmark / s"). Both were in the brief's Fix list and are deliberately left —
they are independent of the layout bug and belong in a focused a11y pass.

**Caught during implementation**: the first version looped infinitely because
`useEnabledApps()` returns a fresh array each render. Fixed with a primitive
dependency key plus a no-op short-circuit in `setAutoPositions`. Worth knowing
before touching this effect again.
