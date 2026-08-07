# Brief 101 — Lock keeps the desktop: overlay lock screen + sliding session expiry

Status: **todo (ungrilled)** · From the 2026-08-07 research sweep. MEDIUM ·
CORE (`AuthGate.tsx`, `authStore.ts`, `LockScreen.tsx`, `useIdleLock.ts`,
`StartMenu.tsx`, the three hotkey chokepoints) + BACKEND auth
(`session.service.ts`, `auth.guard.ts`, `auth.controller.ts`, `env.schema.ts`,
one deliberate line in `pty.gateway.ts`). No protocol change, no new deps, no
new dotfile store. Complements brief 102; feeds brief 125 (same sessions
table). The backlog's session-reattach rejection stands — this overlay is the
client-side honest version of that want.

## Problem

1. **Locking throws away the machine.** `AuthGate.tsx:79-81` swaps the entire
   desktop tree for `<LockScreen/>` whenever `authenticated` flips false, and
   auto-lock is on by default at 15 minutes (`securityStore.ts:15`).
   `useIdleLock.ts:6-14` admits it in its own docstring: "locking unmounts the
   desktop and this hook with it". Unmounting the Terminal closes its socket,
   and the backend kills the pty on socket close (`pty-session.ts:63,97`);
   reconnecting spawns a **new shell** by design (`usePtyConnection.ts:42-48`).
   Every dirty buffer in the nine editors is discarded too — `useUnsavedGuard`
   only vetoes `closeWindow` (`systemHooks.ts:59-66`); the unmount path never
   consults it. Walk away for 15 minutes, lose your running command and your
   unsaved text.
2. **Any 401 is the same catastrophe.** The axios interceptor
   (`lib/axios.ts:14-23`) dispatches `auth:unauthorized`, and `AuthGate.tsx:62-67`
   answers with the same full unmount. A session that quietly hard-expired
   costs the user everything open, with zero warning.
3. **Expiry is fixed while its comment says sliding.** `env.schema.ts:33`
   reads "sliding — validation refreshes last_seen but not expiry";
   `validate()` (`session.service.ts:54-70`) refreshes only `last_seen`, so a
   user who works daily is hard-dropped exactly `SESSION_TTL_HOURS` (168h)
   after login, mid-keystroke — which today is problem 2.

## Proposed decisions (ungrilled)

- **Lock becomes state, not unmount.** A `locked` flag in `authStore`; while
  locked the desktop stays mounted but invisible (`visibility: hidden` +
  `inert` + `aria-hidden`) beneath an opaque overlay. PTY sockets never close,
  React buffer state survives. Rejected: server-side terminal reattach —
  already rejected in `real-os-gaps.md`; keeping the component alive needs no
  server session state at all.
- **401 re-authenticates in place.** Once this tab has been authenticated, a
  401 shows the overlay over the still-mounted desktop instead of unmounting.
  Buffers survive re-login; the shell process honestly does **not** — the pty
  revoke sweep (`pty.gateway.ts:146-153`) kills PTYs of invalid sessions
  within 30s, and that is a security behaviour to preserve, not fight.
  Rejected: treating expiry like lock (a dead session must not keep a live
  shell).
- **Sign-out stays a full teardown.** Explicit log off (`StartMenu.tsx:81-89`)
  unmounts everything and clears the window store. Rejected: overlay-on-logout
  (walking away on purpose means the screen owes you nothing).
- **One lock implementation, one form.** The existing `LockScreen` form
  (password + TOTP, throttle messaging) renders full-screen before first
  login and inside the overlay after — `useIdleLock.ts:10-13`'s "one lock
  implementation, no parallel state" keeps holding. Rejected: a second lock
  component.
- **Keyboard is gated at the three chokepoints, not per-hotkey.** While
  locked: `useGlobalHotkeys`' listener (`useGlobalHotkeys.ts:97-116`) bails,
  `bindHotkeys` in `createSystemHandle.ts:46-60` bails, and `isTopWindow`
  (`windowStore.ts:350`) returns false — the last one is what turns off every
  app-side `useSaveHotkey`/`useTopWindowKeydown` (they gate on
  `system.window.isFocused()`), so typing a password can never Delete a file
  in a hidden File Manager. Rejected: auditing dozens of individual bindings.
- **Sliding expiry with an absolute cap.** On authed HTTP requests, extend
  `expires_at` to `min(now + SESSION_TTL_HOURS, created_at +
  SESSION_ABSOLUTE_MAX_HOURS)` (new env var, default 720h/30 days; the
  `created_at` column already exists, `session.service.ts:8-13`). Skip the
  write when it would gain under an hour — self-throttling, no reliance on
  `last_seen`. Rejected: pure sliding (a stolen cookie never expires).
- **Renewal lives in the HTTP guard only.** The pty revoke sweep calls
  `sessions.validate()` every 30s per live terminal
  (`pty.gateway.ts:29,106,148`) — naive renewal inside `validate()` would let
  any open terminal immortalize its own session. Sweep and WS-upgrade
  validation stay renewal-free. Rejected: renew-inside-validate.
