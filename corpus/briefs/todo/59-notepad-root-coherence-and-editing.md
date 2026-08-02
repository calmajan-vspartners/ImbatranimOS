# Brief 59 — Notepad: one filesystem, and the editing basics

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
EASY/MEDIUM · add-on `apps/add-ons/notepad`. Depends on brief 54 (the shared
Open dialog) for the picker; the root question below can land independently.

## Problem

**1. Notepad lives in a different filesystem from the rest of the OS.** It reads
and writes through `root=notes` (brief 25 collapsed the old notes module onto
`/files?root=notes`), while every other app defaults to `home`. So a file
created in Notepad does not appear in the File Manager's home tree, is not found
by the global search launcher's default scope (brief 45), and is not where the
user's own `~/Documents` lives. For an OS whose selling point is a *real* shared
filesystem, having one app quietly writing somewhere else is the kind of seam
users trip over once and never trust again.

**2. It is a bare textarea.** `NoteEditor` gives text in, text out. No find, no
find-and-replace, no word-wrap toggle, no line/column indicator, no word count,
no go-to-line. These are the things "Notepad" names a promise to provide, and
the app owns `.txt`/`.log` — log files in particular are unusable without search.

**3. Its file browser is private.** `components/FileBrowser.tsx` (183 lines) is
a working in-app browser that seven other apps needed and could not have. Brief
54 promotes it to core; Notepad should then consume the shared one and delete
its copy, so there is one picker in the OS rather than two.

**4. Large files are unbounded.** The whole file is loaded into a controlled
React state string. A multi-megabyte `.log` — exactly what this app is pointed
at — will make typing janky, with no guard and no warning.

## Proposed decisions (ungrilled)

- **Default to `home`, keep `notes` reachable.** Make `home` the root Notepad
  opens and saves into, so it shares the filesystem with everything else. Do not
  delete the `notes` root: existing notes live there and the backend surface is
  shipped. Show it as a location in the picker instead. **Migration is the
  grill-worthy part** — silently changing the default hides existing notes from
  a returning user. Proposal: keep `notes` as the initial location when it
  already contains files, and default new installs to `home`.
- **Find and replace in a plain textarea**, not by adopting an editor engine.
  Code Editor already exists for anything richer; Notepad's value is that it is
  instant and dependency-free. A find bar with match count, next/previous,
  replace and replace-all is a contained amount of work over `value`/`selectionStart`.
- **Word wrap toggle, line/column, and word count** in a status bar, following
  the house status-bar recipe (`ui-conventions.md` §17).
- **Cap the file size it will open** and say so. Offer to open the file in Code
  Editor (which is virtualized by Monaco) instead of degrading silently.
- **Rejected — tabs inside Notepad.** It is `multiInstance`; the OS's windows
  are the tab bar.
- **Rejected — autosave.** The explicit-save spine with a dirty marker and a
  close guard (brief 23) is consistent across every editor in the OS; making one
  app autosave breaks the shared mental model, and there is no Trash or version
  history yet to make silent writes recoverable.

## Fix

1. Root: introduce an explicit location concept in the Notepad store; default
   per the migration rule above; surface both roots in the brief-54 picker.
2. `FindBar.tsx` — a thin overlay in the editor body: query, match count,
   next/prev, replace, replace-all, Escape to close, Ctrl+F / Ctrl+H to open.
   Operate on the textarea's value and selection; no dependency.
3. Status bar: line/col from the caret offset, word/char count, wrap toggle
   (`aria-pressed`), persisted per window.
4. Size guard on open, with a `notify()` and an "Open in Code Editor" action
   using `openApp('code-editor', { openPath, root })`.
5. Delete `components/FileBrowser.tsx` and consume core's `useFileDialog`.

## Must preserve (regression surface)

- The save spine: `useOpenIntent`, `useSaveHotkey`, `useUnsavedGuard`, the dirty
  `•` in the window and taskbar title, and the close guard.
- The StrictMode-safe intent drain from brief 30 — do not reintroduce the
  double-drain bug.
- Notepad's command-palette source (`commandSource.ts`) and recent-notes
  behaviour.
- Existing files under the `notes` root remain openable and editable.
- `.txt`/`.log` continue to route here from `openWith`, and `.md` continues to
  route to Markdown Editor.

## Verify bar

`turbo typecheck`, add-on lint + format green, `turbo build` ok. Unit tests for
the find/replace logic (case sensitivity, replace-all count, no-match, replace
inside a selection) and for the caret→line/col mapping.

**Verified in a browser**: create a file in Notepad and find it in File Manager
at the expected path; open an existing note from the `notes` location; Ctrl+F
through a log file; toggle wrap; confirm the dirty marker and the unsaved-close
guard still fire; open an oversized file and get the offer to switch to Code
Editor.

## Out of scope

Syntax highlighting, tabs, autosave, version history, encoding selection, print,
and the Trash interaction (its own brief).
