# Brief 73 — Todo: due dates, order, and a reason to keep using it

Status: **done 2026-08-05** · From the 2026-07-31 app+OS improvement sweep.
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

---

## Outcome — 2026-08-05

Done. Due dates, priority, lists, bulk actions and keyboard-first adding all landed
as specified. Two of the six problems were **not what the brief said** — and the one
it got half wrong was sitting on top of a real bug it had not noticed.

### Item 2 is half wrong, and the half that was already there was broken

"**No ordering.** No manual reorder, no priority, so the list is insertion-ordered
forever." Manual reorder has been there the whole time and works end to end: a drag
handle bound with `useDrag`, a `PATCH /todos/reorder`, a transaction writing
`position`, and `ORDER BY position ASC` in `findAll`. What was actually missing is
the **priority flag** and **sort options**, both of which this brief adds.

But the brief's instinct that ordering was unreliable was right for a reason it did
not give. `reorder(ids)` wrote positions **1..N onto whatever ids it was handed**,
and the client hands over the ids of the *visible* rows. So reordering on the Active
tab stamped 1..N over the top of the completed rows' positions — two todos ended up
sharing position 3, and `ORDER BY position` was free to pick either. It looked
correct because the list being renumbered was exactly the list on screen.

`reorder` now treats the ids as a **relative** reordering of a subset: normalise the
whole table to 1..N, find the slots those ids currently occupy, and place them into
those same slots in their new order. Rows the client cannot see keep their exact
places. Measured through the UI, with `b` and `d` completed so Active is `[a, c]`:

```
initial (all)          : ["a@1","b@2","c@3","d@4"]
active view            : ["a","c"]
drag c above a
active after the drag  : ["c","a"]
all after the drag     : ["c@1","b@2","a@3","d@4"]   ← b still 2nd, d still 4th
active after a reload  : ["c","a"]
positions still unique : true [1,2,3,4]
```

### The `position` column shipped with `DEFAULT 0`

Which means every row that predates it shares position 0, `ORDER BY position` falls
back to whatever SQLite feels like, and the reorder above writes over ties. The
migration now normalises to 1..N by `(position, id)` — pre-existing todos keep their
insertion order, anything reordered since keeps its order — and it only runs when
there is something to fix (a zero, or two rows sharing a position), so a healthy
table costs one `SELECT` at boot. Three e2e tests cover it: the tie case, an
already-healthy table left untouched, and text plus done-state surviving.

`DbService.migrate()` became public to make that testable. A `:memory:` database is
per *connection*, so re-running `onModuleInit` silently hands back an empty one —
`migrate()` is idempotent by construction (`IF NOT EXISTS`, try/catch `ALTER`,
guarded backfill) and can just be called again.

### Item 5 (the clipped input) measured fine, and I did not prove why

The brief cites `CLIPPED[INPUT]` at 1280×577 from the automated walkthrough. At
exactly that viewport, with a 26-row list, the add input's bottom edge is **66px
above** where the taskbar starts. It is also fine at the old `minSize`.

I tried to isolate whether the `min-h-0` this brief added to the scroll area is what
fixed it, by stripping the class in the live page — and the strip hit a nested
element inside core's `ScrollArea` (which carries its own `overflow-hidden`, already
making its min-content zero), so **that experiment proved nothing and I am not
claiming a cause**. The likely explanation is the same one Calendar's equivalent item
had: brief 52's window clamp, which landed after this brief was written. The
`min-h-0` on the list and `shrink-0` on the add row are correct regardless — they
state which element is supposed to give way — but they should not be credited with a
fix I did not demonstrate.

The `minSize` did need changing, for a different reason: the app gained **two header
rows** (lists, bulk actions), so the same window shows fewer tasks. Chrome measured
at 29 + 26 + 29 + 30 + 16 = 130px plus ~32 of frame, which left the old 280×300 with
138px of list — under four rows. Now 300×340, giving ~178px, five rows.

### Due dates: store the deadline, not the day

**A due date is stored as the instant the todo is actually due.** A date-only due
date therefore lands on `23:59:59.999` of that day, and "is it overdue?" is a plain
`dueAt < now` — correct across a day boundary by construction, with no special case
in any caller. The obvious alternative (store midnight, remember to treat it as
end-of-day) puts that reasoning into every call site, which is exactly where
off-by-a-day bugs live: a todo due "today" would read as late from 00:01 onward.

