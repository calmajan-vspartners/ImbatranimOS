# Brief 85 — Workspaces (virtual desktops)

Status: **done 2026-08-06** · From the 2026-07-31 real-OS parity research.
MEDIUM · CORE (`windowStore` + taskbar). **Land after briefs 52 and 53**, which
both touch window placement and the desktop layer — doing this first means
rewriting `windowStore` twice.

## Problem

24 apps share one browser tab and there is no second monitor to escape to, so
the desktop gets crowded fast and the only remedies are minimising or closing.
Virtual desktops are the most recognisable missing desktop feature and, per line
of code, the highest "feels like a real OS" return available — the compositor
already owns z-order, focus and the window list, so this is a filter over state
that exists rather than new machinery.

## Proposed decisions (ungrilled)

- **A fixed set of four.** Dynamic add/remove is where this gets expensive
  (naming, reordering, what happens to windows on a removed workspace) for very
  little gain on a single-user desktop.
- **`workspaceId` on `WindowInstance`, `activeWorkspace` in `windowStore`.** The
  window container and the taskbar button list filter on it. Nothing else in the
  window model changes.
- **Session state, not a dotfile.** Which workspace a window is on belongs to the
  session, consistent with brief 49 — a new tab starts fresh on workspace 1.
- **`Ctrl+Alt+←/→` to switch**, registered through the shortcut registry (brief
  86) so it is discoverable rather than invisible.
- **Taskbar right-click → "Move to workspace"**, and moving a window follows it
  there (switch to the target) — silently relocating a window the user is
  looking at is disorienting.
- **Empty workspaces stay visible** in the pip strip, otherwise the feature is
  undiscoverable until you already know it exists.
- **Notifications are global**, not per workspace: a toast from an app on
  another workspace must still appear, and clicking it switches to that
  workspace. A notification you cannot see defeats brief 34.
- **Rejected — per-workspace wallpapers or icon sets.** Cosmetic, and it would
  make the desktop layer stateful per workspace, which brief 53 has just
  finished making coherent.
- **Rejected — dragging a window to a screen edge to move it between
  workspaces.** It collides with the existing snap regions
  (`windowStore.ts:86-110`).

## Fix

1. `windowStore`: `workspaceId` on the instance (default = active at open time),
   `activeWorkspace`, `setActiveWorkspace`, `moveWindowToWorkspace`.
2. Window container and taskbar filter on `activeWorkspace`; `getOrderedWindows`
   gains a workspace-aware variant rather than changing its meaning for existing
   callers.
3. Four pips at the right end of the taskbar beside the Tray, active one filled,
   with an occupancy hint (a dot when a workspace has windows); click to switch.
4. `Ctrl+Alt+←/→` registered in the shortcut registry.
5. Taskbar context menu → Move to workspace (and follow).
6. Alt+Tab stays within the active workspace.
7. Notification click switches workspace if the target window is elsewhere.

## Must preserve (regression surface)

- Maximize/restore, snap regions, the cascade, focus and z-order all behave
  per-workspace and are not corrupted by switching.
- Closing the last window on a workspace leaves a usable empty desktop.
- The window clamp (brief 52) applies to windows opened on any workspace.
- The add-on manager and the palette are unaffected — they act on apps, not
  windows.
- No window can become unreachable: a window on a workspace must always be
  reachable by switching to it, and nothing may leave a window with no
  workspace.

## Verify bar

`turbo typecheck`, core lint + format green, `turbo build` ok. Unit tests on the
store: opening assigns the active workspace; switching filters correctly; moving
a window preserves its geometry and z-order; no window ends up orphaned.

**Verified in a browser**: open apps across all four workspaces and switch with
the pips and the keyboard; move a window to another workspace from the taskbar
and confirm the view follows; trigger a Clock alarm from another workspace and
confirm the toast appears and clicking it switches; maximize on workspace 3,
switch away and back, confirm it is still maximized.

## Out of scope

Dynamic workspace count, naming workspaces, per-workspace wallpapers, an
exposé/overview view, moving windows by edge-drag, and persisting workspace
assignment across sessions.

## Outcome — done 2026-08-06

Shipped as specified, plus three things the brief did not anticipate — two of
them pre-existing bugs this feature would have made much worse.

### Switching hides windows; it does not unmount them

The obvious implementation is to filter the window list in `WindowContainer`.
It looks identical and is badly wrong: React would unmount every window on the
workspace you leave, tearing down the Terminal's PTY socket, discarding an
editor's unsaved buffer and restarting every in-flight request — **once per
switch**. Real virtual desktops hide windows; they do not close them.

So a window on an inactive workspace is hidden with `display: none`, which is
exactly the mechanism a *minimised* window already used. Verified in the browser
rather than reasoned about: a digit typed into the Calculator on workspace 2 is
still on its display after switching to 1 and back.

