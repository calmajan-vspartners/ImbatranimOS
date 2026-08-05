# Brief 71 — Clock: fix the countdown off-by-one, and move state into the container

Status: **done 2026-08-05** · From the 2026-07-31 app+OS improvement sweep.
EASY/MEDIUM · add-on `apps/add-ons/clock` (883 LOC / 11 files; `zustand`).
Standalone. Lands the timer fix that was written on 2026-07-19 but never
committed (it was blocked on read-only permissions and the patch is gone).

## Problem

**1. The countdown is off by one, and here is exactly where.**
`format.ts:8` rounds:

```ts
const total = Math.max(0, Math.round(ms / 1000))
```

For a *countdown* that is wrong at both ends. Start a 5:00 timer: `05:00` is
displayed for only ~0.5s before `Math.round` flips it to `04:59`, so the first
second looks half-length. At the end, 400ms remaining rounds to `0` and the
display reads `00:00` while the timer has not fired yet — the classic
off-by-one. A countdown must use `Math.ceil`: any non-zero remainder shows at
least `00:01`, and `00:00` means finished.

The fix is safely scoped: `formatClockDuration` is used **only** by the Timer
(`tabs/Timer.tsx:40`); the Stopwatch has its own `formatStopwatch`
(`tabs/Stopwatch.tsx:26,73`) where `floor` is the correct rule for elapsed time.
So this is a one-word change plus tests — but the two functions should carry a
comment saying why they differ, or someone will "unify" them and reintroduce it.

The underlying timing model is already correct and should not be touched: the
timer is timestamp-driven (`endAt - now`), so pausing, resuming, or backgrounding
the tab never drifts (`Timer.tsx:18-22`).

**2. Alarms and timers only fire while the app is open.** The app already says
so, in the Alarms tab (`tabs/Alarms.tsx:84`) — that disclosure shipped with Wave
C and is correct, so nothing needs adding there. What remains is the underlying
limit: a closed app has no code running, so an alarm set for tomorrow will not
ring. The honest fix is an OS-level scheduler, not more wording.

**3. State lives in the viewing browser.** The clock store persists via zustand
to `localStorage`, so world clocks, alarms and timers belong to the laptop you
happened to open the OS from, not to the container. That contradicts "the
computer is the container" and means two tabs share and stomp one store.

**4. Smaller gaps**: one timer at a time (no named/multiple timers), no snooze,
no alarm repeat/weekday schedule, no stopwatch laps export, and no analog face.

## Proposed decisions (ungrilled)

- **`Math.ceil` for the countdown**, `floor` stays for elapsed, with a comment in
  both explaining the asymmetry and tests pinning it.
- **The disclosure already exists** (`tabs/Alarms.tsx:84`) and stays. Do not add
  a second copy of it.
- **Make it not need saying, via the OS not this app.** The real fix is a
  core-level scheduler — the notification centre (brief 34) already exists, so
  the missing piece is something that survives the app window. Options worth
  grilling: a core-owned scheduler that runs while the *desktop* is open (fixes
  the common case, still dies with the tab), or a Service Worker with
  Notifications for true background firing (which the OS has no service worker
  for today — brief 50 would introduce the first one, at a dedicated scope).
  **Proposal: spec the core scheduler separately** and do not build a
  half-scheduler inside Clock.
- **Move persisted state to the backend** with the same reasoning as Calendar
  (brief 72) — they share the problem and should share the mechanism, so
  sequence them together and land the storage decision once.
- **Multiple named timers + snooze + weekday alarm repeat** as the feature round,
  after the correctness work.
- **Rejected — an analog clock face.** Decorative, and the identity is
  Win7-classic B&W, not skeuomorphic.

## Fix

1. `format.ts`: `Math.ceil` in `formatClockDuration`; comment both functions;
   unit tests covering 5:00 start, the sub-second tail, exact zero, and the
   stopwatch's opposite rule.
2. Storage: move the clock store behind the same backend-persistence mechanism
   chosen for Calendar; keep a migration that imports any existing
   `localStorage` state once so users do not lose alarms.
3. Multiple named timers (list model rather than a single timer), snooze on a
   fired alarm, weekday repeat on alarms.

## Must preserve (regression surface)

- The timestamp-driven model — no `setInterval` accumulation, no drift across
  pause/resume/tab-background. Re-verify after the multiple-timers change, which
  is where a naive rewrite would reintroduce drift.
- Alarm/timer firing still routes through `notify()` (Clock was the first
  caller, brief 36).
- World clocks keep using `Intl` and stay DST-correct.
- The tray clock and this app continue to agree.
- Stopwatch behaviour and lap timing unchanged.

## Verify bar

