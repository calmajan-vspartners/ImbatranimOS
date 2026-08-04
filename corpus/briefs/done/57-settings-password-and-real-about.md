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

---

## Outcome — 2026-08-04

Done. The OS can rotate its own password, and "About this machine" now knows what
machine it is on.

### `POST /auth/password`

Authenticated (no `@Public()`), so the global session guard covers it. Four gates,
each a deliberate choice rather than boilerplate:

1. **The current password is re-proved**, even though the caller already holds a
   valid session. A session cookie is a bearer token; if one leaks, the thief must
   not be able to lock the owner out of their own machine. Same step-up
   `disableTotp` already demanded.
2. **A current TOTP code is required when TOTP is enabled** — rotating the password
   is at least as sensitive as turning 2FA off, which already asks.
3. **The same ≥10 minimum as first-run.** A weaker bar for rotation would make
   rotating a downgrade.
4. **Fresh argon2id hash with identical parameters**, so a rotated password is
   exactly as costly to attack as a new install's.

Three orderings inside it are load-bearing and each has a test:

- **Verify the current password BEFORE validating the new one.** The reverse lets
  someone with a stolen session probe the strength rule — and get a distinguishable
  error — without knowing the current password at all.
- **Change the password BEFORE dropping sessions.** Dropping first would sign the
  user out of every device on a *failed* change, which is a denial of service
  anyone holding a session could trigger at will.
- **A no-op change is refused.** Silently "succeeding" while evicting every other
  session would look like a rotation that rotated nothing.

**Every session dies, including the caller's, and the caller gets a new cookie in
the same response.** `destroyAll()` rather than "all but mine": the reason to
rotate is usually that a credential may have leaked, and the caller's *current*
token is as plausibly leaked as any other. The user stays signed in on this
browser and is signed out everywhere else, with no pre-change token valid anywhere.

**Throttled on login's counter.** The route re-verifies the current password, which
makes it an oracle for it — without this, a stolen session could brute-force the
password from inside the OS while the lock screen stayed protected. Only a failed
*credential* check feeds the throttle; a rejected weak or unchanged new password is
the user fumbling their own form, and counting it would let honest mistakes lock
them out of their own machine.

**TOTP is deliberately untouched** by a password change, with a test — the brief's
regression surface names it, and silently dropping the second factor would be the
worst possible side effect of a security action.

### About reads the real machine

Five rows from `/api/system/about` — hostname, kernel, platform · arch, uptime,
image version — replacing `OS: ImbatranimOS`, `Shell: React desktop on Alpine`,
`Status: Developer Preview`. The footer's `v0.1 · preview` now comes from
`IMAGE_VERSION`, lifted into `Settings` so one fetch feeds both and they cannot
drift. The panel has a real loading and error state, and the error says it could
not *read* the machine rather than asserting something false — the old hardcoded
rows could never fail, which is precisely what was wrong with them.

`formatUptime` is its own tested module: two units at most ("3d 4h", not
"3d 4h 17m 9s"), and `NaN`/negative/`Infinity` render "unknown" rather than
"NaNd NaNh" in a panel whose whole job is stating facts accurately.

### The form says why it is disabled

`lib/passwordChange.ts` orders its complaints to follow the user down the form
rather than jumping to the last field, and the reason is rendered next to the
greyed-out button. A disabled control with no explanation was the failure mode to
avoid. `canSubmit` is defined in terms of `describeInvalid` so a disabled button and
a rejected request cannot disagree.

Under the form, stated plainly rather than implied: **there is no password
recovery**, and the only way back in is deleting the data volume, which erases the
account and its files. The brief rejects a reset flow and it is right — with one
local account, any recovery path is a back door.

### Verified

**Backend: 192 unit + 46 e2e, all passing.** 11 new service tests and 10 new e2e
tests, including the two properties only an end-to-end test can establish — that
other sessions really are evicted and the caller's is not.

**In the shipped bundle, with TWO independent browser contexts** (separate cookie
jars = two genuinely signed-in browsers, `uitest/set57.mjs`):

- Both start signed in; after the change the changing browser is still
  authenticated and **the other is not**.
- A *failed* change signs nobody out.
- The old password then gets 401 at login and the new one 200.
- About renders this machine's real `hostname=vm`, `kernel=6.18.5-fc-v18`,
  `platform=linux · x64`, `uptime=13m`, `IMAGE VERSION=1.0.0-dev`, matching
  `/api/system/about` field for field; none of the three hardcoded strings remain
  and the footer reads `v1.0.0-dev`, not `v0.1`.
- The probe restores the original password afterwards so the rest of the harness
  keeps working.

### Out of scope, unchanged

TOTP recovery codes (still worth a todo — lose your phone today and you are locked
out), multi-user accounts, password recovery, and Settings search / section
navigation.
