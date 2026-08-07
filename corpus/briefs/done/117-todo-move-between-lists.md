# Brief 117 — Todo: refile a task without retyping it

> **Outcome (2026-08-07): DONE.** The update mutation has always accepted
> `listId` (`types.ts:48`, `TodoPatch`); the only thing missing was a way to
> say so. A per-row **Move to a list** button opens a chip row — "No list" plus
> every list — with the current one pressed, in the same slot and the same
> shape the due editor already uses. A **Move** button joined Complete and
> Delete in the bulk-select bar, one update per selected task (there is no
> batch endpoint, and inventing one for a loop would be a schema change for
> nothing).
>
> A row of chips rather than a `<select>`: it shows where the task is filed
> *without* opening anything, and there are rarely more than a handful of
> lists. Picking the list a task is already in closes the picker without
> issuing a patch — the user answered the question, and a no-op write is not an
> answer worth sending.
>
> Verified: turbo 120/120, and an 8-check browser probe on the production
> bundle — a list created, a task added and starred, moved through the row
> picker, and found under the new list **still important**, which is exactly
> what delete-and-retype used to destroy. Console clean.

Status: **done** · From the 2026-08-07 research sweep. EASY · `todo` only.
No backend change, no protocol change, no new dependency.

## Problem

Filing a task under a different list means deleting it and typing it again,
which throws away its due date, its importance and its manual position. The
backend has accepted `listId` on a patch since brief 73; the app has a list
switcher and a create-list flow, and no way to move anything between them.

## Fix

1. `TodoRow.tsx`: a `lists` prop, a `FolderInput` button in the row's hover
   actions, and a `ListPicker` strip mirroring `DueEditor`'s placement.
2. `Todo.tsx`: pass `lists` down; add a bulk `Move` beside Complete/Delete
   that resolves a typed list name against the known lists and patches each
   selected task, clearing the selection the way the other two bulk actions
   already do.

## Must preserve

- The existing patch semantics — `listId: null` unfiles, which is what the
  "No list" chip sends.
- Drag reordering, the due editor, importance and select mode untouched.
- The bulk actions' existing habit of clearing the selection afterwards: a
  moved task may no longer be visible under the current filter.

## Verify bar

`turbo typecheck`, lint + format, `turbo test`, `turbo build` green.

**Verified in a browser**: a task with importance set moves to another list
and arrives with its importance intact. Console clean (§14).

## Out of scope

Drag-and-drop between lists (the OS's one drag model is brief 133's
sequencing), nested lists, and per-list sort orders.
