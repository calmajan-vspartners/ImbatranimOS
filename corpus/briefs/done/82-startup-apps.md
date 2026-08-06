# Brief 82 — Startup apps: choose what opens at login

Status: **todo (ungrilled)** · From the 2026-07-31 real-OS parity research.
EASY/MEDIUM · CORE (`App.tsx` + a preference). **Depends on brief 49** — it is
the honest replacement for the behaviour 49 removes.

## Problem

Today `restoreLayout()` reopens the previous session's windows on load
(`App.tsx:37`). Brief 49 deliberately deletes that: each browser tab becomes its
own ephemeral session, because the current shared-`localStorage` layout means two
tabs stomp each other's windows — the opposite of the SSH-session feel the design
is aiming for.

That is the right call, but it leaves a hole: after 49, **every new tab opens to
a bare desktop**, with no way to say "I always want Terminal and Files open".
Restoring the last layout and choosing a startup set are different features, and
removing the first without adding the second is a regression in daily use.

Every real desktop ships this (login items, `~/.config/autostart`), and here it
is cheap.

## Proposed decisions (ungrilled)

- **An ordered list of app ids in the durable prefs** that brief 49 introduces —
  user config, not session state, so it is shared across tabs and survives, while
  window layout does not.
- **Opened once per session, after authentication**, in the listed order.
- **Respect the disabled set** (`enabledApps.ts`, brief 46) — a disabled app in
  the startup list is skipped, not resurrected.
- **Respect the window clamp** (brief 52), so several startup windows cannot
  cascade off a short viewport.
- **"Use my current windows" snapshot button**, which is how people actually
  build the list.
- **Rejected — restoring exact window geometry at login.** That is layout
  restore, which 49 removed on purpose. Startup apps open at their normal
  default position; the distinction is deliberate and should be stated in the UI
  so it does not read as a bug.
- **Rejected — startup for a specific document.** Opening an app is a stable
  intent; opening a file that may since have been deleted is not.

## Fix

1. Preference: ordered `string[]` of app ids in brief 49's prefs table, with an
   API through the existing store pattern.
2. Boot effect in `App.tsx`, after auth resolves and once per session, iterating
   the list through the normal `openApp` path — no special-case opening.
3. Settings → **Startup**: checkbox list of enabled apps, drag to reorder, plus
   "Use my current windows".
4. A short note in the section explaining that startup apps open fresh, and that
   window positions are per-session by design.

## Must preserve (regression surface)

- Brief 49's model is not undermined: no window geometry is persisted, and
  nothing is shared between tabs except the preference itself.
- Opening happens exactly once per session — not on every re-render, and not
  again on a soft navigation.
- A startup app that fails to open does not block the others or the desktop.
- Settings' existing sections are unaffected.

## Verify bar

`turbo typecheck`, core lint + format green, `turbo build` ok. A unit test that
the boot effect fires once and skips disabled apps.

**Verified in a browser**: pick two startup apps, reload, and see exactly those
open once; open a third window, use "Use my current windows", reload, confirm the
list updated; disable one of them in Settings → Apps and confirm it is skipped;
open a second tab and confirm it gets its own copies rather than stealing the
first tab's windows.

## Out of scope

Restoring window geometry, per-tab startup sets, delayed/staggered launch,
startup for a specific document, and any change to brief 49's session model.

## Outcome — done 2026-08-06

Shipped, and the brief's central premise turned out to be **out of date in a way
that changes the implementation**.

### The premise, corrected

Brief 82 says brief 49 "deliberately deletes" the layout restore, so after 49
every load lands on a bare desktop. That is not what 49 shipped: it moved the
layout to **`sessionStorage`**. A *reload of the same tab* still restores its
windows; only a *new tab* starts bare.

Implemented as literally specified — "opened once per session, after
authentication" — this feature would therefore have re-opened the startup set on
**every reload, on top of the windows that just came back**: a second Notepad, a
second Code Editor, and focus yanked to the end of the startup list every time
anyone pressed F5. The brief could not see that because it was written before 49
landed.

So the rule is sharper than "once per session":

1. **Never when a layout was restored.** Those windows *are* this session's
   arrangement; the startup set already ran when the session was created.
2. **Never twice in one tab**, even when the desktop is empty — closing all your
   windows and reloading must not resurrect them, or an app on the list can never
   be got rid of. The marker lives in `sessionStorage`, so it shares its lifetime
   with the layout it guards, and a duplicated tab (which copies `sessionStorage`)
   inherits both together.

