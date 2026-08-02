# Brief 52 — Clamp a new window to the desktop it opens on

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
EASY · CORE (`apps/core/src/shared/store/windowStore.ts`). Standalone — land it
first; briefs 55–78 defer their own clipping to this fix rather than each app
shrinking its `defaultSize` separately.

## Problem

**Reproduced live** in a browser at 1280×577 (a common laptop viewport): the
Calendar window's last week row — `30 31 1 2 3 4 5` — is rendered *underneath*
the taskbar and cannot be reached, and the Todo app's input is cut the same way.
The 2026-07-19 walkthrough saw the same thing on Calculator, whose `0 . =` row
was fully unreachable.

The cause is one line. `openWindow` clamps the *position* carefully:

- `windowStore.ts:188` — `maxY = window.innerHeight - TASKBAR_HEIGHT - minSize.height`
- `windowStore.ts:191-201` — x/y are clamped so at least `minSize` stays on screen

…and then ignores all of that when setting the size:

- `windowStore.ts:211` — `size: { width: defaultSize.width, height: defaultSize.height }`

So a window is *placed* as though it were `minSize` and then *rendered* at
`defaultSize`. Whenever `defaultSize.height > innerHeight - 44`, the overflow is
unreachable: the desktop layer is `bottom-[44px] overflow-hidden`
(`desktop/Desktop.tsx:71`) and there is no window-level scroll by design
(`wiki/ui-conventions.md` §19).

Several apps ship a `defaultSize.height` that cannot fit a 577px viewport at
all, so this is not a rare edge: it is every short laptop, every split screen,
and the 1280×577 kiosk case.

## Proposed decisions (ungrilled)

- **Clamp size to the usable desktop at open time**, in `openWindow` — one
  place, not per app. Usable area is `innerWidth × (innerHeight - TASKBAR_HEIGHT)`.
- **`minSize` wins over the clamp.** If an app's honest minimum genuinely does
  not fit the viewport, respect `minSize` and let it overflow rather than
  render a squashed, broken layout. That case should be rare and is the app's
  bug to fix (`ui-conventions.md` §20 requires an honest `minSize`).
- **Position is computed from the clamped size**, not from `minSize`, so a
  centred window is actually centred and never starts off-screen.
- **Re-clamp on viewport resize is IN scope but conservative**: on `resize`,
  only shrink windows that now extend past the usable area, and never move a
  window the user has positioned unless it would otherwise be unreachable.
  Rationale: the bug is just as reachable by resizing the browser as by opening
  small, and a user who has lost a button cannot get it back today.
- **Rejected — making every app's `defaultSize` smaller.** It treats 24 symptoms,
  regresses the roomy default on large screens, and silently breaks again the
  next time a viewport gets shorter than someone assumed.
- **Rejected — a window-level scrollbar.** Contradicts the house rule that
  scrolling lives inside the app body, and a scrollbar around window chrome is
  not the Win7-classic identity.

## Fix

1. In `openWindow` (`windowStore.ts:181`), before building the instance:
   ```ts
   const availW = window.innerWidth
   const availH = window.innerHeight - TASKBAR_HEIGHT
   const width = Math.max(minSize.width, Math.min(defaultSize.width, availW))
   const height = Math.max(minSize.height, Math.min(defaultSize.height, availH))
   ```
   Use `width`/`height` both for the position clamp (replacing the `minSize`
   terms at `:188`, `:191`, `:200-201`) and for `size` at `:211`.
2. Extract the clamp as an exported pure helper (e.g. `clampToDesktop`) so it is
   unit-testable without a DOM and reusable by the resize handler and by
   `restoreLayout` (`windowStore.ts`), which can otherwise restore a persisted
   oversized geometry straight back into the same broken state.
3. Add the resize handler in the shell (where the desktop is mounted), throttled,
   calling a new `reflowWindows()` store action that applies the same helper.
4. `TASKBAR_HEIGHT` is currently declared twice — `windowStore.ts:27` and
   `taskbar/Taskbar.tsx:11`. Use the store's export in both; do not add a third.

## Must preserve (regression surface)

- Maximize / restore / snap (`snapWindow`, the half- and quarter-screen regions
  at `windowStore.ts:86-110`) already compute against `innerHeight - TASKBAR_HEIGHT`
  — they must keep working and must not be double-clamped.
- The cascade jitter (`CASCADE_JITTER_PX`) still offsets stacked windows.
- A window the user has explicitly resized larger stays that size until the
  viewport actually forces a shrink.
- `restoreLayout()`/`persistLayout()` round-trip.

## Verify bar

`turbo typecheck`, core lint + format green, `turbo build` ok. Unit tests for
`clampToDesktop`: default fits (unchanged), default too tall (clamped to
`availH`), `minSize` larger than viewport (`minSize` wins), width likewise.

**Verified in a browser** (this is now cheap — the OS runs locally, see
`wiki/running-locally.md`): at 1280×577 open Calendar, Todo, Calculator and
Sheets; every control including Calendar's last week row, Todo's input and
Calculator's `0 . =` row must be visible and clickable without resizing. Then
shrink the browser window with them open and confirm they reflow rather than
lose controls. The repo's walkthrough harness reports `CLIPPED[...]` per app and
must come back empty.

## Out of scope

Snapping/tiling improvements, Alt+Tab, workspaces, per-app `defaultSize` tuning,
and remembering a per-app last-used size.
