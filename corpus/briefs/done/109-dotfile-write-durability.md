# Brief 109 — Dotfile write durability: failed PUTs retry, the unload flush actually delivers, re-auth re-flushes

> **Outcome (2026-08-07): DONE.** Built as specced. `flushPrefs` no longer
> clears the batch before the request: it snapshots, keeps entries queued while
> in flight, and retires only those whose queued value is still the one that was
> sent (a key rewritten mid-flight keeps the newer value). Failure is
> classified — 401 holds the batch and stops retrying (`prefsWaitingForAuth()`),
> any other 4xx drops it and notifies once rather than looping on a malformed
> body, 5xx/network backs off 5 s doubling to 60 s — with an in-flight guard
> plus follow-up flag replacing the accidental protection the old
> clear-before-PUT gave. `flushPrefsKeepalive()` sends the same body over
> `fetch(keepalive)` and AuthGate moved `beforeunload` → `pagehide` (which also
> covers bfcache); the authenticated transition now calls `flushPrefs()` first,
> before hydration, which is safe because `hydratePrefs` latches on `hydrated`.
> Backend PUT echoes per-key `updated_at`. The notification import is dynamic
> to keep `lib/` from depending eagerly on a store.
>
> Verified: 5 new frontend units + the backend echo test (turbo 120/120,
> backend 431 unit + 141 e2e) and a 12/12 Playwright pass on the production
> bundle — under a 503 outage the wallpaper applied locally while the server
> kept the old value, the backoff retry landed it once the outage lifted and a
> reload held it; hiding the tab inside the debounce window still delivered;
> and a 401 held the batch without hammering (1 PUT over 8 s) until re-auth
> re-flushed it. Probe notes for later readers: the wallpaper displayed as
> "Fine" is stored as `linen`, and with brief 101's overlay the *visible*
> password field must be selected — Settings' change-password input sits in the
> hidden desktop tree behind the lock.

Status: **done 2026-08-07** · From the 2026-08-07 research sweep. EASY ·
CORE lib (`lib/prefs.ts`, `AuthGate.tsx`) + a small BACKEND addition
(`prefs.service.ts` PUT echoes per-key `updated_at`). Hardens the brief-49
dotfile pipe every registered store shares — **no new store**, so the
`DOTFILE_KEYS` + `rehydrateDotfileStores` double-registration trap (briefs
81/82) is not in play here, only documented. Gains value again when brief
101 makes re-auth-in-place routine.

## Problem

1. **A failed batch is gone before it is sent.** `flushPrefs()`
   (`prefs.ts:160-169`) clears `pendingWrites` *before* the PUT and swallows
   rejection with `.catch(() => undefined)`. One network blip, one 500, one
   expired session at the wrong moment — the write never happened and nothing
   will ever retry it.
2. **Then the change is actively reverted.** `hydratePrefs`
   (`prefs.ts:109-118`) merges server-over-local for every key the server
   has. So the lost change *looks* applied — the localStorage mirror lies for
   days — until the next sign-in (or the other browser) snaps it back to the
   stale server copy. Brief 81's outcome already documented how invisible
   this class of bug is: only a second browser can see it.
3. **The unload flush is not actually delivered.** `AuthGate.tsx:49-60`
   flushes on `beforeunload`/`visibilitychange` through the same plain axios
   PUT; browsers routinely abort in-flight XHR on unload, and a grep finds
   zero `keepalive`/`sendBeacon`/`pagehide` anywhere in core or packages. The
   code's own comment ("a wallpaper changed two hundred milliseconds before
   closing the tab should not be the one change that does not stick",
   `prefs.ts:153-159`) is an aspiration, not a behaviour.
4. **401 loses the batch twice.** A flush racing session expiry rejects, the
   interceptor drops to the lock screen (`axios.ts:14-23`), and after
   re-login nothing re-sends — even though `pendingWrites` is module state
   that survived the unmount.

## Proposed decisions (ungrilled)

- **Failure re-queues instead of dropping.** Entries stay in (or return to)
  `pendingWrites` until the server confirms; a failed entry is re-queued
  only if no newer value for that key was written meanwhile (newest write
  always wins locally). Retry on exponential backoff (5s doubling, capped at
  60s), reset on success. Rejected: fire-and-forget (the bug); rejected: a
  durable localStorage outbox (an offline sync engine for wallpapers).
- **Never loop on a definitive 4xx** — with one carve-out. 401 means "will
  succeed after re-auth": keep the entries queued and stop retrying until
  authentication returns. Any other 4xx is the server saying no permanently:
  drop the batch and `notify` once ("Couldn't save your settings"), never
  hammer. 5xx/network errors retry on the backoff. Rejected: retrying all
  4xx (a malformed batch would loop forever).
