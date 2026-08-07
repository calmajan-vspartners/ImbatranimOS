# Brief 107 — Actionable notifications: click-to-open, the app icon, and intent-shaped toast actions

> **Outcome (2026-08-07): DONE.** `SystemNotifyInput` gained
> `actions?: readonly {label, payload}[]` — additive and optional, so no
> `PROTOCOL_VERSION` bump — and the handle needed no change at all: it already
> spreads the input while stamping `appId`, so an app can only press buttons in
> its own name. Toasts gained a clickable body (the panel row for the same item
> always had it), a shared `NotificationIcon` that renders the raising app's
> icon on BOTH surfaces and falls back to the level glyph (fulfilling
> ui-conventions §23, which neither surface had ever delivered), an action row
> of real buttons, and a hover/focus-within hold on the 6 s auto-dismiss so a
> button is never a race against the timer. History rows keep click-to-open and
> render no actions. `notify` only writes the `actions` key when non-empty, so
> every existing caller's persisted JSON is byte-identical. Clock is the first
> adopter: the alarm toast carries Snooze, and Clock subscribes via
> `onIntent` (brief 108's pattern) with a pure `normaliseClockIntent` guard.
>
> **A real regression, found by this probe and fixed here:** brief 106's
> Enter-opens-selection listener called `preventDefault` on Enter *globally*
> whenever a desktop icon was selected — so the toast's focused Snooze button
> never received its click, and the desktop opened its selection instead. It is
> now scoped hard to `e.target === document.body`, which is exactly the
> after-a-marquee case it was written for; brief 106's probe still passes
> 24/24.
>
> Verified: 4 store units + 4 clock intent units (turbo 120/120) and a 13/13
> Playwright pass on the production bundle — with Clock CLOSED an alarm toast
> showed its icon and Snooze, hovering held it past 8 s, the button took
> keyboard focus, Enter opened Clock with the alarm snoozed and no ringing
> banner, and the toast was gone; panel rows list the item with no action
> buttons.

Status: **done 2026-08-07** · From the 2026-08-07 research sweep. MEDIUM ·
CORE (`ToastHost.tsx`, `NotificationPanel.tsx`, `notificationStore.ts`) +
PROTOCOL (`packages/ui/src/system.ts` — `SystemNotifyInput` gains `actions`,
an API decision under the file's own rules) + one adopter (`clock`). No new
deps, no new dotfile store. Lands on the same `onIntent` delivery brief 108
proves out with Archive Manager — build 108 first or together.

## Problem

1. **A live toast is a dead end.** `ToastHost.tsx:21-53` renders title, body
   and a dismiss X — no `onClick`, and the X is the only focusable element.
   The panel row for the *same item* opens the raising app
   (`NotificationPanel.tsx:12,20-32,126-129`), so the toast is strictly less
   capable than its own history entry, and it auto-dismisses in 6s
   (`ToastHost.tsx:10`) while the user hunts for the window.
2. **The documented icon promise is delivered nowhere.** ui-conventions §23
   says "always pass `appId` so the item gets your icon and click-to-open" —
   but both surfaces render only the `LevelIcon`; no notification UI ever
   shows the raising app's icon. (The backlog row calls the icon "parity with
   the panel"; the panel doesn't have it either — this is fulfilling §23 on
   both surfaces, not copying one to the other.)
3. **No actions, and the OS documents the pain.** `SystemNotifyInput` is
   `{title, body?, level?}` (`system.ts:210-214`); `NotifyInput` adds only
   `appId` (`notificationStore.ts:21-26`). `RingingBanner.tsx:7-14` says it
   outright: "a toast has no buttons — so a snooze offered only from the
   notification centre would be a snooze the user cannot press." Since brief
   93, `ClockBackground.tsx:79-86` fires alarm toasts **with no Clock window
   open** — exactly when a button-less toast hurts most. Dismiss it, open the
   Start menu, launch Clock, find the alarm: four steps where every real OS
   offers one.

## Proposed decisions (ungrilled)

- **Actions are intent-shaped data, never closures**: `actions?: { label:
  string; payload: unknown }[]` on `SystemNotifyInput`. Activating one calls
  `openApp(item.appId, action.payload)` — the exact choke point every launcher
  already funnels through (`openApp.ts`). Survives postMessage because it is
  pure data; survives the persisted history (`notificationStore` persists to
  localStorage) and the owning window being closed, which no callback can.
  Rejected: callbacks (the `system.ts` header says a transport can proxy them,
  but a closure cannot outlive a reload or ride in persisted history);
  rejected: a new background-action bus (new protocol surface for a need
  `openApp` + `onIntent` already serve).
- **No `appId` on the action — the handle stamps it**, exactly as `notify`
  itself does (`system.ts:205-209`, `createSystemHandle.ts:235`): an app's
  toast can only press buttons in that app. Rejected: caller-chosen target
  (not a real escalation since `openApp` is unrestricted, but it breaks the
  stamping symmetry for zero named use case).
- **Activating an action opens/focuses the owning app.** For Clock's Snooze
  that means the Clock window opens with the alarm snoozed. Accepted trade,
  stated plainly: one delivery mechanism, no invisible background channel.
  Rejected: suppressing the window (requires the bus rejected above).
- **Click-to-open on the toast body mirrors the panel Row**: clickable only
  when `appId` is set, `role="button"` + Enter/Space, inner buttons
  `stopPropagation` — the same shape as `NotificationPanel.tsx:14-32`.
- **App icon on both surfaces** when `appId` resolves in `APP_REGISTRY`;
  severity stays visible via the existing stripe. `LevelIcon` remains the
  fallback for appId-less items. Rejected: toast-only (perpetuates §23's gap
  in the panel).
- **Actions render on live toasts only**; history rows keep click-to-open.
  A stale Undo pressed hours later from history is a footgun. The data may
  persist on the item (it is JSON, harmless) but the panel never renders it.
- **Hover or focus-within pauses the auto-dismiss timer** — buttons must not
  be a race against 6 seconds. Errors stay sticky as today. Rejected: raising
  the global timeout.
- **Adopter in this brief: Clock alarm Snooze.** The alarm toast carries
  `{ label: SNOOZE_LABEL, payload: { action: 'snooze', alarmId } }`; Clock
  (single-instance, consumes no intents today) subscribes via
  `system.intents.onIntent` and applies `snoozePatch` — the brief-108 pattern,
  second consumer. Undo for destructive flows is *enabled* by this brief and
  adopted per-app later.

## Fix

1. `packages/ui/src/system.ts`: add `actions?: readonly { label: string;
   payload: unknown }[]` to `SystemNotifyInput` with a doc comment naming the
   data-only contract (payloads are `openApp` payloads). Additive and
   optional — no `PROTOCOL_VERSION` bump.
2. `notificationStore.ts`: `NotifyInput` and `NotificationItem` gain
   `actions`; `persist`/`partialize` untouched (items without `actions`
   deserialize as today — no migration).
3. `ToastHost.tsx`: clickable body when `appId` (`openApp(appId)` +
   `dismissToast` + `markRead`); app icon via `APP_REGISTRY` lookup; an action
   row of real `<button>`s (each: `openApp(appId, payload)`, then dismiss +
   markRead); pause the dismiss timer on mouseenter/focus-within, resume on
   leave/blur; keep `role="status"`.
4. `NotificationPanel.tsx` Row: app icon when `appId` resolves, `LevelIcon`
   otherwise. No action buttons here (decision above).
5. `clock`: `ClockBackground.tsx` adds the Snooze action to the alarm toast
   (`:81-85`); `Clock.tsx` subscribes `system.intents.onIntent`, normalises
   `{ action: 'snooze', alarmId }`, applies `snoozePatch` +
   `applyAlarmPatchLocally`/`patchAlarm` and clears the ringing banner —
   reusing exactly what `RingingBanner.tsx:36-39` does.
6. Tests: store carries and persists actions; toast body click opens + a
   dismiss-X click does not; action click delivers the payload through a
   mocked `openApp`; Tab reaches body → actions → X and Enter activates;
   timer pauses under focus; `createSystemHandle` passes `actions` through
   with the stamped appId.

## Must preserve (regression surface)

- Error toasts sticky; non-error auto-dismiss at 6s when unhovered/unfocused;
  the 5-toast render cap and `MAX_HISTORY` bound.
- DnD still records history without toasts; the brief-93 `schedule.claim`
  path still yields exactly one toast per occurrence across tabs.
- The host overlay stays `pointer-events-none` (only toasts take events) at
  `z-[8500]`, anchored above the taskbar.
- Stamping: an app still cannot toast — or now act — in another app's name.
- Persisted history written by today's build loads cleanly (no shape break).
- Existing `notify` callers (no `actions`) render pixel-identical except for
  the app icon.

## Verify bar

`turbo typecheck`, lint + format, `turbo test`, `turbo build` green. Unit
tests as in Fix 6 (core vitest + clock vitest for the snooze intent handler).

**Verified in a browser** (production bundle + real backend): with Clock
closed, set an alarm a minute out; the toast shows Clock's icon and a Snooze
button; Tab to Snooze, press Enter — Clock opens with the alarm snoozed and
no ringing banner, and the toast is gone. Raise an error toast from an app,
click its body — the app focuses. Open the tray panel — rows show app icons;
history rows still open apps and show no action buttons.

## Out of scope

Undo adoption in file-manager/trash flows (the pattern ships, adopters are
later briefs); action buttons in the panel history; per-toast timeout config;
notification sounds; a background action channel; grouping/coalescing;
brief 108's Archive Manager work (separate brief, same seam).
