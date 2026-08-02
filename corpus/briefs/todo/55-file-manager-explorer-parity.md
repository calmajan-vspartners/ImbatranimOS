# Brief 55 — File Manager: sorting, views, properties, and one dialect for dialogs

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
MEDIUM · add-on `apps/add-ons/file-manager` (2379 LOC / 22 files, the richest
app). Standalone; the Trash work is a separate parity brief and this one must
not pre-empt it.

## Problem

The File Manager is further along than the rest of the OS — real jailed FS,
tree + list, breadcrumb, rename, new folder, copy/cut/paste, upload dropzone,
preview pane, virtualized rows, keyboard nav, and the ext→app map every other
app depends on (`lib/openWith.ts`). The backend already exposes everything it
needs: `directory`, `move`, `copy`, `upload`, `download`, `content`, `search`,
`delete` (`files.controller.ts:47-159`). What is missing is the ordinary
furniture of a file manager:

1. **No sorting at all.** There is no `sortKey`/`sortBy`/`sortDir` anywhere in
   the package. You cannot order by name, size, or date modified — in a file
   manager. (System Monitor's process table *does* sort,
   `ProcessTable.tsx:21-44`, which makes the omission look accidental rather
   than considered.)
2. **No view modes.** One list rendering only; no large-icons view, and the
   list shows no size/modified columns to sort by even if sorting existed.
3. **No Properties.** Nothing reports a file's size, type, permissions or
   timestamps, and no way to see a folder's recursive size.
4. **No hidden-file toggle.** The backend lists dotfiles unconditionally, so
   `.imbatranim`, `.local` and friends are always in the user's face with no
   way to hide them. (The only `hidden` occurrences in the package are a CSS
   class at `FileManager.tsx:365` and `aria-hidden` on virtualizer spacers.)
5. **Two dialog dialects.** `useConfirm` is used **zero** times here; delete
   ships a hand-rolled `<Dialog>` (`FileManager.tsx:569+`) while the rest of the
   OS uses the kit hook — the inconsistency called out in
   `wiki/ui-conventions.md` §44.
6. **A stale error path.** `FileManager.tsx:104` still carries the comment
   "(no toast system here)" and surfaces batch failures through local state,
   though `notify()` shipped in brief 34. So an upload or delete failure in a
   background window is easy to miss.

(The `<button>`-inside-`<button>` console error previously attributed to this
subtree was fixed on 2026-07-31 in core's `Tooltip`; FileList was innocent.)

## Proposed decisions (ungrilled)

- **Sorting first** — name / size / modified, ascending and descending, applied
  before virtualization, with directories pinned above files (the Explorer
  convention this UI already implies). Persist the choice per session.
- **Add size + modified columns** to the list, because sorting by a column the
  user cannot see is a worse experience than no sorting.
- **Two view modes only**: Details (the list, default) and Icons. Resist a
  third; each one is a rendering to keep working with the virtualizer.
- **Properties as a dialog**, from the context menu and Alt+Enter: name, full
  path, type, size, modified, permissions. Folder size is computed lazily on
  demand, bounded by the same caps `files.service` already applies to search —
  never an unbounded recursive walk on selection.
- **Hidden files hidden by default, Ctrl+H to toggle**, filtered client-side so
  no backend change is needed and search behaviour is untouched.
- **One dialog dialect**: replace the bespoke delete `<Dialog>` with
  `useConfirm({ destructive: true })`, and route batch failures through
  `notify({ appId: 'file-manager' })`. Delete the stale comment.
- **Rejected — a Trash/undo here.** It is genuinely the most valuable change to
  deletion, and precisely because of that it is its own brief (backend rename
  into `~/.local/share/Trash`, a Trash node, restore, empty). Doing a half
  version inside this brief would foreclose the real one.
- **Rejected — dual-pane / tabs.** A different product. Windows are the OS's
  multiplexer.
- **Deferred — drag-and-drop move between tree and list.** Wanted, but it
  interacts with the desktop drag-selection todo and with brief 54's drop
  target; sequence it after those rather than inventing a third drag model.

## Fix

1. `useFileSort` hook (key + direction + directories-first), applied in
   `FileManager.tsx` before the list renders; clickable column headers in
   `FileList.tsx` mirroring `ProcessTable`'s affordance, with `aria-sort`.
2. Extend the row to Details columns (name, size, modified). Keep
   `useVirtualList` sizing correct — a changed row height must be reflected in
   the estimator or scrolling drifts.
3. `viewMode` state + an Icons renderer sharing selection, context menu and
   keyboard nav. Toolbar toggle with `aria-pressed`.
4. `PropertiesDialog.tsx` using the core `Dialog`; folder size via a new bounded
   backend size endpoint **or** a client walk of already-listed data — prefer
   the backend, reusing the `searchBounds()` caps idiom.
5. `showHidden` state + Ctrl+H + a View-menu item; filter `.`-prefixed entries.
6. Swap the delete dialog to `useConfirm`; convert `actionError` to `notify()`;
   remove the stale comment.

## Must preserve (regression surface)

- Virtualized list (brief 31) stays scroll-stable and recycles correctly under
  sorting, filtering and both view modes.
- Extracted hooks from brief 26 (`useFileSelection`, `useFileClipboard`,
  `useDeleteFlow`, `usePaneResize`, `useListKeyboardNav`) keep working; the
  delete state union from CS-4 is not regressed by the `useConfirm` swap.
- The preview pane, its persisted width, and auto-collapse (brief 22).
- `lib/openWith.ts` double-click / Enter / context-menu routing — every other
  app depends on it.
- The FS jail: nothing here may construct a path the backend has not resolved
  via `resolveSafe`.
- Upload dropzone + the 413/too-large path.

## Verify bar

`turbo typecheck`, add-on lint + format green, `turbo build` ok. Unit tests for
the sort comparator (directories first, stable, all three keys, both
directions) and the hidden filter.

**Verified in a browser**: sort by each column both ways in a folder with mixed
entries; switch to Icons and back with a selection active; open Properties on a
file and a folder; Ctrl+H hides and restores dotfiles; delete now shows the
themed confirm and a failed delete raises a toast; scroll a large directory
after sorting and confirm no row drift. Re-run the walkthrough harness and
confirm no console errors.

## Out of scope

Trash/undo (own brief), user-editable default apps (own brief), dual-pane,
tabs, drag-to-move, archive integration changes, and any backend change beyond
an optional bounded directory-size endpoint.
