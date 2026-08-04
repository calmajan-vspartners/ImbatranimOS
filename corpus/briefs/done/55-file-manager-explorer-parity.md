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

---

## Outcome — 2026-08-04

Done. **Two of the six items were already fixed by later briefs, and the brief did
not know** — worth stating plainly, because acting on a stale brief is how you get
a second Properties dialog:

- **Item 3, Properties: already shipped** in brief 87, as
  `components/PropertiesDialog.tsx`, reachable from the context menu.
- **Item 2's premise is wrong.** The Details list already had Size and Modified
  columns; what was missing was the ability to sort by them.
- **Item 6 was half done**: `notify()` was already used for the Trash outcome, but
  every *failure* still went only to a local banner, and the stale
  "(no toast system here)" comment was still there.

### One order, not two

The real hazard in this brief was not sorting itself but *where* it happens.
`sortEntries` was called twice — once in `FileManager` for the virtualizer count and
keyboard navigation, once again inside `FileList` for the rendering — and the two
agreed only because both used the same hard-coded comparator. `FileList` was in fact
being handed the **raw, unsorted** query array while the virtualizer counted the
sorted one; it lined up purely because it re-sorted identically.

The moment sorting becomes user-controlled, two independent sorts are two chances to
disagree, and the failure mode is arrow keys moving to a different row than the one
highlighted. So: filter and sort **once**, in `FileManager`, and pass the result
down. `FileList` no longer sorts at all, and `lib/fileKind.ts`'s old `sortEntries`
is deleted rather than left as a second way to do it.

### What shipped

- **`lib/fileSort.ts`** — name / size / modified, both directions, directories
  pinned above files in every combination. Plus the decisions that are only visible
  in a test: a directory's `size` is an inode size the user cannot see, so two
  directories fall back to comparing by name; an unparseable `modifiedAt` sorts last
  instead of returning `NaN` (which makes the result depend on the input order *and*
  the engine's sort implementation); and name is the tiebreak for every key, so two
  equal-size files never swap places between renders.
- **Direction applies uniformly**, including to the directory name fallback. My
  first draft special-cased folders to stay A→Z under a descending sort and two
  tests caught it. Explorer reverses them, and folders running A→Z while the files
  beneath them run Z→A from the same click reads as a bug — so the *tests* were
  corrected to match Explorer, and the reason is written down at the comparator.
- **Clicking a new column starts at its natural direction** — A→Z for names,
  biggest/newest first for size and date — rather than inheriting the previous
  column's, which gives the user the opposite of what they meant half the time.
- **Sortable headers** with `aria-sort` on the `<th>` and a real `<button>` inside
  it, mirroring System Monitor's process table. The arrow occupies reserved width so
  headers do not shift when the sort moves.
- **Hidden files hidden by default, Ctrl+H to toggle**, filtered client-side (the
  backend keeps listing them, so `search` for `.bashrc` still works). Bound on the
  app's own root, not through `useRegisteredHotkeys` — a global binding would toggle
  a *background* File Manager's dotfiles — and documented in `App.tsx` so it appears
  in the shortcuts overlay without flickering as windows open and close. A folder
  containing nothing but dotfiles now says so and offers the toggle, instead of
  claiming "Empty folder".
- **Icons view** (`components/FileGrid.tsx`), virtualized, where one virtual item is
  a **row of tiles** rather than one entry. Everything that depends on that
  distinction — count, size estimate, and the `scrollMargin` that must be 0 without a
  `<thead>` — is derived in one place in `FileManager` so the three cannot disagree.
  `useListKeyboardNav` gained a `columns` parameter: Up/Down move a whole row,
  Left/Right one tile, and Left/Right stay unclaimed in Details view.
- **One dialog dialect.** The bespoke delete `<Dialog>` is now core's
  `ConfirmDialog` — the controlled component rather than the `useConfirm` hook,
  because `useDeleteFlow` already owns the open/confirm/cancel state machine.
  `ConfirmOptions.message` was widened from `string` to `ReactNode` so the bolded
  filename survived; forcing it to a plain string would have made the shared
  component worse than the bespoke one it replaced.
- **`failAction()`** raises the notification *and* sets the banner, in one function
  so they cannot drift. Keeping both is deliberate rather than the brief's
  notify-only: the notification is what gets noticed in a background window, the
  banner is what stays readable while the user fixes the problem.
- **`lib/entryPresentation.tsx`** — icon + size formatting extracted so a file
  cannot show one icon in Details and another in Icons.
- **28 unit tests**, zero new dependencies.

### A bug I introduced and had to measure my way out of

Composing the pane's measuring ref with the existing `listContainerRef` as an inline
arrow blanked the entire desktop — React re-runs a ref callback (cleanup, then
attach) on every render when it is a fresh closure, `useElementSize` wrote state on
attach, and that state change drove the next render: an infinite loop, surfacing
only as minified React error #185 on a white screen.

Fixed twice over, because one fix was not enough. The call site now wraps the
composed ref in `useCallback`, **and** `useElementSize` only writes state when the
box actually changed — so an unstable ref identity can no longer freeze an app. That
hook is new and shared by four call sites; it must not be a footgun.

### Verified in the shipped bundle

`uitest/fm55.mjs` and `uitest/fmscroll.mjs`, against the production build served by
the real backend, measuring rendered order rather than presence: each column sorts
both ways with `aria-sort` tracking and clearing correctly, Ctrl+H reveals and hides
the dotfile, the Icons grid renders 25 tiles at 96×92 across 5 wrapped rows with no
table header and the same order as the list, ArrowRight moves one tile while
ArrowDown moves a whole row, grid rows stay exactly one tile-height apart after
scrolling, Details rows stay a uniform 25.50px apart with **no cumulative drift**
(0.5px over 24 rows, sub-pixel rounding) and the first row flush under the header,
and delete raises the shared themed confirm with the filename still bold. No page
errors.

Two things the probes taught me about probing a virtualized list, both recorded in
the scripts: only *mounted* rows are in the DOM, so assertions must check that what
is rendered is a **subsequence** of the expected order rather than equal to it; and
`useFileSelection` documents that a plain click on the sole selected entry *clears*
it, so a probe that clicks an already-selected tile reads a correct app as broken.

### Deliberately not done

- **Drag-to-move between tree and list** — the brief already defers it behind the
  desktop drag-selection work; still the right call.
- **Dual-pane / tabs** — rejected in the brief; windows are the OS's multiplexer.
- **A bounded backend directory-size endpoint** — brief 83 already shipped the
  bounded size walk that Properties needs, so no new endpoint was required.

### Noted, not fixed

The Details row estimate is `29px` while rows actually measure `25.50px`. Harmless
today — `measureElement` corrects every mounted row, so only the scrollbar's length
is slightly off — and it predates this brief, so it is recorded rather than changed
on a guess.
