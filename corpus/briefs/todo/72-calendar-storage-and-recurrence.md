# Brief 72 — Calendar: move the data into the container, then add recurrence

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
MEDIUM · add-on `apps/add-ons/calendar` (820 LOC / 9 files; `dayjs`, `zustand`)
+ a small backend surface. Shares its storage mechanism with brief 71 — land the
mechanism once.

## Problem

**1. The user's calendar is not in their computer.** `calendarStore.ts` persists
through zustand's `persist` middleware to `localStorage`, and its own comment
calls that "this add-on's entire storage surface" (`:11,21`). Consequences, all
real:

- Events live in whichever *browser* opened the OS. Open the same container from
  a different machine and your calendar is empty.
- They are outside `/home/imbatranim`, so the documented volume backup
  (`README.md:90-95`) does not include them, and neither would an in-OS backup.
- Two tabs share one origin `localStorage` and stomp each other — the exact bug
  `wiki/os-layering.md` cites as the driver for brief 49.

This directly contradicts the project's central claim. Todo, Sticky Notes and
Bookmarks all already persist through the backend (`/todos`, `/sticky-notes`,
`/bookmarks/groups`), so Calendar is the outlier, and the precedent for fixing it
is three apps deep.

**2. No recurring events.** The single largest functional gap in any hand-rolled
calendar. "Every Monday" cannot be expressed, so the app cannot hold a real
schedule.

**3. Reminders only fire while Calendar is open.** The app already says so in a
status bar (`Calendar.tsx:114`), which is correct and stays — the remaining
problem is the limit itself, not the wording.

**4. Missing calendar basics**: no all-day events, no multi-day/spanning events,
no day or agenda view (month + week only), no search, no drag-to-move or
drag-to-resize an event, no colours/categories, and no ICS import/export — which
is the only way a calendar interoperates with anything.

**5. The bottom row clips** at short viewports — confirmed live at 1280×577,
where the last week row (`30 31 1 2 3 4 5`) renders under the taskbar. Brief 52
clamps the window; Calendar should also declare an honest `minSize` and let the
grid compress rather than overflow.

## Proposed decisions (ungrilled)

- **Backend persistence, following the existing three apps.** A small
  `calendar` module with the same authed, owner-scoped shape as `todos` and
  `sticky-notes`. **Migrate existing `localStorage` events once, on first run
  after the change** — a silent switch would look like data loss to anyone who
  has been using it.
- **Recurrence: store an RRULE-shaped rule, expand for the visible range only.**
  Do not materialise instances into storage — that is the mistake every naive
  calendar makes, and it makes editing a series intractable. Support the common
  subset (daily / weekly with weekdays / monthly by date / yearly, with `until`
  or `count`), plus per-instance exceptions ("skip this one", "change just this
  one").
- **ICS import/export** for the same reason CSV matters to Sheets: without it the
  data is trapped. Export is straightforward; import should accept the common
  subset and report what it skipped rather than failing wholesale.
- **All-day and multi-day events** as a first-class field, since recurrence and
  ICS both depend on the model being right.
- **Do not build a scheduler here.** The existing disclosure stays; the real fix
  is the shared core scheduler brief.
- **Deferred — the Todo coupling** that brief 40 punted. It is a genuine
  integration (a todo with a due date appearing on the calendar) but it needs the
  no-app-to-app-IPC rule respected: coordination goes through the kernel (shared
  storage) or the compositor, never app-to-app. Spec it separately.
- **Rejected — external calendar sync (CalDAV/Google).** Network egress,
  credentials storage, and a protocol to maintain, for a single-user local OS.
  ICS files are the interop story.

## Fix

1. Backend `calendar` module: CRUD for events behind the session guard, stored
   in the home volume (SQLite, as `todos`/`sticky-notes` do). Include the
   recurrence rule and exception list in the model from the start.
2. Frontend: replace the zustand-persist store with query-backed API calls,
   mirroring how `todo` does it; one-time `localStorage` migration on first load.
3. Recurrence engine: expand a rule over the visible window; edit dialog offering
   "this event / this and following / all events".
4. All-day + multi-day rendering in month and week views; add a day/agenda view.
5. ICS import/export.
6. Honest `minSize`; grid compresses instead of overflowing.

## Must preserve (regression surface)

- Existing events survive the migration — this is the highest-risk part of the
  brief and deserves its own test with a realistic `localStorage` payload.
- Reminders keep firing through `notify()` (Calendar was the second caller,
  brief 40).
- Month and week views keep working, including today-highlighting and navigation.
- The new backend routes are authed and owner-scoped like every other module; no
  `@Public()`.
- `dayjs` stays the only date dependency — do not add a second one for
  recurrence; the common subset is expressible without a full RRULE library, and
  if one is genuinely needed, justify its size explicitly.

## Verify bar

`turbo typecheck`, lint + format green, `turbo build` ok. Backend tests for CRUD
+ auth. Frontend/unit tests for recurrence expansion (weekly-by-weekday across a
month boundary, monthly-by-date hitting a short month, `until`/`count`
termination, a per-instance exception) and for the migration.

**Verified in a browser**: create events, reload, and confirm they persist; open
the OS from a second browser profile and see the same calendar; create a weekly
recurring event and edit one instance without changing the series; export to ICS
and re-import; confirm the last week row is reachable at 1280×577.

## Out of scope

CalDAV/Google sync, invitations and attendees, free/busy, timezone-per-event,
the Todo coupling (deferred), and the core scheduler.
