# Brief 106 — Desktop interaction pack: icon menus, an always-alive background menu, the marquee

> **Outcome (2026-08-07): DONE.** All four defects closed. The dead
> `[data-desktop-icon], [data-widget]` guard is replaced by an early-return on
> `closest('[data-window-id]')` — the attribute `Window.tsx` actually sets — so
> window interiors keep whatever their app decided and the widgets menu stops
> painting over the Terminal's paste and Minesweeper's flag (both pinned by
> probe). Icons own their right-click (`preventDefault` + `stopPropagation`,
> select, open the new **Icon menu**: Open / Auto-arrange icons — the desktop
> had no Open verb at all before). The background menu can no longer be a
> silent no-op: the `null` return is gone and **Change wallpaper** →
> `openApp('settings')` is always there. Auto-arrange = `clearPins()` + the
> hoisted `place()`, same store, same dotfile, no new schema. Selection lifted
> to ephemeral `Desktop` state (`Set<appId>`): click selects, Ctrl+click
> toggles, marquee sweeps (pointer-capture on the icon layer, 4 px threshold,
> pure `marquee.ts` hit-test live during the drag), Ctrl+drag adds, Escape
> clears, Enter opens the set. One deviation worth recording: Escape/Enter are
> a **window** listener, not a handler on the container — after a marquee drag
> nothing inside the desktop holds focus, so a bubbling handler would never
> fire; it skips text entry and defers to a focused icon's own Enter.
> Verified: 11 marquee units, turbo 119/119, and a 24/24 Playwright pass on
> the production bundle — icon menu (not widgets), Open launches,
> drag-then-Auto-arrange restores exact grid coordinates and survives a
> reload, background menu always populated and Change wallpaper lands on
> Settings/Appearance, widget toggle flips `aria-checked`, the band draws and
> two icons highlight live then open on Enter, background click clears, and
> **no desktop menu** appears on a Terminal or Minesweeper right-click.
> The user-filed `desktop-drag-selection` todo is satisfied and moved to
> `todos/promoted/`.

Status: **done 2026-08-07** · From the 2026-08-07 research sweep. MEDIUM ·
CORE only (`Desktop.tsx`, `DesktopIcon.tsx`, `DesktopContextMenu.tsx`,
`desktopStore`, one new pure helper). No backend, no protocol change, no new
deps. Sequenced **after brief 105** — both menus here render through the kit
ContextMenu and the background menu needs its checkbox items. Brief 133
(file drag-move) is sequenced after this so the OS grows one drag model. No
new dotfile store: selection is ephemeral by design; Auto-arrange writes
through the existing `desktop-storage` dotfile, already registered in both
`DOTFILE_KEYS` (`prefs.ts:44`) and `rehydrateDotfileStores`
(`dotfiles.ts:28`) — the brief-49 double-registration trap does not apply.

## Problem

Three defects in one 12-line handler, plus the user-filed marquee todo:

1. **The exclusion guard is dead code.** `Desktop.tsx:131-142` skips the
   desktop menu for targets inside `[data-desktop-icon], [data-widget]` — but
   no element in the repo sets either attribute (the only grep match is the
   selector itself). So right-clicking an app icon opens the *Widgets* menu
   under the cursor, and `DesktopIcon.tsx` has no `onContextMenu` of its own —
   there is no Open verb anywhere on the desktop.
2. **Worse than the sweep recorded: window interiors leak into the handler.**
   Windows are DOM children of the desktop container (`Desktop.tsx:199`), and
   any app that calls `preventDefault` without `stopPropagation` bubbles up:
   the Terminal's right-click paste (`Terminal.tsx:411-417`) and Minesweeper's
   flag (`Minesweeper.tsx:168-171`) each also open the widgets menu — which
   paints *above* the window band, since the menu is `absolute z-[9000]`
   against the band's isolated `z: auto` context (`WindowContainer.tsx:61-65`).
   The file manager's background menu (`FileManager.tsx:373-376`) opens **two
   menus at once**; only its row handlers stop the bubble (`FileList.tsx:129`).
