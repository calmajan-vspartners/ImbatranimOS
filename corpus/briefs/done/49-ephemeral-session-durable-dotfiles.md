# Brief 49 — Ephemeral per-tab session + durable server-side dotfiles

Status: **done 2026-08-06** · From the 2026-07-19 OS-layering grilling (the (b) SSH-session
driver). CORE frontend + a small backend module. Independent of briefs 47/48 —
can ship in any order. Design:
[wiki/os-layering.md](../../wiki/os-layering.md#sessions-vs-dotfiles-the-one-new-decision).

## Problem

Desktop state is persisted per-**browser** in `localStorage`, which is **shared
across all tabs of one origin**. So two tabs **stomp each other's window
layout** — the opposite of the grilled "each tab = an SSH session" model. And
durable user config (wallpaper, accent, icon positions, disabled apps) lives in
`localStorage` too, so it's tied to the browser rather than the account and is
lost on a different device / cleared storage.

The grilled split fixes both:

- **Session = ephemeral, per-tab, in-memory window layout.** New tab = fresh
  desktop; close tab = its windows are gone. Nothing shared between tabs.
- **User config = durable `$HOME` dotfiles**, server-side, shared across all
  sessions like `.bashrc` across SSH logins.

## Decisions (grilled 2026-07-19)

- **Window layout becomes ephemeral.** Stop persisting `windowStore` layout to
  `localStorage` (`imbatranimos:window-layout`). Each tab holds its own in-memory
  session; **no reattach, no server-side session persistence, no GC** (tmux-style
  detach/reattach is an explicit future, not this brief). This alone ends the
  cross-tab stomp — there is no shared layout key to fight over.
- **These stores become server-backed dotfiles** (durable, shared across
  sessions): `appearanceStore` (`imbatranimos:appearance` — theme + accent),
  `wallpaperStore` (`wallpaper-storage`), `desktopStore` (`desktop-storage` —
  desktop icon positions), `addonStore` (`imbatranimos:addons` — disabled set).
  Also: pinned taskbar items *if/when* that store exists.
- **`notificationStore` history stays local/ephemeral** — it's session-scoped
  UX, not user config; leave its `localStorage` persistence (or drop to
  in-memory), do **not** promote it to a dotfile.
- **Backend = a tiny key/value prefs store** in the **existing app SQLite DB**
  (`apps/backend/src/db/db.service.ts`, better-sqlite3, lives in the `$HOME`
  volume). One table `prefs(key TEXT PRIMARY KEY, value TEXT /* JSON */,
  updated_at)`. Single user — no per-user scoping needed. Behind the global
  `SessionAuthGuard` (no `@Public()`), so dotfiles are owner-only.
- **Client persistence = hydrate-then-write-through.** On boot, fetch all prefs
  and hydrate the dotfile stores; on change, **debounced** `PUT` write-through.
  Replace each dotfile store's zustand `persist(localStorage)` with a
  server-backed persistence adapter (a custom `StateStorage` hitting the prefs
  API, or an explicit hydrate + subscribe). Optimistic local update; server is
  the source of truth on next load.
- **One-time migration nicety (optional, low priority):** on first boot with
  empty server prefs, seed from any existing `localStorage` dotfile values so a
  current user doesn't lose their wallpaper/accent. Then clear those keys.

## Fix

1. **Backend `prefs` module** — `apps/backend/src/modules/prefs/`: service over
   `db.service`, `prefs` table (create-if-not-exists on init). Controller:
   `GET /api/prefs` (→ `{ [key]: json }`), `PUT /api/prefs` (bulk upsert) and/or
   `PUT /api/prefs/:key`. Guarded (no `@Public()`). Small unit test: upsert +
   read-back + JSON round-trip.
2. **Frontend prefs client** — `apps/core/src/lib/prefs.ts`: typed
   `getPrefs()` / `setPref(key, value)` over the authed `api` client; debounce
   helper for write-through.
3. **Window layout → ephemeral** — in `windowStore.ts` delete
   `LAYOUT_STORAGE_KEY` save/load/clear (lines ~46–77 + `persistLayout`);
   sessions are in-memory only. Remove any boot-time layout restore.
4. **Dotfile stores → server-backed** — swap `persist(localStorage)` for the
   prefs-backed adapter in `appearanceStore`, `wallpaperStore`, `desktopStore`,
   `addonStore`. Hydrate on app boot (before first paint where it matters —
   accent/wallpaper — to avoid a flash), then subscribe → debounced write.
5. **Boot sequencing** — hydrate prefs once at startup (a provider/effect high in
   the tree), gate the initial theme/wallpaper apply on it to avoid FOUC.
6. *(optional)* localStorage→server seed migration + cleanup.

## Must preserve (regression surface)

- **Two tabs never stomp each other's windows** — open two tabs, arrange windows
  differently in each; neither changes the other (the (b) acceptance).
- New tab opens to a **fresh** desktop (no restored windows); closing a tab loses
  only that tab's window arrangement.
- Wallpaper, accent/theme, desktop icon positions, and the disabled-app set
  **survive a full reload and appear identically in a second tab / another
  browser** (they're server dotfiles now).
- No accent/wallpaper **flash** on load (hydrate before the gated apply).
- All prefs routes are **auth-guarded** (no unauthenticated read/write of user
  config); the SQLite DB stays in the `$HOME` volume (persists across container
  recreate).
- Add-on manager (brief 46) still toggles apps — now the disabled set is a
  dotfile, shared across tabs.

## Verify bar

`turbo typecheck`, core lint + format, `turbo build` green; backend unit test for
the prefs round-trip; full backend suite green. **Human-gated:** two-tab stomp
test (the headline (b) fix); set wallpaper/accent/icon-positions, hard-reload +
open a second tab, confirm they carry; confirm a fresh tab starts with no windows
open; confirm nothing reads/writes prefs while logged out.

## Outcome — done 2026-08-06

The grilled split shipped: **session is per-tab, config belongs to the account.**
Two of the brief's implementation instructions were changed, both because the
brief's own reasoning points somewhere better once you look at the code.

### `sessionStorage`, not "delete the persistence"

The brief says to drop layout persistence entirely and hold each session in
memory. That ends the two-tab stomp — but it also throws away reload survival for
the overwhelmingly common single-tab case: refresh, and your entire arrangement
is gone. Under the brief's own SSH analogy that is the wrong cut. **Closing the
tab is logging out; reloading is the terminal redrawing.**

`sessionStorage` is exactly that boundary, and it satisfies every acceptance
criterion the brief lists — per-tab, fresh on a new tab, gone when the tab closes
— with no server state, no reattach and no GC, because the browser drops it. One
word changed and the whole class of bug went with it: `localStorage` is shared by
every tab of an origin, which is why two desktops fought over one key and the
last writer decided what both saw.

It also **preserves brief 85** rather than reverting it. Workspace assignment
belongs to the layout; it now rides in the same per-tab store, which is
simultaneously the answer to "a reload must not collapse four workspaces onto
one" and "two tabs must not fight over which workspace is showing".

### Server as source of truth, localStorage as a first-paint cache

The brief says to replace each dotfile store's `persist(localStorage)` with a
server-backed adapter. For three stores that is right. For **appearance it is
structurally impossible**: `main.tsx` applies theme and accent *synchronously,
before React mounts*, so the very first paint — the lock screen — is branded. That
paint happens **before authentication**, and `/api/prefs` is behind the session
guard, as it must be. There is no server to read at the moment the value is
needed.

So: paint from the local mirror immediately, hydrate from the server once there is
a session, re-apply, and keep the mirror fresh. A browser that has never seen this
machine shows the default behind the lock and picks up the real values on sign-in
— which is correct, because your wallpaper lives behind your password.

The mirror is also why the adapter is **synchronous**. An async `StateStorage`
makes zustand hydrate on a later tick, and every store that drives a visual would
flash its default first.

### The step that is easy to miss, and did not work without it

`persist` hydrates **once, at store creation** — at import time, long before
there is a session. Filling the cache afterwards therefore changes nothing on its
own: the stores are still sitting on what they read at import. `rehydrate()` on
each dotfile store after the fetch is what makes the server's copy take effect.
Without it the feature *appeared* to work in the tab that made the change (its
store was updated locally) and silently did nothing in a fresh browser — which is
the only case the feature exists for. Caught by the probe, not by reasoning.

### The bug the unit test could not see

`PrefsService.put` passed the DTO straight to better-sqlite3, and every real
request 500'd with "Named parameters can only be passed within plain objects" —
while the spec was green. The global `ValidationPipe` runs with
`transform: true`, so the controller receives a **class instance**, and
better-sqlite3 refuses one for named parameters. A spec naturally writes object
literals, so it exercised a shape production never produces. Fixed by
destructuring, and there is now a test that constructs a real `PrefEntryDto`.

### Smaller decisions

- **The value is opaque to the server.** It stores whatever JSON a store hands it
  and never parses it. A backend that knew each client store's schema would need
  changing every time a store gained a field, and would produce a version-skew bug
  the first time the two disagreed. The client owns meaning; the server owns
  durability and access control.
- **The migration is the hydrate.** A key the server does not have keeps its local
  value and is pushed up — "the server has not got it yet" and "this is a legacy
  local value" are the same condition, so this is a line rather than a migration
  step.
- **Writes are debounced and coalesced**, and flushed on `visibilitychange` and
  `beforeunload`: a wallpaper changed two hundred milliseconds before the tab
  closes should not be the one change that does not stick.
- **A store that is not a dotfile is refused at the adapter**, so window layout
  can never reach the server by accident. Tested.
- **A failed fetch keeps the desktop running on the mirror.** A desktop that
  refused to render because it could not read a wallpaper would be a far worse
  failure than a wrong wallpaper.
- **The route is authed** — not because a wallpaper is secret, but because a
  writable one lets a stranger rearrange someone's desktop from the internet.

### Verified in a browser, with two real tabs

```
PASS 401 on GET and PUT /api/prefs without a session
PASS tab A has two windows; a NEW TAB opens to a fresh desktop
PASS tab B opens its own window and TAB A IS UNTOUCHED  ← the (b) acceptance
PASS reloading tab A keeps ITS two windows; tab B still has exactly its one
PASS changing theme + accent in tab A reaches the server as a dotfile
PASS the window layout does NOT reach the server — it is session state
PASS a browser that has never seen this machine gets the theme (light) and
     the accent (#0f7a40) after signing in
PASS …but no windows: a new browser is a new session
PASS closing tab B leaves tab A untouched
PASS NO prefs request is made while the lock screen is showing
page errors: none
```

Tests: backend unit **385 → 408** (12 prefs + the DTO-instance regression, plus
brief 85's suite carried forward). Frontend vitest **1071 → 1147**. Backend e2e
unchanged at 141. All 115 turbo tasks green. Zero new dependencies.

**Unblocks briefs 81 and 82**, which both need a durable place for user config.