- **Renewal re-issues the cookie.** The cookie's Max-Age is set once at login
  (`auth.controller.ts:271-277`); extending `expires_at` server-side alone is
  theater — the browser drops the cookie at the original TTL. When the guard
  renews, it re-sets the same token with the new Max-Age.
- **Login over a still-valid session renews it in place** instead of minting
  a sibling row — the pty's cookie (captured at upgrade, `pty.gateway.ts:134`)
  stays valid across lock→unlock cycles, and rows stop accumulating per
  unlock. Rejected: mint-always (strands the terminal's token).
- **Pollers keep polling while locked**; renewal by background traffic is
  accepted — the absolute cap bounds it, and unlocking still demands the
  password (+TOTP). Rejected: a global query pause (invasive) and an
  activity-scoped renewal header (spoofable).

## Fix

1. `authStore.ts`: add `locked`, `lock()`, `unlock()`, and an
   `everAuthenticated` tab flag; `refresh()` leaves `locked` alone.
2. `AuthGate.tsx`: keep `children` mounted once `everAuthenticated`; wrap them
   in a container that gets `visibility:hidden` + `inert` + `aria-hidden`
   while `locked || !authenticated`; render the opaque lock overlay above
   everything (taskbar is `z-[9000]`, Start menu `z-[9001]` — the overlay goes
   above both). Pre-first-login and `needsSetup` keep today's full-screen
   paths; prefs hydration (`:35-46`) is unchanged.
3. `LockScreen.tsx`: extract the form; overlay variant calls `unlock()` +
   `refresh()` on success, full-screen variant behaves as today.
4. `useIdleLock.ts` `onLock` and `StartMenu.tsx:75-79` `handleLock` call
   `lock()` instead of `setAuthenticated(false)`; the idle controller no-ops
   while already locked. `handleLogout` additionally clears the window store
   (layout restore on next login still works from its brief-49 storage).
5. Gate the three keyboard chokepoints on `locked` (decision above).
6. `session.service.ts`: `validate(raw, { renew = false })` (or a separate
   `renewIfDue`) computing the capped extension; `issue()` untouched.
7. `auth.guard.ts:44-49`: request renewal, and when the session slid, re-set
   the cookie on the response. `env.schema.ts`: add
   `SESSION_ABSOLUTE_MAX_HOURS` (refined to be ≥ TTL) and fix the lying
   comment at `:33`.
8. `auth.controller.ts` login: when the request already carries a valid
   session, renew it in place instead of inserting a new row.
9. `pty.gateway.ts` sweep: pass the explicit no-renew form, with a comment
   saying why the sweep must never count as activity.

## Must preserve (regression surface)

- **Auth everywhere**: no route or WS upgrade loses its guard, no new
  `@Public()`; `/auth/status` stays public and renewal-free. The pty sweep
  still kills PTYs of logged-out/expired sessions within 30s.
- Nothing renders or fetches desktop data before the first successful login
  of a tab — the overlay path exists only after `everAuthenticated`.
- Locking itself must not renew the session; expired sessions are still
  deleted on validate (`session.service.ts:60-65`), and `purgeExpired`
  sweeps stay bounded.
- Logout still destroys the session server-side and clears the cookie
  (`auth.controller.ts:119-129`); after re-login, windows come back via
  layout restore exactly as today — empty, which is now the *contrast* case.
- Idle-lock behaviour: media playback still inhibits, activity stamping stays
  throttled (`useIdleLock.ts:26-47`), Settings still owns the timeout.
- The 401 interceptor still excludes `/auth/` routes (`lib/axios.ts:18`).

## Verify bar

`turbo typecheck`, lint + format, `turbo test`, `turbo build` green. Backend
tests (named, backend is touched): `session.service.spec` — renewal extends
`expires_at`, skips sub-hour gains, caps at `created_at + max`, expired rows
still deleted, the no-renew path never writes `expires_at`;
`auth.guard.spec` — Set-Cookie re-issued on renewal and absent otherwise;
a pty gateway test that the sweep validates without renewing.

**Verified in a browser** (production bundle + real backend): open Terminal
and run a printing loop, type into Notepad without saving; lock from the
Start menu — screenshot shows an opaque lock screen with zero window content;
Ctrl+S and Delete typed at the password field reach no app; unlock — the loop
is still printing in the *same* shell (no "[process exited]") and Notepad
still holds the text with its dirty marker. Then revoke the session
server-side: the next request drops to the overlay; sign back in — Notepad's
text survives, the Terminal honestly reports its shell was reaped. Log off,
sign in: everything is gone (unchanged teardown).

## Out of scope

Server-side terminal reattach (rejected in `real-os-gaps.md`); TOTP recovery
codes (brief 124); active-sessions list + revoke UI (brief 125); promoting
`imbatranimos:security` to a dotfile (localStorage-only today — a separate
decision); lock-screen branding/reskin; an expiry-warning countdown;
save-all-on-logout prompting (guards are not consulted on teardown today,
and that stays).