The cost is that *display* needs the inference instead — a value whose time is
`23:59:59.999` is shown as a bare date. Someone who deliberately picks 23:59 gets a
date-only label, off by a minute in the label only. That is a far cheaper mistake
than being off by a day in the comparison, and it is the trade taken deliberately.

Overdue uses `error` tokens and nothing else (`ui-conventions.md` §10); due-today
gets a plain emphasis, and the two states are exclusive so a row can never be styled
both ways. Measured:

```
"write the brief"  due "3 days late"  classes: border-error text-error
"grill the brief"  due "Today"        classes: border-outline text-on-surface font-semibold  ★
"ship the brief"   no due date        no chip
header badge       : "1 late"
```

### Manual order does not float priority — deliberately

Priority is a leading sort key in **due** and **created** order, and purely a marker
in **manual** order. A list that silently reorders itself after you drag it is not a
list you can arrange; manual means manual. Dragging is disabled outside manual order
for the same reason — a drag there would write positions the view is not showing —
and the toolbar says so rather than leaving a dead handle.

### camelCase, and a type that admitted it had a problem

The `todos` API now maps rows at the service boundary like `clock` and `calendar`,
and `completed` is a real boolean. It used to arrive as `0 | 1`, and the frontend's
own type read `completed: boolean | number // SQLite returns 0/1`. Brief 71
deliberately left the older modules alone because changing them is a client-visible
break for no user gain — this brief rewrites both sides in one commit and the Todo
add-on is the only consumer, so the exception is bounded and the alternative was a
response mixing `created_at` with `dueAt`.

### Found while probing, in no brief

- **"Clear completed" was a dead button on the Active tab.** The count came from the
  loaded list, and the Active tab has never seen a completed todo — so it was always
  disabled exactly where a user is most likely to reach for it. It is now enabled
  whenever the count is unknown, asks "Delete every completed task?" without a
  number, and reports what the server actually deleted (`2 tasks deleted.`). The
  server knows; the client does not need to.
- **Write failures went nowhere.** A rejected PATCH rolled the optimistic update
  back and the row sprang into its old state with no explanation, which reads as the
  app ignoring the click. Every mutation now `notify()`s on error.
- **A query-key collision, caught while writing it.** Lists under
  `['todos', 'lists']` would be matched by `peekTodos`'s `['todos']` prefix and
  flattened into its `Todo[]`, handing the reminder watcher rows with no `dueAt`.
  Lists live under their own `['todo-lists']` root.

### Handed to brief 75 (Bookmarks)

**`PRAGMA foreign_keys` is never enabled on this connection**, so
`bookmark_links.group_id … ON DELETE CASCADE` is decorative — and
`BookmarksService.removeGroup` deletes the group without touching its links, so
deleting a bookmark group **orphans every link in it**. Not fixed here (it belongs to
the Bookmarks brief, and enabling the pragma globally would change behaviour for a
module this brief has no business touching). Todo's own list deletion therefore does
not rely on an FK: it unfiles the todos and deletes the list in one transaction,
which is also the right behaviour — deleting a list should not delete the work in it.

### Verified in a browser, against the production bundle on the real backend

```
PASS the add input is focused when the window opens
PASS three tasks added with nothing but typing and Enter, positions 1,2,3
PASS focus stays in the field after each Enter
PASS Escape clears a half-typed task without reaching for the mouse
PASS an overdue task reads "3 days late" in error tokens only
PASS a task due today reads "Today" with a plain emphasis, not an error
PASS the header counts "1 late" — the overdue one, not the due-today one
PASS the priority star round-trips
PASS dragging inside the Active filter reorders only the visible rows
PASS the hidden completed rows keep their exact positions, all still unique
PASS the new order survives a reload
PASS a new list is created, selected, and the add field says "Add to Work…"
PASS a task added while in a list is filed under it
PASS deleting a list keeps its tasks and unfiles them
PASS "Clear completed (2)" confirms destructively and deletes exactly those two
PASS "Clear completed" from the Active tab works and reports "2 tasks deleted."
PASS the add input is 66px above the taskbar at 1280x577 with a 26-row list
page errors: none
```

Tests: frontend vitest **782 → 811** (29 new in a package that had **zero** — the
due-date encoding and the sort comparators), backend e2e **80 → 101** (21 new
covering the new fields, the filtered-reorder bug, list deletion and the position
backfill), backend unit unchanged at 208. All 99 turbo tasks green. Zero new
dependencies.

Out of scope and untouched: subtasks, recurring todos (recurrence belongs to
Calendar), the Calendar coupling, tags, attachments, sharing, and natural-language
date parsing.