`turbo typecheck`, add-on lint + format green, `turbo build` ok. Unit tests as
above, plus a test that a timer's remaining time is computed from timestamps and
survives a simulated pause/resume.

**Verified in a browser**: start a 5-second timer and watch it show `00:05` for a
full second and `00:01` until it actually fires; run a timer, switch tabs for a
minute, come back and confirm no drift;
confirm alarms survive a reload after the storage move.

## Out of scope

The core scheduler itself (its own brief), service-worker notifications, analog
face, and world-clock map/DST visualisation.

---

## Outcome — 2026-08-05

Done. This is the first brief in the run whose problem list was **accurate in every
item** — the `Math.round` was exactly where it said, the disclosure it told me not to
touch was already there and already correct, and the storage complaint was right for
the reason it gave. So the work was to do it, not to correct it.

### The off-by-one, measured

`Math.round` → `Math.ceil` in `formatClockDuration`, one word, and the comment the
brief asked for on **both** formatters saying why they differ. A countdown answers
"how long until it fires?", so any non-zero remainder must read at least `00:01`; a
stopwatch answers "how much has passed?", so time that has not passed must not be
shown. Merging them breaks one of the two.

Sampled from inside the page, a 6-second countdown, ms since Start:

```
      1ms  00:06   (shown 1036ms)
   1037ms  00:05   (shown  983ms)
   2020ms  00:04   (shown 1018ms)
   3038ms  00:03   (shown  993ms)
   4031ms  00:02   (shown  992ms)
   5023ms  00:01   (shown 1013ms)
   6036ms  00:00   ← and the notification fires here
```

Every second gets a second, and `00:00` appears when the timer ends rather than
400ms early. The brief's verify bar asks to watch a **5-second** timer, which the app
could not express: presets are whole minutes and the custom box parsed minutes, so
the shortest timer settable was `1:00`. Added `parseDurationInput`, which keeps a
bare number meaning minutes (what the box always meant, and what the presets beside
it are) and reads anything with a colon as clock parts — `0:30`, `1:30`, `1:02:03`.

### A glitch the probe found that no brief mentions

Pressing Start on that 6-second timer showed **`00:08` for 263ms** first. `useNow`
freezes while inactive, so the first render after `active` flips true used a `now`
from before the click, and `endAt - staleNow` exceeded the duration. Fixed twice
over: `useNow` schedules a zero-delay catch-up tick alongside the interval, and
`remainingMs` is now clamped to `durationMs` — a countdown can never have more time
left than its own length, and that invariant is worth stating in code regardless of
who calls it.

### Storage: the same mechanism as three apps already use, not a new one

The brief says to "land the storage decision once" for Clock and Calendar (brief 72).
The decision is that **there is no new mechanism**: a typed table per domain plus a
NestJS module, exactly as `todos`, `sticky_notes` and `bookmarks` do. A generic
key-value blob store was considered and rejected — it would have accepted a malformed
alarm time silently, where DTOs reject `7:00`, `25:00` and `MTWTF..` at the door.
Brief 72 should copy this shape, not invent a second one.

New `clock` module: `clock_world_clocks` and `clock_alarms`, session-guarded by the
global `SessionAuthGuard` (no `@Public()`, and the e2e asserts 401 on all six
routes). Two deliberate choices:

- **camelCase at the service boundary.** The older modules return raw rows, so
  `pos_x` and `created_at` leak into React props. New surface, so it starts clean;
  the old ones keep their shape because changing them is a client-visible break with
  no user-facing gain.
- **`lastFiredAt` is opaque to the server.** A "07:00" alarm is due according to the
  *viewer's* wall clock, so the client that rang it writes the guard key. A server
  clock deciding this would be a second, disagreeing source of truth.

The migration is a `POST /clock/import` that refuses to import into a non-empty
table, inside a transaction — so two tabs opening at once cannot produce two copies
of every alarm, and the client may call it whenever it still finds the legacy key.
Imported alarms are given the **every-day** mask, because that is what they actually
did before repeat existed; importing them as one-shots would quietly change what the
user had. Unreadable entries are counted and reported, not dropped in silence.

Measured end to end, seeding the exact zustand-persist blob the old app wrote:

```
before opening Clock, alarms in container: []
after opening Clock, alarms  : [07:00 "Wake up" days=1111111, 18:30 "" days=1111111 disabled]
after opening Clock, clocks  : [Tokyo Asia/Tokyo]
legacy localStorage key still present: false
migration notifications      : [warning "Some old clock entries were skipped"],
                               [success "Clock data moved into your computer"]
after reload, alarm rows     : ["07:00", "18:30"]
after reload, any clock localStorage: []
```

### Snooze has to live in the window, because a toast has no buttons

