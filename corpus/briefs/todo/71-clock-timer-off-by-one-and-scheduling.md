# Brief 71 — Clock: fix the countdown off-by-one, and move state into the container

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
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
