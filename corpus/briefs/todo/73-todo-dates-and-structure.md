# Brief 73 — Todo: due dates, order, and a reason to keep using it

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
EASY/MEDIUM · add-on `apps/add-ons/todo` (383 LOC) + the backend `todos` module.
Standalone.

## Problem

Todo is one of the oldest apps in the repo, inherited from the pre-fork
minimal-web-desktop and barely revisited since. Its foundation is right — it
persists through the backend (`/todos`, `api.get/post/patch` in
`api/todosApi.ts:5-18`), so unlike Calendar the data actually lives in the
container. But the model is a flat list of `{ text, done }` with a filter, and
that ceiling is low:

1. **No due dates**, so nothing can be urgent, nothing can be late, and the app
   cannot participate in the notification centre the way Clock and Calendar do.
2. **No ordering.** No manual reorder, no priority, so the list is
   insertion-ordered forever and the important item sinks.
3. **No structure** — no lists/projects and no subtasks, so it holds one
   undifferentiated pile.
4. **No bulk actions**: no "clear completed", no multi-select.
5. **An input clipped under the taskbar** at 1280×577, caught by the automated
   walkthrough (`CLIPPED[INPUT]`). Brief 52 clamps the window; the app should
   also declare an honest `minSize` and keep the add-input pinned above the
   scrolling list rather than below it.
6. **Keyboard flow is unproven** — adding several items quickly should never
   require the mouse.

## Proposed decisions (ungrilled)

- **Due dates first**, because they unlock the rest: sorting by urgency, an
  overdue state, and reminders through the existing `notify()`. Date only by
  default, optional time.
- **Reminders reuse the notification centre**, with the same honest caveat as
  Clock and Calendar (fires only while the app is open) and the same eventual
  fix (the shared core scheduler brief). Do not build scheduling here.
- **Manual reorder plus an explicit priority flag**, not a five-level scheme.
  Drag to reorder within a list, one "important" toggle. Persist the order as an
  index on the row.
- **Lists (projects), one level deep. No subtasks.** One level covers the real
  use; arbitrary nesting turns a 383-line app into an outliner and complicates
  every query. Say no now so it stops being an open question.
- **Bulk: clear completed, and select-multiple for complete/delete**, with
  `useConfirm({ destructive: true })` on the destructive ones.
- **Keyboard-first add**: focus the input on open, Enter adds and keeps focus,
  Escape clears.
- **Deferred — the Calendar coupling** brief 40 punted. Worth doing once both
  have dates, but it must respect the no-app-to-app-IPC rule: a todo appears in
  Calendar because both read the same backend, not because one app calls the
  other. Spec separately.
- **Rejected — recurring todos.** Recurrence belongs to Calendar (brief 72);
  duplicating a recurrence engine in two apps guarantees they diverge.

## Fix

1. Backend `todos`: add `dueAt` (nullable), `priority` (bool), `order` (int),
   `listId` (nullable FK) with a migration that defaults existing rows sensibly.
   Keep the routes authed and owner-scoped as they already are.
2. Frontend: due-date picker on add and edit; overdue styling using `error`
   tokens only (never a new colour, `ui-conventions.md` §10); sort options
   (manual / due / created).
3. Drag-to-reorder writing the `order` index; optimistic update through the
   existing query layer.
4. Lists: a simple selector; "All" as the default view.
5. Bulk actions + confirm; `notify()` on failures, which today go nowhere
   visible.
6. Layout: add-input `flex-none` above a `flex-1 min-h-0` scrolling list inside a
   `ScrollArea`; honest `minSize`.

## Must preserve (regression surface)

- Existing todos survive the migration with their text and done state.
- Routes stay authed and owner-scoped; no `@Public()`.
- The existing filter behaviour keeps working.
- Optimistic updates do not resurrect a deleted item on refetch.

## Verify bar

`turbo typecheck`, lint + format green, `turbo build` ok. Backend tests for the
new fields and the migration (existing rows keep their data and get a stable
order). Frontend tests for sort comparators and the overdue predicate across a
day boundary.

**Verified in a browser**: add several items keyboard-only; set a due date and
see the overdue state next day (or with a back-dated item); drag to reorder and
reload; clear completed behind a confirm; confirm the input is reachable at
1280×577.

## Out of scope

Subtasks, recurring todos, the Calendar coupling (deferred), tags, attachments,
sharing, and natural-language date parsing.