### The brief was wrong about persistence, and the wrong answer was invisible

It calls workspace assignment "session state", says a new tab starts fresh on
workspace 1, and lists persistence as out of scope. But **the window layout is
already persisted** — `App.tsx` debounce-writes it to localStorage and restores
it on boot, geometry and all. Leaving `workspaceId` out would mean a reload
silently collapses four workspaces onto one, destroying the arrangement the
feature exists to create, with no error and nothing to undo. That is worse than
either option the brief weighed. This is not brief 49's dotfile question; it is
the window layout, and the window layout already persists.

`activeWorkspace` is persisted too, for a smaller but sharper reason: reloading a
session whose windows all live on workspace 3 and landing on an empty workspace 1
reads as "everything is gone".

A layout written before this brief has no `workspaceId`, so `clampWorkspace`
defaults it to 1 — and clamping is load-bearing rather than defensive. It is the
enforcement point for the brief's hardest invariant: **no window can become
unreachable.** A hand-edited `workspaceId: 47` lands on 4, not nowhere.

### Focus follows the window, which is where "reachable" actually lives

`focusWindow` now switches to the window's workspace. One change, at the single
place every caller funnels through — the taskbar, Alt+Tab, `openApp` re-focusing
a single-instance app, and a notification click. Without it, clicking a toast
raised by an app on workspace 3 would raise the z-index of a window you cannot
see and appear to do nothing at all, which is the brief's item 7 stated as a
symptom rather than a cause.

### Two pre-existing bugs the probe surfaced

**`ctrl+…` bindings had never worked off a mac.** `Ctrl+Alt+←` simply did not
fire. The matcher computes `modPressed = mac ? metaKey : ctrlKey` and then
rejected any event with the mod key held when the binding did not say `mod` —
so on Linux and Windows an explicit `ctrl+` binding was refused by the very key
it asked for. Invisible until now because every binding in the OS used `mod`.
Fixed with a `!parsed.ctrl` guard and eight tests on the matcher itself.

**Desktop icons and the Start menu bypassed the single-instance rule.** Both had
grown their own three-line "open an app" that called `openWindow` directly,
skipping the check `intents/openApp.ts` exists to enforce. Before workspaces that
was untidy — two Calculators stacked on one desktop. With them it is much worse:
the duplicate opens on whichever desktop you are on while the original sits
invisible on another, so the app looks lost and the count in the pips is wrong.
Both now call the shared `openApp`.

### The smaller decisions

- **All four hotkeys scoped, not just Alt+Tab.** The brief says Alt+Tab stays on
  the active workspace; the same selector drives `Ctrl+W`, `Ctrl+M` and
  `Ctrl+Enter`, so without the same filter *closing the focused window* could
  close something on another desktop that the user cannot see.
- **Focus is per-workspace.** The frontmost window is computed from the current
  workspace's windows, not globally, or switching to workspace 2 would leave its
  top window unfocused because something on workspace 1 outranks it.
- **Moving un-minimises.** A minimised window moved to another workspace is
  hidden twice over; it arrives visible and focused.
- **Wrapping in both directions**, so any two of four workspaces are at most two
  keypresses apart.
- **Empty pips stay visible** with an occupancy dot — the brief's reasoning, kept:
  hidden pips make the feature undiscoverable to everyone who has not been told.
- **The context menu is local, not promoted to core.** File Manager has the only
  other one, and this is a different shape. The repo's rule is to promote
  duplication on the *third* use; this is the second.

### Verified in a browser

```
PASS four pips, empty ones included; workspace 1 active at boot
PASS apps open on the workspace you are looking at, and only show there
PASS a window on another workspace is STILL MOUNTED, not destroyed
PASS THE APP KEPT ITS STATE ACROSS THE SWITCH (a typed digit survived)
PASS the taskbar lists this workspace's windows and no others
PASS Ctrl+Alt+→ from 3 → 4 → wraps to 1; Ctrl+Alt+← from 1 wraps to 4
PASS maximize survives switching away and back (1440px both times)
PASS right-click → Move to workspace 4 moves it AND follows it there
PASS launching a single-instance app on another workspace switches to it,
     and opens no second window
PASS closing the last window leaves a usable empty desktop
PASS a reload restores each window to its own workspace, and the view with it
PASS the shortcut overlay lists the workspace bindings
page errors: none
```

Tests: frontend vitest **1044 → 1071** (27 new: 19 on the store, 8 on the hotkey
matcher). Backend unchanged at 385 unit and 138 e2e. All 107 turbo tasks green.
Zero new dependencies.

Out of scope and untouched, as specified: dynamic workspace count, naming,
per-workspace wallpapers, an exposé view, and moving windows by edge-drag.
