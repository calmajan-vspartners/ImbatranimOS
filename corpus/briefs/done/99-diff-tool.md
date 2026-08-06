# Brief 99 — Diff tool (Monaco's DiffEditor is already on the disk)

Status: **done** (was: todo, ungrilled) · From the 2026-08-06 feature exploration
([wiki page](../../wiki/feature-exploration-2026-08-06.md)); Tier-2 #7 in
[real-os-gaps.md](../../wiki/real-os-gaps.md). EASY/MED · lives inside the
existing code-editor package. No new dependencies.

## Problem

The OS ships Monaco (brief 41) — which includes a first-class `DiffEditor` —
and a Git GUI whose diffs render as raw patch text. There is no way to answer
"what's different between these two files?", a daily question for exactly the
web/low-level-programmer audience the daily-driver research named. The
capability is literally in the bundle; it has no window.

## Proposed decisions (ungrilled)

- **Inside the code-editor package, second manifest — not a new package.**
  A separate add-on would carry its own `monaco-editor` dependency and
  duplicate the worker setup brief 41 got right (self-hosted, `?worker`,
  no CDN). The code-editor package exports a second `AppConfig`
  (`id: 'diff'`), sharing the Monaco chunks Vite already splits. Grill this
  against the one-app-per-package convention; brief 98 asks the same
  question, so settle it once.
- **Entry points, in order of value**:
  1. Open the Diff app → two `useFileDialog` pickers (left/right).
  2. File manager: select two files → context menu "Compare" →
     `openApp('diff', {left, right})` via the existing intent mailbox.
  3. Git GUI: a "Compare in Diff" action on a file's diff view, passing HEAD
     content vs working copy as in-memory sides (grill scope — needs
     `git show HEAD:path`, which the hardened seam can express as a read-only
     subcommand; if the allowlist argument is contentious, ship 1+2 and defer
     this).
- **Side-by-side and inline toggle**, language inferred per side from
  extension (Monaco's own detection), word-wrap toggle.
- **Right side editable + full save spine** (`useSaveHotkey`,
  `useUnsavedGuard`, dirty dot) — "apply the fix while looking at the diff"
  is the workflow that makes this a tool rather than a viewer. Left side
  read-only.
- **Honest limits**: files above the size guard the code editor already
  enforces are refused with the same message; binary files are refused (not
  garbled) — detection by the null-byte sniff the preview pane uses.

## Fix

1. Second manifest in `apps/add-ons/code-editor` + registration in
   `apps/core/src/manifest.ts`.
2. Diff shell: dual pickers, DiffEditor host reusing the existing Monaco
   loader, view toggles.
3. File-manager two-selection "Compare" menu entry
   (`buildMenuItems.tsx` + selection model already supports multi-select).
4. Save spine on the right side; refusal paths for binary/oversize.

## Must preserve (regression surface)

- Code editor behaviour and its chunk graph unchanged (measure: eager bundle
  identical; the diff app pulls the same lazy Monaco chunks, not new ones).
- File-manager multi-select semantics unchanged for every existing action.
- The Git GUI's current patch view stays (Compare is an addition, not a
  replacement).

## Verify bar

`turbo` gates green; unit tests on the refusal logic and the two-file intent
payload. **Verified in a browser**: compare two sources side-by-side, toggle
inline, edit the right side, save, reopen and confirm; Compare from the file
manager with exactly two files selected (and confirm the menu entry absent at
one or three); refuse a binary and an oversized file with the house message.

## Out of scope

Three-way merge, directory diff, diffing two git revisions in the Diff app
(the Git GUI owns history), and any patch-file (.diff/.patch) apply flow.

## Outcome — DONE 2026-08-06

Shipped: second manifest in the code-editor package (shares the self-hosted
Monaco + worker chunks), dual pickers, file-manager 'Compare' appearing
exactly when two files are selected and the clicked entry is one of them,
side-by-side/inline + word-wrap toggles, per-side language inference, right
side editable with the full save spine, >5 MB and binary (null-byte sniff)
refusals. The Git GUI integration was deferred as the brief anticipated —
`git show` is a new allowlist argument that deserves brief-76-grade scrutiny,
not a rider.