- **One flush in flight.** Keeping entries queued during the request means a
  second flush could double-send; an in-flight guard plus a follow-up flag
  replaces the accidental protection the old clear-before-PUT provided.
- **The unload path uses `fetch` keepalive.** A `flushPrefsKeepalive()`
  builds the same `{ entries }` body and sends
  `fetch(url, { method: 'PUT', credentials: 'include', keepalive: true })`,
  wired to `pagehide` (replacing `beforeunload` — `pagehide` also covers
  bfcache navigations) and kept on `visibilitychange: hidden`. Keepalive
  caps in-flight bodies at 64 KiB — dotfile batches are small JSON, and the
  cap is noted where the function lives. Entries stay queued regardless (the
  page cannot reliably observe the outcome; a bfcache resurrection just
  retries). Rejected: `navigator.sendBeacon` (POST-only — the route is a
  PUT, and reshaping the API for a transport quirk is backwards).
- **Re-flush on re-authentication.** `AuthGate`'s authenticated effect
  (`AuthGate.tsx:35-46`) calls `flushPrefs()` when `authenticated` flips
  true — `hydratePrefs` latches on `hydrated` (`prefs.ts:101-103`), so
  within a tab a re-auth cannot clobber the pending value with the server's
  stale copy before the flush lands.
- **The PUT echoes per-key `updated_at`** (`{ written, updatedAt: {…} }`) —
  the column already exists (`db.service.ts:224-228`), the client ignores it
  today, and it gives two-browser conflicts a timestamp to reason with.
  Rejected: version checks / ETags — whole-key last-writer-wins
  (`prefs.service.ts:51-71`) stays by design; this brief fixes durability,
  not merge.
- **Retry state stays in memory.** A tab closed with undeliverable writes
  loses them after the keepalive attempt — accepted and stated.

## Fix

1. `lib/prefs.ts`: rework `flushPrefs` — snapshot the batch, keep entries
   queued while in flight; on success delete only entries whose queued value
   is the one that was sent; on failure classify (401 → hold for re-auth,
   other 4xx → drop + one `notify`, else → backoff retry). Add the in-flight
   guard, the backoff timer, and `flushPrefsKeepalive()`.
2. `AuthGate.tsx`: swap `beforeunload` → `pagehide`, point both unload
   handlers at the keepalive flush, and add `flushPrefs()` to the
   authenticated-transition effect (before `rehydrateDotfileStores`
   resolves the boot gate — order documented in a comment).
3. `apps/backend/src/modules/prefs/prefs.service.ts` + controller: `put()`
   returns per-key `updated_at` alongside `written`; DTO untouched (response
   shape only).
4. Tests — `lib/prefs.test.ts`: a rejected PUT keeps entries and a later
   flush delivers them; a newer `writePref` during a failed flight wins over
   the re-queue; a 400 drops and notifies exactly once; a 401 holds entries
   and a subsequent flush (simulated re-auth) delivers; no double-send when
   two flushes overlap. `prefs.brief49.spec.ts`: the echo shape, and the
   batch is still one transaction.

## Must preserve (regression surface)

- The 400ms debounce coalescing (`prefs.ts:30,149-150`) and one-PUT-per-batch;
  the server transaction (`prefs.service.ts:58-69`).
- `hydratePrefs` semantics: server-over-local on first boot, legacy local
  values pushed up, failure non-fatal (`prefs.ts:124-129`).
- `writePref`'s `DOTFILE_KEYS` gate and the documented trap text
  (`prefs.ts:33-40`) — unchanged, still load-bearing.
- `prefsStorage` stays synchronous (first paint reads the mirror).
- Auth invariants: `/api/prefs` stays behind the global guard, no
  `@Public()`; the keepalive fetch carries the session cookie via
  `credentials: 'include'`. No retries fire while unauthenticated.
- The 401 interceptor still excludes `/auth/` routes (`axios.ts:18`).

## Verify bar

`turbo typecheck`, lint + format, `turbo test`, `turbo build` green. Backend
tests named above (backend is touched). Frontend unit tests in Fix 4.

**Verified in a browser** (production bundle + real backend, Playwright):
(1) route-intercept `PUT /api/prefs` to 500, change the wallpaper — it
applies visually; lift the intercept — the retried PUT lands and
`GET /api/prefs` shows the new value; reload holds it. (2) change the accent
and close the tab within the debounce window; a fresh context signs in and
the accent is there (the keepalive delivery, observed). (3) expire the
session server-side, change a setting (the 401 drops to the lock screen),
sign back in — `GET /api/prefs` now holds the change (the re-auth re-flush,
observed).

## Out of scope

Merge/conflict resolution (last-writer-wins stands); a durable offline
outbox; per-key versioning or ETags; registering any new dotfile store; the
brief-101 overlay lock (it only makes the re-auth path more common); DELETE
`/prefs/:key` durability (same pattern, add only if the grill demands it).
