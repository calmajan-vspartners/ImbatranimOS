# Brief 72 — Calendar: move the data into the container, then add recurrence

Status: **done 2026-08-05** · From the 2026-07-31 app+OS improvement sweep.
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

---

## Outcome — 2026-08-05

Done. The storage complaint and the recurrence gap were exactly right. Two of the
smaller items were not: one was **already implemented**, and another had been
**fixed by a different brief** since this one was written.

### Storage — the mechanism brief 71 landed, copied deliberately

New backend `calendar` module with a `calendar_events` table, camelCase mapped at
the service boundary, class-validator DTOs, and the global `SessionAuthGuard` (the
e2e asserts 401 on all five routes). This is the **fifth** app to persist here and
it invents nothing: brief 71 chose "a typed table per domain, not a generic blob
store" for Clock, and the reason applies unchanged — the DTOs reject
`FREQ=HOURLY`, `interval: 0`, a `2026-7-6` exception date and a colour outside the
palette at the door, which a JSON blob column cannot.

`POST /calendar/import` serves both the one-time `localStorage` hand-over and ICS
import, differing only by an `onlyIfEmpty` flag: the migration refuses a non-empty
table (so two tabs opening together cannot double the calendar), an ICS import
appends. The brief calls the migration "the highest-risk part" and asks for a test
with a realistic payload; `legacyCalendarState.test.ts` uses the exact zustand
blob the old store wrote, uuid ids and `reminderFired` flags included, and pins
that a missing or backwards `end` is repaired to an hour rather than dropping the
event.

Measured, seeding that blob into a fresh browser:

```
before opening Calendar: []
after opening Calendar : [[1,"Dentist",false,null],[2,"Old holiday",true,null]]
legacy key still there : false
notifications          : [warning "Some old events were skipped"],
                         [success "Calendar moved into your computer"]
month grid cells       : {"Dentist":1,"Old holiday":4}     ← 4-day event, 4 cells
after reload, grid     : {"Dentist":1,"Old holiday":4}
any calendar localStorage: []
```

**`reminderFired` is deliberately not migrated.** It was a persisted boolean per
event, and that model cannot survive recurrence: the first ring would set the flag
and silence every later occurrence of the series forever. The guard is now
`eventId:YYYY-MM-DD` in a session-scoped Set — `FIRE_WINDOW_MS` already stops a
reopened window from replaying old triggers, so persistence would only add silence
for a reminder that is still due.

### Recurrence — a rule, expanded for the visible range, and no library

`dayjs` stays the only date dependency, as the brief requires. The supported subset
(daily / weekly by weekday / monthly by date / yearly, `until` or `count`, plus
exceptions) is ~120 lines; the rest of RFC 5545 is refused rather than
approximated. Instances are **never materialised** — a weekly standup is one row,
and the views ask for the occurrences in the window they are painting.

Two decisions the tests forced into the open, which look the same and are not:

- **A month too short to hold the date generates nothing, so it consumes no
  `count`.** "The 31st, monthly, four times" from January is Jan, Mar, May, Jul.
  (My first test asserted the opposite; the implementation was right and the test
  was wrong.) Jan 31 also does **not** slide to Feb 28 — sliding invents an
  occurrence on a date the user never picked, and the slid date then differs from
  every other month in the series.
- **An instance removed by an exception does consume its index and its count.**
  Deleting the third of ten does not promote the fourth into being the third, and
  "10 times" does not quietly become 11.

`MAX_OCCURRENCES = 750` caps one expansion, so a daily rule asked for over a
decade cannot build 3650 objects per render.

### The three edit scopes, as pure plans

`seriesEdit.ts` returns a **plan** (patch / create / delete) rather than mutating,
so the subtle part is testable without a dialog:

- **All** applies the change as a *delta*. Open the third Monday, change 09:00 to
  10:00, choose "all events" → the series start moves to 10:00 **on its own
  original date**. Setting the series start to the edited occurrence would
  silently delete every earlier occurrence, which is the obvious implementation and
  wrong.
- **This event** detaches: an exception on the series plus a standalone event. No
  override table — an override row needs its own identity, lifecycle and merge
  rules, where a detached event is something the user already understands.
- **This and following** splits. The head gets `until` = the day before; the tail
  carries the rule forward. A `count` is divided (10 split at the third → head
  ends on a date, tail gets 8, total still 10), and existing exceptions go to
  whichever half still contains them. Splitting at the *first* occurrence collapses
  to "all", because truncating a series to end before its own start leaves an empty
  series behind.

A test expands both halves and asserts they cover the original dates exactly once
each — no gap, no duplicate.

Verified through the UI, from creating the series to splitting it:

```
stored                 : [[15,"Standup",{"freq":"weekly","interval":1},[]]]
instances on the grid  : 5                       ← from one row
after "this event"     : ["Standup" weekly exceptions=["2026-08-17"]],
                         ["Standup (moved)" one-off]
  series instances     : 4   detached: 1         ← 5 again, series intact
after "this+following" : ["Standup" weekly until=2026-08-23],
                         ["Standup v2" weekly]
  head: 2   tail: 2
```

### ICS, and what it refuses to pretend

