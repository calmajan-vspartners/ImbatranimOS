# Brief 97 — Auto-lock after idle

Status: **todo (ungrilled)** · From the 2026-08-06 feature exploration
([wiki page](../../wiki/feature-exploration-2026-08-06.md)); Tier-2 #4 in
[real-os-gaps.md](../../wiki/real-os-gaps.md). EASY · CORE + Settings.
Independent; real value arrives with the VPS/HTTPS deployment (brief 15).

## Problem

Lock exists in the Start menu, but nothing ever locks by itself. On the
intended deployment — an internet-reachable VPS behind Caddy — a desktop left
open in a browser on a shared machine stays open indefinitely. Every real OS
locks after idle; the server-side `SESSION_TTL_HOURS` is the wrong tool (it
kills the session outright, hours later, and says nothing about the screen).

## Proposed decisions (ungrilled)

- **Client-side idle detection in core**: pointer/keyboard/wheel activity
  resets a timer; on expiry, invoke the exact Start-menu lock path — one lock
  implementation, no parallel state.
- **Setting in Settings → Security**: Off / 5 / 15 / 30 minutes. Grill the
  default — Off preserves current behaviour; 15 min is the defensible
  security default. Recommendation: **15 min**, because the deployment story
  is "exposable to the internet" and the cost of a surprise lock is one
  password entry.
- **Durable user config**: the chosen timeout is a brief-49-shaped pref
  (dotfile/prefs row when 49 lands; localStorage in the same key style until
  then).
- **Idle means idle in this tab.** No cross-tab coordination in v1: each tab
  locks itself (the lock screen is per-tab UI over a still-valid session —
  matching how the manual Lock behaves today). Grill whether a locked tab
  should also drop in-memory clipboard/palette state; recommendation: no,
  lock is a screen, logout is the credential boundary.
- **Media playback counts as activity** (grill): a movie in the media player
  should probably hold the lock the way real OSes hold the screensaver.
  Cheapest honest rule: a playing `<audio>/<video>` element in any window
  suppresses the timer; otherwise ship v1 without the exception and let the
  walkthrough decide.
- **TOTP interaction unchanged**: unlocking is the lock screen's existing
  password (+TOTP if enrolled) flow.

## Fix

1. Core `useIdleLock` started by the shell: listeners (passive), timer,
   `visibilitychange`-aware (a hidden tab still locks on schedule).
2. Settings → Security: the timeout select, persisted.
3. Optional media-playback suppression per the grill outcome.
4. Unit tests with fake timers: reset-on-activity, fire-at-expiry,
   off-means-never, setting change mid-countdown.

## Must preserve (regression surface)

- Manual Lock, the lock screen, TOTP step-up, and session TTL semantics all
  unchanged — this brief adds a trigger, not a new lock.
- No timer churn on every mousemove (throttle the reset; the listener must
  be passive and cheap).
- The PTY/WebSocket survives a lock (locking is not a disconnect; brief 56's
  reconnect behaviour must not be tripped by it).

## Verify bar

Unit tests above; `turbo` gates green. **Verified in a browser**: set 5 min
(or a dev-only shorter value), walk away, find the lock screen; unlock and
confirm windows/terminal scrollback intact; set Off and confirm no lock;
background the tab and confirm it still locked on time.

## Out of scope

Cross-tab lock broadcast, a screensaver, server-side idle eviction changes,
and "lock on browser close" (that is what the session cookie already does).