3. **The background right-click can be a silent no-op.**
   `DesktopContextMenu.tsx:45` returns `null` when no widget apps are enabled
   (only calendar, clock and system-monitor declare `widgets:`), but
   `Desktop.tsx:139` has already `preventDefault`-ed — a dead click, the
   failure brief 81 was written to kill.
4. **The marquee todo** (`corpus/todos/desktop-drag-selection.md`, filed
   2026-07-19 from the user's own browser pass) is still true in code:
   selection is per-icon `useState` (`DesktopIcon.tsx:26`) cleared on blur, no
   multi-select, and press-drag on empty wallpaper — the most instinctive
   mouse gesture on a Win7-classic desktop — does nothing.

## Proposed decisions (ungrilled)

- **Icons own their right-click**: `DesktopIcon` gets `onContextMenu`
  (`preventDefault` + `stopPropagation`, select the icon, open an icon menu:
  **Open** — the selected set when several are selected — and **Auto-arrange
  icons**). Rejected: keeping one container handler that re-derives the icon
  from coordinates — the icon already knows itself.
- **Rewrite the background guard instead of wiring the dead attributes**:
  return early when `closest('[data-window-id]')` matches (the attribute
  `Window.tsx:264` already sets), so window interiors keep whatever their app
  decided (paste, flag, a menu of their own); everything else on the desktop —
  background, widgets, notes — always gets the background menu. The
  `[data-desktop-icon], [data-widget]` selector dies. Rejected: stamping the
  attributes to make the old guard true — icons now stop their own bubble,
  and a widget right-click opening the widgets menu is the *correct* outcome,
  so the exclusion would guard nothing. (This resolves the sweep's risk item
  deliberately: today a widget right-click shows this menu by accident; after
  the fix, on purpose.)
- **The background menu always has content**: the Widgets checkbox group
  (when any widget app is enabled) plus **Change wallpaper** →
  `openApp('settings')`. Settings is `NON_DISABLEABLE` (`enabledApps.ts:11`)
  so the item can never dead-end, and Appearance is the top section
  (`Settings.tsx:114-116`) — no section-jump plumbing needed. Rejected: a
  section deep-link payload — that is brief 131's territory and a protocol
  question this brief refuses to open.
- **Auto-arrange = unpin + recompute**, nothing new: a `clearPins()` action on
  `desktopStore`, then the existing placement path (`layoutIcons` over
  non-pinned icons, `Desktop.tsx:76-103`). Same store, same dotfile, same v1
  schema (`pinned` already exists). Rejected: a persisted "arranged" mode
  flag — new state for what one verb expresses.
- **Selection lifts to Desktop component state, ephemeral**: a `Set<appId>`
  in `Desktop.tsx`; `DesktopIcon` takes `selected`/`onSelect` props and loses
  its `useState` and blur-clear. Clears on background click, Escape, and after
  open. The todo's own call stands: selection must not survive a reload, and
  `desktopStore` persists to the prefs dotfile — so it stays out of the store.
  Rejected: persisted selection.
- **Marquee starts only on true background**: `pointerdown` on the icon
  container div with `e.target === e.currentTarget` (presses on icons,
  widgets, notes and windows target other elements — the discriminator
  `Desktop.tsx:135` already trusts), `setPointerCapture` (§48 discipline;
  snipping-tool's `CaptureOverlay.tsx` is the in-repo prior art for
  drag → normalize → hit-test), 4px threshold so a plain click stays a click
  (and clears the selection). Hit-test is pure: store positions + the 64×80
  footprint (`layoutIcons.ts:1-2`) against the normalized rect, live during
  the drag. Rejected: porting `CaptureOverlay` wholesale — it is
  viewport-fixed and dims the screen; the marquee is container-scoped, which
  also keeps it off the taskbar for free (the container ends above it).
- **Ctrl+click toggles membership; Ctrl+drag adds** — the state is lifted
  anyway, and without it multi-select exists only through the marquee.
  Shift-range is rejected: ranges have no meaning on a 2D grid.
- **Enter or double-click on a selected icon opens the whole set** through the
  existing `handleOpen` → `openApp` path per id — the single-instance rule
  keeps holding with zero new open plumbing.

## Fix

1. Pure helper + tests first: `marquee.ts` beside `layoutIcons.ts` —
   normalize an inverted drag rect, intersect icon rects; vitest units
   (inverted drags, edge-touch counts as hit, empty result).
2. `desktopStore.ts`: add `clearPins()` (sets `pinned: false` on all —
   same persisted shape, no migration).
3. `DesktopIcon.tsx`: `selected`, `onSelect(e)`, `onContextMenu` props;
   delete the local `useState(selected)` and the blur-clear.
4. `Desktop.tsx`: selection state + handlers (click selects one, Ctrl+click
   toggles, Escape clears, Enter opens the set); marquee pointer handlers on
   the icon container; render the rubber band (`border-primary bg-primary/10`
   — token opacity, no invented colour) with a `data-testid` for probes.
5. `Desktop.tsx` `onContextMenu`: replace the dead selector with the
   `[data-window-id]` early-return; otherwise always `preventDefault` and
   open the background menu. Add icon-menu state fed by `DesktopIcon`.
6. `DesktopContextMenu.tsx`: render through the brief-105 kit; drop the
   `null` return; add Change wallpaper; widgets stay checkbox items. Icon
   menu items (Open / Auto-arrange) live beside it.
7. Hoist the `place()` closure out of the layout effect so Auto-arrange can
   call `clearPins()` + `place()` without duplicating the maths.

## Must preserve (regression surface)

- Icon drag-to-pin: framer drag with the clamped commit
  (`DesktopIcon.tsx:49-62`); a press on an icon never starts a marquee, and
  dragging one icon moves only that icon, selected or not — multi-drag is
  brief 133/134 territory.
- Widget drag/remove and sticky-note interactions — their own pointer
  handlers own their presses.
- Right-click inside any window never opens the desktop menu (this brief's
  fix — pin it with the Terminal-paste and Minesweeper-flag probes).
- Keyboard per icon: Tab focus, Enter/Space opens (`DesktopIcon.tsx:75-80`),
  visible focus ring.
- `openApp` stays the single launch path (`Desktop.tsx:105-116` — the
  brief-85 duplicate-Calculator bug stays dead).
- `settings` stays off the desktop grid (`Desktop.tsx:54-57`); auto-layout
  still never overwrites a pin except through the explicit Auto-arrange verb.

## Verify bar

`turbo typecheck`, lint + format, `turbo test`, `turbo build` green. No
backend touched — no backend tests. New core vitest units per Fix 1.

**Verified in a browser** (production bundle + real backend): right-click the
Calculator icon → Open + Auto-arrange (not widgets); Open launches it. Drag
two icons into corners, Auto-arrange → grid order restored and a reload keeps
it (the dotfile round-trip). Disable calendar + clock + system-monitor →
background right-click still shows a menu; Change wallpaper lands in Settings
with Appearance visible. Re-enable, toggle a widget from the menu —
`aria-checked` flips and the widget appears. Drag on empty wallpaper → rubber
band visible, two intersected icons highlight live; Enter opens both apps;
click on empty background clears. Right-click in the Terminal pastes and
right-click-flag in Minesweeper plants a flag — screenshots show **no**
desktop menu either time. An icon drag still pins across reload. Console
clean throughout.

## Out of scope

Files on the desktop (brief 134); dragging files onto folders (133); a
marquee inside the file manager; Shift-range select; marquee-selecting
widgets or notes; multi-icon group drag; Settings section deep-links (131);
any `system.ts` member.