Export/import round-tripped through the **real filesystem** — the OS save dialog,
`uploadFileBytes`, then the OS open dialog and back:

```
export notification : [success "Calendar exported", "3 events written to probe-export.ics"]
after import        : [["Trip",allDay,null,null],
                       ["Standup",timed,{weekly,byWeekday:[1,3,5]},10],
                       ["Night shift",timed,null,null]]
notification        : [success "Calendar imported", "3 events imported"]
```

Three details worth naming:

- **All-day `DTEND` is exclusive**, as the spec requires: a one-day event on the
  6th is written as `DTEND;VALUE=DATE:20260707`. This is the classic off-by-one
  that makes imported all-day events a day short in one direction and a day long in
  the other, and it is pinned by a round-trip test.
- **Times are floating local**, no `TZID` and no `Z`, because that is precisely
  what this app's model means. A `Z` on the way *in* is converted; a `TZID` is read
  as wall-clock and **counted**, so the import message can say so.
- **An RRULE outside the subset is refused, not approximated.** `FREQ=MONTHLY;
  BYDAY=-1FR` ("last Friday") imports as a single event and increments a counter;
  quietly turning it into "monthly on the 26th" would be wrong every month with no
  way for the user to notice. `describeImport` reports all of it.

### Two brief items that were not what the brief said

**"No all-day events" is wrong.** `allDay` was in the type, the dialog had the
checkbox, and both views handled it — that item shipped in Wave C. What was
genuinely missing is **multi-day rendering**: both views filtered on
`dayjs(event.start).isSame(day)`, so a three-day trip was visible on its first day
and invisible on the other two. Now every view asks for occurrences that *overlap*
the day. Measured above: 4 cells for a 4-day event.

**"The bottom row clips at 1280×577" is already fixed** — by brief 52's window
clamp, which landed after this brief was written. Measured at exactly that
viewport: the window is clamped to 533px and the last week row's bottom is 513
against a taskbar top of 533. Nothing clips.

But the `minSize` *was* dishonest, for a different reason than the brief gives.
The grid compresses rather than overflowing, so the real question is not "does it
fit" but "does it still say anything". At the declared 480×380 a week row is
**25px** — the date number (20px) and nothing else, six times over. And below 520px
wide the toolbar wraps to a second line (33px → 64px), taking 31px straight out of
the grid. `minSize` is now **520×400**, where a row is 46px and shows the date plus
one event.

### Found while probing, in no brief

- **A midnight-crossing timed event was being drawn as an all-day banner.** The
  first cut routed everything multi-day to the banner row, which turned a 22:00 →
  02:00 night shift into a two-day bar with no times on it. The banner is now
  all-day only; timed events are clipped per day, measured as two blocks —
  `top:1056 height:96` (22:00–24:00) and `top:0 height:96` (00:00–02:00).
- **Unticking "All day" left a 24-hour block.** Clicking a month day cell creates
  an all-day 00:00–23:59 slot, so removing "all day" produced a midnight-to-
  midnight event — nobody's meeting. It now snaps to 09:00–10:00, but only when
  the event sits on a single day (a three-day span keeps its span).

### Also delivered

An **Agenda view**, which is the more useful reading of the brief's "day or agenda
view" — a day view is a week view with one column, whereas a list answers "what is
next?". It is also the only view where **search** is meaningful: a match three
months out is unreachable in a month grid and is one row here. Plus a six-colour
palette per event, shared by all three views through one `eventStyle` module so the
same event cannot be amber in one and blue in another.

### Left alone, deliberately

Drag-to-move/resize (in the brief's problem list, not its Fix list — it needs a
pointer-drag model and per-view hit testing, and deserves its own brief), the
Todo coupling (the brief defers it, and it must go through the kernel rather than
app-to-app), the core scheduler, CalDAV/Google sync (rejected: network egress plus
stored credentials), attendees, free/busy and per-event timezones.

### Verified in a browser, against the production bundle on the real backend

```
PASS the old localStorage calendar is adopted once, and the key is removed
PASS an unreadable legacy entry is reported, not silently dropped
PASS events survive a reload with no calendar localStorage at all
PASS a 4-day all-day event now appears in all 4 month cells (was 1)
PASS a weekly series created in the UI shows 5 instances from one stored row
PASS "this event" excepts the instance and detaches it; the series keeps the rest
PASS "this and following" splits into two series with no gap and no duplicate
PASS the week view shows an all-day banner spanning the days it covers
PASS a 22:00-02:00 event draws as two clipped blocks, with its times
PASS a recurring event's Mon/Wed/Fri instances land at 09:00, 30 min, from one row
PASS export writes valid ICS to the real filesystem through the save dialog
PASS import reads it back with the RRULE and the VALARM reminder intact
PASS an unrepresentable RRULE imports as a single event and says so
PASS unticking "All day" gives a 60-minute event, not a 24-hour one
PASS the last week row is inside the desktop at 1280x577
PASS a week row shows the date plus an event at the declared minSize
page errors: none
```

Tests: frontend vitest **701 → 782** (81 new in a package that had **zero** —
recurrence, ICS, series editing and the migration), backend e2e **59 → 80** (21
new), backend unit unchanged at 208. All 98 turbo tasks green. Zero new
dependencies.
