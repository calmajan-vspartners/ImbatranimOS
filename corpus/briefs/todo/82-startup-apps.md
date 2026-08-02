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