That is the brief's own `sessionStorage`-vs-dotfile split, applied one level
further in than the brief could reach. It also means **a reload is not a test of
this feature** — a fact the probe has to respect, and does.

### The shape

- `startupStore` — an ordered `string[]`, persisted through brief 49's
  `prefsStorage`, key `imbatranimos:startup`, **registered in `DOTFILE_KEYS`** and
  in `rehydrateDotfileStores`. Both, deliberately: brief 81 shipped a store that
  had the first without the second and the setting silently never left the browser.
- `runStartupApps()` in `shared/lib/startup.ts`, called from `App.tsx`'s boot
  effect immediately after `restoreLayout()` — same effect, because the second
  decision depends on the first. `App` mounts behind `AuthGate`'s `prefsReady`, so
  the list has already been read from the server by then; no new lifecycle needed.
- `startupCandidates()` skips ids the registry no longer has and apps the user has
  disabled (brief 46). Settings shows the same function's result, so the "2 apps
  will open at startup" line under the list cannot drift from what boot does.
- Each open is wrapped: one app that throws must not take the rest of the list, or
  the desktop, with it.
- Settings → **Startup**: the chosen apps as a numbered list with move-earlier /
  move-later and Remove, then a separate "Add an app" list.

### Three judgement calls

**No hand-rolled cascade.** The brief asks that several startup windows respect
brief 52's clamp. They already do — `openWindow` clamps every window against the
viewport — and it also scatters new windows by **±100px** around centre, which is
a wider spread than any stagger worth writing. So `runStartupApps` calls plain
`openApp` with no placement argument at all. Anything else would fight the store.

**Buttons, not drag, for reordering.** The brief says "drag to reorder". For a
list that is realistically two to four items, move-earlier/move-later buttons are
keyboard-accessible, screen-reader-legible, need no gesture library, and cannot
half-complete. Drag would look slightly nicer and be worse in every other respect.

**Two lists, not one checkbox list.** Order is the only reason this is a list
rather than a set — the last app opened is the one in front. A single alphabetical
checkbox list would hide exactly that. A chosen app that is currently *disabled*
stays in the list, struck through, saying it will be skipped: dropping it silently
would lose the setting, and re-enabling the app should bring its entry back.

**"Use my current windows" takes z-order, not open order**, so the arrangement you
are looking at is the one you get back — front-most window opened last, therefore
in front again. De-duplicated, because two Notepad windows are one startup entry
(the brief rejected per-document startup, so a second copy would just open the
same empty app twice).

### Verified

`turbo typecheck lint format:check test build` — 115/115. Backend unit 423, e2e
141, frontend vitest 1272 → 1286 (14 new). No new dependencies.

One Playwright probe against a production bundle behind the real backend, 19
checks green, no page errors. Every meaningful check uses a **fresh browser
context**, because a reload deliberately does not run the set:

- Tick Terminal and Calculator in Settings → the list shows an order, the count
  says "2 apps will open at startup", and the value appears in `/api/prefs`.
- A **new session** opens exactly those two and nothing else.
- A reload leaves exactly two windows, not four.
- Close them both and reload: the desktop stays empty.
- "Use my current windows" with only Settings open rewrites the list to one app,
  and the next fresh session opens exactly Settings.
- With Calculator disabled in Apps: Terminal opens, Calculator is skipped, **and
  the startup entry is still stored** so re-enabling restores it.
- Two tabs of one account each open their own set, each keeps its own layout, and
  closing every window in tab 2 leaves tab 1 untouched — including across a
  reload. Brief 49's model is not undermined.

Probe-only note: core's `Checkbox` renders inside a bare `<label>`, so Playwright's
`getByLabel` reads that empty label instead of the control's `aria-label`. The
accessibility tree has the right name — `getByRole('checkbox', { name })` finds it
— so this is a wrong-query problem, not an a11y defect. Same lesson as brief 81's:
closing windows front-first is the only order that terminates, because `force:
true` skips the hit-target *check* while the browser still delivers the click to
whatever is on top.

### Deferred

- Drag-to-reorder, if the list ever grows past a handful of entries.
- Delayed/staggered launch, per-tab startup sets, and startup for a specific
  document all stay out of scope.
