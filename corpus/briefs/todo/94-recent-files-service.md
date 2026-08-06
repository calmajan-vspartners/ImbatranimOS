# Brief 94 — OS-wide recent files (one service, three consumers)

Status: **todo (ungrilled)** · From the 2026-08-06 feature exploration
([wiki page](../../wiki/feature-exploration-2026-08-06.md)); Tier-2 #2 in
[real-os-gaps.md](../../wiki/real-os-gaps.md). MEDIUM · backend `files` module
+ CORE (Start menu, FilePicker, palette) + one-line hooks in the openers.

## Problem

The OS already has a recents table (`recent_files`) and API
(`/api/notes/recent`) — but only Notepad writes to it, and nothing reads it
except Notepad's own open screen. Meanwhile git-gui grew a *parallel*
`git_recent_repos` table. Every real OS answers "what was I just working on?"
in the Start menu and in every open dialog; this one answers it nowhere.

## Proposed decisions (ungrilled)

- **Promote, don't invent**: move the API to `GET/POST /api/files/recent`
  under the files module, rows `{root, path, appId, openedAt}`, capped (say
  50, pruned on insert). The current table stores a bare path with no root
  (the exact shape brief 71 refused to reuse) — migrate: existing rows are
  Notepad's, so backfill `root='notes'`… except brief 59 moved Notepad to
  `home`; grill whether old rows are worth keeping at all or the table starts
  clean.
- **Recording happens at the choke points, not per app**: `openWith`
  activation in the file manager and `useFileDialog`'s `openFile`/`saveFile`
  resolutions both record; apps that open files through their own flows
  (Notepad's list, git-gui) call the same core helper. `git_recent_repos`
  stays — a repo is not a file; folding two meanings into one table is the
  refused pattern.
- **Three consumers ship in this brief** (a service with zero readers is the
  disease this sweep diagnosed):
  1. **Start menu → Recent** — right column or submenu, icon per owning app,
     click = `openApp(appId, {file})`.
  2. **FilePicker → Recent shortcut** — alongside the root switcher in
     `apps/core/src/components/files/FilePicker.tsx`.
  3. **Palette source** — "Recent" group via `registerCommandSource`.
- **Deleted files self-heal lazily**: opening a recent that 404s removes the
  row and notifies, same contract sticky-notes proved for stale caches.
- **Privacy affordance**: "Clear recent files" in the Start menu context /
  Settings — a real-OS expectation once recents are visible.

## Fix

1. Backend: route move (`notes/recent` kept as a deprecated alias for one
   release or dropped — grill), root+appId columns, cap+prune, tests.
2. Core: `recordRecentFile(root, path, appId)` helper on the barrel;
   FilePicker + Start menu + palette source consumers.
3. Openers: file-manager `openWith` activation + `useFileDialog` resolutions
   record; Notepad switches to the shared helper (deleting its private one).

## Must preserve (regression surface)

- Notepad's open screen keeps working through the migration.
- The FilePicker's existing latching contract (brief 54) unchanged — Recent
  is a navigation shortcut, not a new selection path.
- `files` module jail untouched: recents store paths, never bypass
  `resolveSafe` on open.
- Palette performance: the source searches the capped table, no FS hits.

## Verify bar

Backend tests (cap, prune, dedupe-on-reopen, root validation). **Verified in
a browser**: open files from three different apps, see all three in Start →
Recent with correct icons; open one from the palette; delete a file in the
file manager, click its recent entry, watch it self-heal + notify; clear all.

## Out of scope

Per-app recents UI beyond what exists, jump-lists on taskbar buttons,
frecency ranking, and recording terminal/PTY file access (no seam exists).
