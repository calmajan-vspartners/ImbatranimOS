# Brief 104 — Alt+Tab switcher: see where you are going

> **Outcome (2026-08-07): DONE.** Built as specced. Pure core first
> (`switcherModel.ts`): `switcherOrder` (z-descending = MRU for free,
> minimized included, workspace-scoped) + `openOrAdvance`/`commitTarget`
> (open starts at index 1 — the pairwise-toggle fix; opening backwards starts
> at the far end; wrap both ways) with 10 DOM-free units. `AltTabSwitcher`
> owns its own listeners (keyup semantics — the hotkey plumbing is
> keydown-only): Alt+Tab opens/advances, Shift retreats, arrows move, Enter
> or Alt-keyup commits, Esc cancels, window blur COMMITS the shown selection;
> gated on `isShellSuspended()` (the brief-101 chokepoint rule applies to any
> new global listener). Selection is component state — the store is untouched
> until commit, which is `showWindow`-if-minimized + `focusWindow`, the
> taskbar's own path. The old blind `window.cycle` registration is deleted
> (two owners of alt+tab would both fire); the two bindings are documented
> rows with the host-OS interception note. Flat icon+title strip, accent
> border on the selected cell, `(minimized)` suffix, z-10001. Verified:
> turbo 119/119, Playwright 15/15 on the production bundle — quick tap
> toggled the last two windows, two Tabs reached the third, Shift retreated
> with wrap, Esc left focus byte-identical, the minimized window was listed
> and restored on commit, overlay gone after keyup.

Status: **done 2026-08-07** · From the 2026-08-07 research sweep. MEDIUM ·
CORE only (a new shell overlay component, `useWindowHotkeys.ts`, `App.tsx`).
No backend, no protocol change (`packages/ui/src/system.ts` untouched), no new
deps, nothing stored (no dotfile — selection is transient component state).
Uses brief 86's registry for discoverability. Brief 103 edits the same hotkeys
file — land separately, either order.

## Problem

Alt+Tab exists and is blind roulette. `cycle` silently focuses the next window
in ascending z-order (`useWindowHotkeys.ts:38-50`) — no overlay, no way to see
where you will land, and no reverse: the registered bindings (`:90-136`) have
no `alt+shift+tab`. With four or five windows open you discover where you
landed only after focus moves.

It is also the *wrong* order, twice over:

1. A single Alt+Tab lands on the **least**-recently-used window — the sorted
   list is ascending by z, the focused window is last, and `(idx + 1) % len`
   wraps to index 0, the oldest. Quick-toggling between the last two windows,
   the single most common switch on any desktop, does not work at all today.
2. Cycling calls `focusWindow` per step, and `focusWindow` mints a new top
   zIndex (`windowStore.ts:566-592`) — every step rewrites the recency order
   being traversed, and each step feeds the debounced layout persist
   (`App.tsx:104-121`). An MRU switcher cannot be built on repeated
   `focusWindow`; this is why the overlay is its own brief, not a 103 line.

Two more gaps: minimized windows are excluded (`getCandidates` filters
`isVisible`, `useWindowHotkeys.ts:31-34`), so a minimized window is unreachable
by keyboard entirely. And hold-and-release semantics cannot be expressed
through the hotkey plumbing — `useGlobalHotkeys` is keydown-only
(`useGlobalHotkeys.ts:97-116`; no keyup listener exists anywhere in core).

## Proposed decisions (ungrilled)

- **MRU is zIndex descending — no new bookkeeping.** `focusWindow` mints a
  monotonically increasing zIndex on every focus, so the existing z stack *is*
  the recency list, minimized windows included (a hidden window keeps the z it
  had when last focused). Commit goes through `focusWindow`, which promotes the
  chosen window to the top — the MRU maintains itself. Rejected: a separate MRU
  array in the store — a second copy of the ordering that must be kept in sync
  with every focus path, i.e. a drift machine.
