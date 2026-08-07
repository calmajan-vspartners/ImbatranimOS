# Brief 103 — Window management parity 2: reflow on viewport resize, and the missing reflexes

> **Outcome (2026-08-07): DONE.** Built as specced. `reflowToViewport()` is a
> store method fed by a module-level `setMinSizeResolver` (App.tsx registers
> the APP_REGISTRY lookup at boot; the store stays decoupled from the manifest
> graph) — maximized windows refill the usable desktop, snapped windows
> retile via `computeSnapGeometry`, floaters shrink only when overflowing and
> clamp position to keep the title bar reachable (`TITLEBAR_MIN_VISIBLE = 28`
> now a shared export; the drag clamp uses it too), and a no-op reflow
> returns the SAME windows array so the persist debounce never writes.
> Callers: a 200 ms trailing-debounced resize listener + one boot pass after
> `restoreLayout()`; `restoreWindow`/`unsnap` also re-clamp saved geometry.
> Keyboard snapping is `mod+alt+shift+arrows` over a pure `nextSnapState`
> table (maximized+up = none, not a redundant maximize; floating/bottom+down
> minimizes); show desktop `ctrl+alt+d` with a per-workspace stash restored
> in stacking order (window-opened-between-presses hides again, Windows
> style); `ctrl+alt+1..4` jumps (what the pip tooltips always promised) and
> `ctrl+alt+shift+1..4` carries, firing via the new `e.code DigitN` matcher
> extension (Shift+1 = `!` in e.key); digits documented as two family rows.
> Double-click titlebar toggles maximize (controls stop dblclick propagation
> like click); taskbar menu gained Maximize/Restore (menu height bumped,
> Taskbar's string-projected selector gained the isMaximized bit). Verified:
> 24 new units (reflow ×4 incl. no-churn identity, snap table ×4, show
> desktop ×3, digit matcher ×5 …), turbo 119/119, Playwright 14/14 on the
> production bundle — maximized 1400×856 → 1000×656 exactly on viewport
> resize, snapped half 700→500, quarter sequence, workspace jump/carry by
> number, show-desktop round trip, menu row, all rows in the ?-overlay.

Status: **done 2026-08-07** · From the 2026-08-07 research sweep. EASY · CORE
only (`windowStore.ts`, `Window.tsx`, `useWindowHotkeys.ts`, `useGlobalHotkeys.ts`,
`App.tsx`, `TaskbarContextMenu.tsx`). No backend, no protocol change
(`packages/ui/src/system.ts` untouched), no new deps, nothing stored (layout
stays brief-49 sessionStorage — no dotfile). Ships brief 52's own recorded
deferral; builds on brief 85 (workspaces) and brief 86 (shortcut registry).
Brief 104 edits the same hotkeys file — land separately, either order. Brief
131's palette verbs will call the store methods added here, so they must be
store methods, not hook-locals.

## Problem

1. **Nothing ever re-clamps a window after the viewport changes** — the
   deferral brief 52 recorded in its own outcome. `maximizeWindow` snapshots
   `window.innerWidth/innerHeight` at call time (`windowStore.ts:505-533`);
   `computeSnapGeometry` likewise (`:229-258`); `restoreLayout` restores
   persisted geometry verbatim (`:716-744`). The only resize listener in core
   re-lays desktop *icons* (`Desktop.tsx:92-103`). On a browser desktop the
   viewport resizes constantly — devtools, half-screen snap of the host window,
   projector. Afterwards a "maximized" window overflows past the taskbar or
   leaves a gap, snapped halves stop tiling, and a floater's title bar can end
   up off-screen and unrecoverable — windows have no window-level scroll by
   design.
2. **The reflexes every desktop user carries are missing.** No double-click
   titlebar maximize — the title-bar div binds drag only (`Window.tsx:282-291`).
   The full snap machinery exists (`computeSnapGeometry` `:229-258`,
   `snapWindow` `:650-680`) but is reachable only by pointer-dragging to a
   screen edge — none of the six registered window hotkeys
   (`useWindowHotkeys.ts:90-136`) snaps. No show-desktop anywhere (grep for
   `showDesktop`/`minimizeAll`: zero hits).
3. **A shipped lie.** Every workspace pip advertises `Ctrl+Alt+${id}` in its
   tooltip (`WorkspacePips.tsx:46`), but only `ctrl+alt+left/right` are bound
   (`useWindowHotkeys.ts:123-135`). Ctrl+Alt+1..4 does nothing today — an
   advertised shortcut that never fires is bug-grade, not a feature gap.
4. Small but same family: the taskbar button's right-click menu offers only
   Minimize/Close (`TaskbarContextMenu.tsx:93-96`) — no Maximize/Restore row.

## Proposed decisions (ungrilled)

- **Reflow is a store method with an injected minSize resolver** —
  `reflowToViewport(minSizeFor)`; App.tsx passes `appId → APP_REGISTRY` minSize
  with the `{240,180}` fallback `WindowContainer.tsx:128` already uses.
  Rejected: importing `APP_REGISTRY` into `windowStore` — couples the store to
  the whole manifest graph and risks an import cycle for one lookup.
- **Conservative floater policy, brief 52's own words**: shrink only what now
  overflows, move only what would otherwise be unreachable. `minSize` still
  wins over the viewport (`clampToDesktop`, `windowStore.ts:79-107`) — an
  honest minimum may overflow, but its position clamps so the title-bar row
  stays reachable. Rejected: re-centering everything (destroys the arrangement
  the user made).
- **One reflow function, two callers**: a debounced shell resize listener, and
  a boot pass right after `restoreLayout()` (which fixes restoring a layout
  saved at a different resolution). Rejected: a second clamp implementation
  inside `restoreLayout` — two copies of one rule drift.
- **Keyboard snap = `mod+alt+shift+arrows`.** The obvious `mod+alt+arrows` is
  a genuine collision: on non-Mac `mod` *is* Ctrl, so `mod+alt+left` matches
  the same physical keys as the shipped `ctrl+alt+left` workspace switch — and
  each `useRegisteredHotkeys` call installs its own listener, so both handlers
  would fire on one keypress. Rejected: rebinding brief 85's shipped workspace
  arrows to free the two-modifier chord (churns shipped muscle memory).
- **Quarters by sequence, Windows semantics** — arrows move the window between
  regions (left half + up → `tl`; half + down → bottom quarter; floating + up
  → maximize; maximized + down → restore), encoded as a pure
  `nextSnapState(prev, dir)` whose full table is the unit test's job.
  Rejected: eight distinct chords, one per region (unlearnable).
- **Show desktop = `ctrl+alt+d`** (GNOME's classic; `mod+d` is the browser's
  bookmark key), a store toggle: any visible window on the active workspace →
  stash ids and hide all; none → restore the stash. The rule self-handles a
  window opened between the two presses — it makes "any visible" true, so the
  second press hides again, as Windows does. Rejected: a hook-local ref
  (brief 131's palette verb needs to call it).
- **Jump = `ctrl+alt+1..4`, exactly as the pip tooltip already promises; carry
  = `ctrl+alt+shift+1..4`** via `moveWindowToWorkspace`, which follows and
  focuses by design (`windowStore.ts:637-648`). Rejected: carry-on-arrows
  (prev/next carry) — carry-by-number is strictly more direct and keeps the
  map small.
- **Fix the matcher for shift+digit first**: `eventMatchesBinding` compares
  `e.key` only (`useGlobalHotkeys.ts:56-73`) and Shift+1 produces `!`, so the
  carry bindings would never match. Extend digit matching to accept
  `e.code === 'DigitN'`. Rejected: binding `ctrl+alt+shift+!` (US-layout-only).
- **Digit families bind individually but document as two rows** ("Ctrl+Alt+1…4",
  "Ctrl+Alt+Shift+1…4") via `useDocumentedShortcuts` — the
  `editing.markdown-format` family-row precedent (`App.tsx:61-72`). Rejected:
  eight literal overlay rows (noise that buries the rest of the list).
- **Double-click titlebar toggles maximize/restore** through the existing
  `handleMaximizeToggle` (`Window.tsx:198-208`). Rejected: double-click-to-shade
  (not the Win7-classic reflex).

## Fix

1. `windowStore.ts`: add `reflowToViewport(minSizeFor)` — maximized windows
   get the full usable desktop again; snapped windows re-apply
   `computeSnapGeometry(w.snapState)`; floaters get
   `clampToDesktop(currentSize, minSize, viewport)` (shrink-only by
   construction) plus a position clamp keeping at least the title-bar row
   reachable (reuse the drag path's 28px constant, `Window.tsx:176`, as an
   exported const rather than a third magic number).
2. `windowStore.ts`: clamp saved geometry when applying it in `restoreWindow`
   (`:535-564`) and `unsnap` (`:682-709`) — `preMaximizeStates`/`preSnapStates`
   hold pre-resize positions that can otherwise restore off-screen.
3. `App.tsx`: trailing-debounced (~200ms) `resize` listener calling the reflow,
   and one reflow call after `restoreLayout()` in the boot effect (`:99-102`).
   The 500ms persist debounce (`:104-121`) then coalesces the writes.
4. `Window.tsx`: `onDoubleClick` on the title-bar div (`:282-291`) →
   `handleMaximizeToggle`; the controls container must stop double-click
   propagation the way it already stops click (`:306-309`).
5. `windowStore.ts`: `toggleShowDesktop()` + the per-workspace stash field;
   restore in ascending stashed z-order so stacking survives the round trip.
6. `useGlobalHotkeys.ts`: the `e.code` digit extension, tested in
   `hotkeyMatching.test.ts`.
7. `useWindowHotkeys.ts`: register through `useRegisteredHotkeys` — four snap
   bindings driving `nextSnapState` on the focused window, and show-desktop;
   bind the eight digit hotkeys via `useGlobalHotkeys` and document the two
   family rows via `useDocumentedShortcuts`. All rows appear in the ?-overlay
   and Settings automatically (brief 86).
8. `TaskbarContextMenu.tsx` (`:93-96`) + `Taskbar.tsx`: add a Maximize/Restore
   `MenuRow` above Minimize, wired to `maximizeWindow`/`restoreWindow`.

## Must preserve (regression surface)

- The `minSize`-wins rule (`windowStore.ts:79-95`): reflow never shrinks below
  an honest `minSize`; overflow stays legal, only position clamps.
- The debounced persist path (`App.tsx:104-121`): dragging the browser's own
  resize handle must not write sessionStorage per frame or jank.
- Shipped bindings byte-identical: `alt+tab`, `mod+w/m/enter`,
  `ctrl+alt+left/right` (brief 85). The registry's dev duplicate warning
  (`shortcutRegistry.ts:38-48`) stays silent — no new binding collides.
- Pointer-drag snapping (`detectSnapRegion`, `SnapOverlay` preview) and the
  `snapWindow`/`unsnap` round trip; reflowing a snapped window must not
  clobber its `preSnapStates` entry.
- `restoreLayout` still regenerates ids and defaults workspaces
  (`windowStore.ts:722-735`); the boot reflow must not reorder z or steal focus.
- Win7-classic identity: reflow is instant, no animation flourishes.

## Verify bar

`turbo typecheck`, lint + format, `turbo test`, `turbo build` green. No backend
touched — no backend tests. New core vitest units: reflow (maximized
recomputes; snapped retiles; floater shrinks only when overflowing; minSize
overflow keeps the title bar reachable), the `nextSnapState` table, the
`e.code` digit matcher, and `toggleShowDesktop` round-trip including the
window-opened-between-presses case.

**Verified in a browser** (production bundle + real backend): maximize one
window, snap another left, then change the viewport size — the maximized
window fills the new usable area exactly to the taskbar line and the snapped
half retiles; a floater parked near the right edge stays reachable after a
shrink. Double-click a title bar to maximize, again to restore. `Ctrl+Alt+2`
switches to workspace 2 (the pip the tooltip always promised);
`Ctrl+Alt+Shift+3` carries the focused window and follows it. `Ctrl+Alt+D`
clears the desktop; a second press brings the same stack back in order. The
?-overlay lists every new binding; the taskbar menu shows Maximize/Restore.

## Out of scope

The Alt+Tab overlay (brief 104). Palette verbs for these actions (brief 131 —
the store methods added here are its seam). Shortcut rebinding UI (parked in
the backlog until 103/104 settle the default map). Multi-monitor, remembering
pre-shrink sizes to grow back, touch gestures, and any `system.ts` protocol
member — everything here is core-internal.
