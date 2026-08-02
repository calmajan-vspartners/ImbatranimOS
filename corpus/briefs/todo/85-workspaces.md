# Brief 85 — Workspaces (virtual desktops)

Status: **todo (ungrilled)** · From the 2026-07-31 real-OS parity research.
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
