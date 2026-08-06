# Brief 93 — Core reminder scheduler (one clock for alarms, reminders and due dates)

Status: **todo (ungrilled)** · From the 2026-08-06 feature exploration
([wiki page](../../wiki/feature-exploration-2026-08-06.md)); Tier-2 #5 in
[real-os-gaps.md](../../wiki/real-os-gaps.md). MEDIUM · CORE + a small backend
read-model + three add-on touch-ups. Independent of the open queue; the
service-worker variant is explicitly deferred until brief 50 introduces a SW.

## Problem

Three apps store schedules durably in the container — `clock_alarms`,
`calendar_events` (reminders), `todos` (due dates) — and all three fire
notifications only while their own window is open. All three apologise for it
in their UI ("only while open", briefs 71/72/73 each note it). The user set an
alarm in a real OS and it rings only if the Clock app happens to be open:
this is the single place the "real computer" claim breaks on a schedule.

The honest fix is one OS-level scheduler with desktop lifetime — alive from
login to tab close, regardless of which windows exist.

## Proposed decisions (ungrilled)

- **Desktop-lifetime, not background.** The scheduler runs in core (mounted
  with the shell, like the notification store). It still dies with the tab —
  the honest limitation moves from "while the app is open" to "while the
  desktop is open", which is what a user actually expects from a computer
  whose screen is a browser tab. True background (SW + Notifications API) is
  a future brief gated on brief 50's service worker.
- **The backend aggregates; core ticks.** A read-only
  `GET /api/schedule/upcoming?horizon=<minutes>` in a new thin module returns
  the next fire times across the three tables (alarm occurrences, event
  reminders, due todos), each as `{domain, id, fireAt, title, appId}`.
  Alternative to grill: core polls the three existing domain APIs and computes
  occurrences client-side (no new backend surface, but calendar recurrence
  expansion currently lives client-side in the calendar add-on, which core
  must not import — that asymmetry is the argument for the backend read-model).
- **Core polls the feed** (~30s interval + on tab visibilitychange) and fires
  `notify()` at the right moment with `appId` set, so the toast carries the
  app icon and clicking it opens the owning app via `openApp` with a payload
  pointing at the item.
- **Fired-state is recorded per occurrence** (domain + id + occurrence
  timestamp) so a re-poll or a second tab does not double-fire. Grill where:
  a small `schedule_fired` table (durable, survives reload — recommended) vs
  in-memory (refires on reload).
- **Snooze stays app-owned.** Toasts have no buttons (brief 71 already hit
  this); clicking the toast opens the app, which owns snooze/dismiss UI.
- **The three apps delete their apologies** and their own while-open timers
  where redundant (Clock keeps its in-window ring UI; it just no longer needs
  to be open to get one).
- **Missed-while-away policy**: on login/first poll, anything that fired in
  the last N hours while no desktop was open produces one summarising
  notification ("2 alarms and 1 reminder fired while you were away"), not a
  burst of stale toasts. Grill N.

## Fix

1. Backend `schedule` module: the read-model query across the three tables +
   occurrence expansion for repeating alarms; unit tests on the expansion
   edges (weekday repeat, DST boundary, reminder offset).
2. Core `schedulerService` started by the shell: poll, diff against fired
   state, `notify()`, record.
3. `schedule_fired` table + prune (older than the missed-window).
4. Clock/Calendar/Todo: remove the "only while open" copy; wire toast-click
   payloads to focus the right item.

## Must preserve (regression surface)

- In-window behaviour of all three apps unchanged (Clock's ring screen, the
  calendar reminder dialog, todo overdue styling).
- No double-fire with the app open (the app's own while-open firing must be
  removed or deduplicated through the same fired-state, not left racing).
- DND in the notification store still suppresses toasts but not history.
- Two tabs open = one fire (the durable fired-state is the tiebreak).

## Verify bar

Backend unit tests on the aggregation + expansion; core unit tests on the
tick/dedupe logic (fake timers). **Verified in a browser**: set an alarm, a
calendar reminder and a due todo, close all three apps, watch all three fire
as toasts with correct icons; click each and land in the right app; reload
mid-horizon and confirm no refire; set DND and confirm history-only.

## Out of scope

Service-worker/background notifications (post-brief-50), toast action buttons,
cron-style user-defined tasks (that is the separate scheduled-tasks idea,
gated on brief 80), and any change to how the three apps store their data.