- **Selection is component state; the store is untouched until commit.** Esc
  cancel is simply closing the overlay — z-order, persist payload and focus
  stay byte-identical. Rejected: focus-as-you-cycle with revert on Esc (store
  writes and persist churn per step, and the revert mints yet another z,
  corrupting the MRU — today's bug, kept).
- **Hold-Alt semantics, owned by the component.** One permanent keydown
  listener (the `ShortcutsOverlay` precedent, `:73-88`): Alt+Tab opens or
  advances, Shift retreats, arrows also move, Enter or Alt-keyup commits, Esc
  cancels. `window` blur **commits** the visible selection — if the host OS
  stole focus mid-switch the Alt keyup is never delivered, and eating the
  user's switch reads worse than honoring what the overlay showed. Rejected:
  cancel-on-blur.
- **Start at the second-most-recent entry**, so a quick tap toggles the last
  two windows — the direct fix for today's lands-on-LRU behavior.
- **Minimized windows are included**; commit is `showWindow` + `focusWindow`,
  the taskbar's own click path (`Taskbar.tsx:81-92`). The overlay is what makes
  including them safe — you can see you are about to land on one. Rejected:
  visible-only, today's rule, which leaves minimized windows
  keyboard-unreachable.
- **Workspace-scoped**, like the binding it replaces and like the per-workspace
  taskbar (brief 85); other desktops stay reachable via pips and
  `ctrl+alt+left/right`. Rejected: cycling across all workspaces — commit
  would yank the user between desktops mid-switch and contradict the brief-85
  model everywhere else.
- **Registered via `useDocumentedShortcuts`, not `useRegisteredHotkeys`** — the
  binding is owned by the component because of the keyup semantics, which is
  exactly the documented `mod+s` pattern (`useRegisteredHotkeys.ts:19-39`).
  Carry the honest note that the host OS/browser usually owns Alt+Tab outside
  the kiosk ISO — the `mod+w` note precedent (`useWindowHotkeys.ts:105`).
- **Look: a flat strip of icon+title cells**, icons resolved from
  `APP_REGISTRY` the way the taskbar does (`Taskbar.tsx:154-155`), selected
  cell carrying the accent border, house tokens throughout. Rejected:
  Aero-glass live thumbnails — needs window snapshotting, and glass is not the
  B&W-plus-accent Win7-classic identity.

## Fix

1. Pure helpers + tests first: `switcherOrder(windows, activeWorkspace)`
   (z-descending, visible **and** minimized, workspace-filtered) and a small
   reducer for the open/advance/retreat/commit/cancel state machine — vitest
   units with no DOM.
2. New `apps/core/src/shared/components/switcher/AltTabSwitcher.tsx`, mounted
   once in `App.tsx` beside `ShortcutsOverlay` (`:161`). Permanent keydown
   listener for Alt+Tab / Alt+Shift+Tab (preventDefault both); while open, a
   keyup listener (Alt → commit), Escape, Enter, arrow keys, and a `blur`
   handler that commits. Fixed, centered, above every window — the taskbar is
   z-9000 and its menu 10000; use that top layer. `data-testid` for probes.
3. Commit path: `showWindow(id)` when the target is minimized, then
   `focusWindow(id)` — never around the store, so the brief-85
   workspace-follow invariant in `focusWindow` keeps holding.
4. `useWindowHotkeys.ts`: delete `cycle` and its `window.cycle` registration
   (`:38-50`, `:91-97`). Two owners of `alt+tab` would both fire — every
   `useRegisteredHotkeys` call installs its own window listener.
5. Register `alt+tab` and `alt+shift+tab` rows (scope `Window management`)
   via `useDocumentedShortcuts`, with the host-OS interception note.
6. Degenerate cases: zero candidates → the overlay does not open; one → it
   opens showing the single window and commit is a no-op.

## Must preserve (regression surface)

- Every other `useWindowHotkeys` binding (`mod+w/m/enter`,
  `ctrl+alt+left/right`) — untouched behavior, and the registry's dev
  duplicate warning (`shortcutRegistry.ts:38-48`) stays silent.
- `focusWindow`'s workspace-follow and focus-guard behavior
  (`windowStore.ts:566-592`) — commit uses it, never reimplements it.
- No store mutation while cycling or on cancel: an Esc'd switch leaves
  z-order, the persisted layout and focus exactly as they were.
- Plain Tab everywhere: the switcher's listener acts only on Alt-modified Tab,
  so Tab in text fields — and every keystroke in the Terminal's hidden
  textarea — is untouched.
- The ?-overlay keeps exactly one row per binding after the `window.cycle`
  removal; no orphaned "Cycle focus" row.

## Verify bar

`turbo typecheck`, lint + format, `turbo test`, `turbo build` green. No backend
touched — no backend tests. New core vitest units: `switcherOrder`
(z-descending, minimized included, workspace filter) and the state machine
(quick-tap commits the second-most-recent; retreat wraps; Esc cancels with
zero store writes).

**Verified in a browser** (production bundle + real backend; Playwright's
synthetic `keyboard.down('Alt')` + `press('Tab')` sidesteps host Alt+Tab
interception, so the probe is not blocked by what real browsers steal): open
three apps focused in order A, B, C. Hold Alt, one Tab — the overlay lists
three icon+title cells with B selected; release — B is focused. A quick
Alt+Tab tap now toggles back to C (the pairwise switch that never worked).
Hold with two Tabs → A; Alt+Shift+Tab moves the selection back; Esc leaves
focus where it was. Minimize B from the taskbar: Alt+Tab still lists it, and
committing restores and focuses it. After keyup the overlay is gone from a
screenshot.

## Out of scope

Live window thumbnails or previews (needs snapshotting; cost without
Win7-classic value). Cross-workspace cycling (pips and `ctrl+alt+left/right`
own that). Taskbar hover previews, shortcut rebinding, touch gestures. The
rest of the parity pack (brief 103). Any `system.ts` protocol member — the
switcher is core shell, invisible to apps.
