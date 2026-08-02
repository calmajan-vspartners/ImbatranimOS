# Brief 57 — Settings: let the user change their password, and tell the truth about the machine

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
MEDIUM · CORE (`apps/core/src/modules/settings/Settings.tsx`,
`apps/core/src/modules/auth/SecuritySettings.tsx`) + backend `auth` module.
Standalone.

## Problem

**There is no way to change your password.** The auth controller exposes exactly
`status`, `setup`, `login`, `logout`, `totp/enroll`, `totp/enable`,
`totp/disable` (`auth.controller.ts:42-127`) — no change-password route, and
nothing in Settings offers one. For a single-user OS the README explicitly
recommends exposing to the internet behind a reverse proxy, that is a real
security gap: a password typed once at first-run can never be rotated, and a
password you suspect is compromised can only be replaced by deleting the
database and losing the account (the README's own "forgot password" answer,
`README.md:115-122`). `setup` deliberately refuses to run twice, so there is no
back door either — correctly.

**"About this machine" is three hardcoded strings** (`Settings.tsx:242-244`):
`OS: ImbatranimOS`, `Shell: React desktop on Alpine`, `Status: Developer
Preview`, with a `v0.1 · preview` footer at `:267`. Meanwhile
`GET /api/system/about` already returns the real hostname, kernel release,
platform, arch, uptime and `IMAGE_VERSION` (`system.service.ts:215-224`), and
`package.json` is at **1.0.0**. So the OS reports a version it is not, from a
panel titled "About this machine" that knows nothing about the machine. This is
the third place a new user notices the illusion break.

Smaller, same screen: Settings has no search, and it is one long scroll of
Appearance → Apps → Security → About with no way to jump.

## Proposed decisions (ungrilled)

- **Add `POST /auth/password`**, owner-authed, requiring the **current**
  password and a new one that meets the same ≥10-character rule as first-run
  setup. Verify with the existing argon2id path; re-hash with the same
  parameters.
- **Changing the password invalidates other sessions.** The cookie is a session
  token, and the point of a rotation is to evict whoever else might hold one.
  Keep the caller signed in (re-issue their session), drop the rest. If TOTP is
  enabled, require a current TOTP code too — the same step-up `totp/disable`
  already demands (`auth.controller.ts:124-127`), for consistency and because a
  password change is exactly as sensitive.
- **Rate-limit it** on the existing login throttle, so the endpoint cannot be
  used to brute-force the current password from an already-open session.
- **About reads the real API.** Render hostname, kernel, platform/arch, uptime
  and image version from `/api/system/about`, and take the displayed version
  from `IMAGE_VERSION` rather than a literal. Delete `v0.1 · preview`.
- **Rejected — a password *reset* / recovery flow.** With a single local account
  and no second factor to fall back on, any recovery path is a back door.
  `setup` refusing to re-run is the right stance; the honest recovery remains
  the documented volume-delete. Say that in the UI next to the change form
  rather than inventing recovery.
- **Rejected — multi-user accounts.** Out of scope and against the shipped
  single-user model.
- **Deferred — TOTP recovery codes.** Genuinely valuable (lose your phone today
  and you are locked out), but it is its own design: generation, one-time use,
  secure display, storage. Capture as a todo, do not smuggle it in here.

## Fix

1. Backend `auth`: `changePassword(current, next, totp?)` in the service —
   verify current (constant-time path already used by `login`), enforce the
   length rule, re-hash, persist, invalidate sessions other than the caller's.
   Controller route behind the global session guard + throttle. DTO validated
   with the existing `class-validator` conventions.
2. `SecuritySettings.tsx`: a **Change password** form — current, new, confirm,
   plus a TOTP field when enabled. Use the kit `Input` with the house `label`
   prop; disable submit while invalid or pending; report success and failure
   through `notify()` (`ui-conventions.md` §23), never a silent no-op.
3. `Settings.tsx`: replace the hardcoded About rows with a fetch of
   `/api/system/about` via the core `api` client; show a loading and an error
   state; format uptime human-readably. Drive the footer version from the same
   payload.
4. Add a short line under the change form stating plainly that there is no
   recovery if the password is lost, and pointing at the volume backup.

## Must preserve (regression surface)

- First-run setup still refuses to run once an account exists, with or without
  `SETUP_TOKEN` (brief 28).
- TOTP enroll/enable/disable keep working, and a password change does not
  silently disable TOTP.
- The caller is not logged out by their own password change; every *other*
  session is.
- Login throttle behaviour (brief 10) is unchanged for the login route itself.
- Appearance and Apps sections behave exactly as before.

## Verify bar

`turbo typecheck`, lint + format green, `turbo build` ok. Backend tests: wrong
current password rejected; too-short new password rejected; correct change
re-hashes and the new password logs in while the old one does not; other
sessions are invalidated and the caller's is not; TOTP required when enabled;
throttled under repeated wrong attempts.

**Verified in a browser**: change the password in Settings, confirm a second
browser session is signed out, sign in again with the new password, confirm the
old one fails. Confirm About shows this machine's real hostname/kernel/uptime
and the version matches `IMAGE_VERSION` rather than `v0.1`.

## Out of scope

TOTP recovery codes (capture as a todo), multi-user accounts, password
recovery, Settings search / section navigation, and the Storage, Backup,
Startup and Default-apps sections proposed by the real-OS parity briefs.