`notify()` raises a toast, and there is no notification-action API — a Snooze offered
only from the notification centre would be one the user cannot press. So a ringing
alarm puts a banner **above the tab strip**, visible from every tab, with Snooze 5
min and Dismiss. Snoozing patches `enabled: true` as well as `snoozedUntil`, which
matters: a one-shot alarm has just disabled itself, and without the re-arm the snooze
would silently never arrive. A pending snooze also suppresses the scheduled time, or
snoozing at 07:00:10 would ring again at 07:00:11 while the clock still read 07:00.

Weekday repeat is a 7-character Monday-first mask (`getDay()` is Sunday-first, which
is exactly the sort of thing a test should pin). All zeros means "ring once, then turn
yourself off" — what a phone does, and the only reading under which "Once" means once.

Waited for a real minute boundary rather than faking one:

```
created for 17:24 : days=0000000 enabled
after Tue+Thu     : days=0101000, row reads "Tue, Thu"
banner appeared   : true
after ringing     : enabled=false, lastFiredAt="Wed Aug 05 2026 17:24"   ← one-shot self-disabled
notifications     : [["Alarm","Probe alarm — 17:24"]]
after Snooze      : enabled=true, snoozedUntil=+5min
banner still up   : false
row snooze line   : "Snoozed — rings again at 17:29"
```

### Multiple timers, without reintroducing drift

The brief flags this as the regression surface, so the transitions moved into
`timerModel` as pure functions that take `now` as an argument — `start` turns a
remaining span into an end instant, `pause` turns it back, and `remainingMs` is the
only source of the displayed value. Nothing counts ticks. One interval for the whole
tab, shared by every card, so four timers still read the same instant.

Verified against a genuinely backgrounded tab (a second page brought to the front,
so Chromium really throttles): after 72s away the display read `03:49` where the wall
clock said `03:49`. Paused at `03:49`, still `03:49` six seconds later, `03:47`
1.5s after resuming. Two named timers ran independently (`Tea` 04:58, `Pasta` 08:59)
with the Timer tab showing a `2` badge for the running count.

### Layout, measured at the declared minSize

The badges pushed the four-tab strip past the window width and clipped `ALARMS`.
Tightened the tab padding and made the strip `flex-wrap`, so at the declared 300×420
it becomes two rows instead of cutting a label in half: strip 33px → 59px, zero
horizontally-overflowing elements anywhere, alarm list still scrollable.

Two things learned while fixing the New-alarm row, both worth passing on:

- **`Input` forwards `className` to the `<input>`** and leaves its own wrapper div
  intrinsically sized, so sizing the component does nothing to its footprint. The
  width has to go on a wrapper you own.
- **The spacing scale is rem against a 13px root**, so `w-36` is 117px, not 144. The
  original `w-28` (91px) is why the time field showed `:24 PM` in a 12-hour locale.

### Left alone, deliberately

The core scheduler. A closed app has no code running, and the brief is right that the
honest fix is OS-level — so no half-scheduler was built inside Clock, and the existing
disclosure stays (extended by one sentence, now that the alarms genuinely are in the
container). Also untouched: service-worker notifications, an analog face, world-clock
map/DST visualisation, stopwatch laps export, and the stopwatch itself.

### Verified in a browser, against the production bundle on the real backend

```
PASS the legacy localStorage blob is adopted once, and the key is removed
PASS imported alarms keep ringing daily (mask 1111111), unreadable entries are reported
PASS alarms and world clocks survive a reload with no clock localStorage at all
PASS a 6-second countdown shows 00:06 for a full second and 00:00 only when it fires
PASS 0:06 is settable at all (mm:ss), which the minutes-only box could not express
PASS no 00:08 flash on Start any more
PASS no drift after 72s in a backgrounded tab (03:49 shown, 03:49 expected)
PASS pause holds, resume continues from where it stopped
PASS two named timers run independently; the Timer tab badges the running count
PASS an alarm rings at its minute, once, through notify()
PASS a one-shot alarm disables itself after ringing and says so in the row
PASS weekday repeat persists and reads back as "Tue, Thu"
PASS Snooze re-arms the alarm and the row says when it will ring
PASS a pending snooze does not re-ring at the scheduled minute
PASS world clocks add/remove through the API; Tokyo GMT+9, Berlin GMT+2 (Intl, DST-correct)
PASS the tray clock and the app's big clock agree (17:49 / 17:49:39)
PASS the tab strip wraps rather than clipping at the declared 300×420 minSize
PASS "07:00 AM" is fully visible in a 12-hour locale
page errors: none
```

Tests: frontend vitest **647 → 701** (54 new in a package that had **zero**), backend
208 unit unchanged and e2e **46 → 59** (13 new for the clock module). All 97 turbo
tasks green. Zero new dependencies.
