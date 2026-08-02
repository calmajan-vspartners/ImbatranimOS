# Brief 86 — One shortcut registry, and a way to see it

Status: **todo (ungrilled)** · From the 2026-07-31 real-OS parity research.
EASY · CORE. **Land before brief 85** and before any other work that adds a
global hotkey, so new bindings register rather than stay invisible.

## Problem

The OS has global keyboard shortcuts and **nothing in the UI mentions any of
them**: `mod+k` for the command palette (`App.tsx:26-28`), and
`alt+tab` / `mod+w` / `mod+m` / `mod+enter` for window management
(`useWindowHotkeys.ts:26-70`), plus per-editor `mod+s` (`useSaveHotkey.ts`).

Two problems follow. For the user, an undiscoverable shortcut may as well not
exist — this is the cheapest discoverability win available in the whole sweep.
For the codebase, bindings are declared inline at their call sites, so there is
no list to render, no conflict detection, and every future brief that adds a
hotkey (85's workspace switching, 56's terminal keys, 61's editor keys, 70's
calculator keys) adds another invisible one.

## Proposed decisions (ungrilled)

- **One exported registry** — `{ id, keys, description, scope }` — that
  `useGlobalHotkeys` callers register into, so the documentation cannot drift
  from the bindings. This is the part that matters; the overlay is just a view
  of it.
- **`?` and F1 open a Keyboard shortcuts overlay**, grouped by scope (Global /
  Window management / Editing / App), and the same list renders as a Settings
  section.
- **Scope is part of the record**, because window-scoped shortcuts
  (`useSaveHotkey`'s top-window guard) behave differently from global ones and
  the overlay should say so.
- **No rebinding UI in this brief.** Rebinding needs conflict detection plus a
  blacklist of keys the browser reserves — and `mod+w` already fights the
  browser's close-tab, which is exactly the class of problem a naive rebinding UI
  would multiply. Ship the registry (which makes rebinding possible later) and
  the viewer; defer the editor.
- **Note the browser-reserved conflicts in the overlay** rather than hiding
  them: if `mod+w` may be intercepted by the browser, say so next to it. Honest
  beats surprising.
- **Rejected — a cheatsheet in the README only.** It has to be in the OS, where
  the user is.

## Fix

1. `apps/core/src/shared/hooks/shortcutRegistry.ts` — the record type, a
   `registerShortcut()` and a `useShortcuts()` selector.
2. Migrate the existing call sites (`App.tsx`, `useWindowHotkeys.ts`,
   `useSaveHotkey.ts`) to register their bindings; behaviour unchanged.
3. `ShortcutsOverlay.tsx` — centred core `Dialog`, grouped, searchable; opened by
   `?` (when not typing in a field) and F1.
4. A Settings section rendering the same list.
5. A dev-time warning when two global shortcuts register the same keys — cheap
   conflict detection now, without a rebinding UI.

## Must preserve (regression surface)

- Every existing shortcut keeps working identically after migration —
  `mod+k`, `alt+tab`, `mod+w`, `mod+m`, `mod+enter`, `mod+s`.
- `?` must **not** open the overlay while the user is typing in an input,
  textarea, or the Terminal — the Terminal in particular must receive every
  keystroke it is given.
- Window-scoped shortcuts stay scoped to the top window; registering them
  centrally must not make them global.
- No new dependency.

## Verify bar

`turbo typecheck`, core lint + format green, `turbo build` ok. Unit tests: the
registry lists what was registered; duplicate global keys warn; the overlay
opens on `?` only outside a text-entry context.

**Verified in a browser**: press `?` on the desktop and see every shortcut
grouped; press `?` inside Notepad and inside the Terminal and confirm a literal
`?` is typed instead; check the same list appears in Settings; confirm each
listed shortcut actually does what it claims.

## Out of scope

Rebinding, per-app shortcut customisation, chord sequences, a macro system, and
recording shortcuts from the keyboard.

## Outcome — 2026-07-31 (done)

Shipped. `shortcutRegistry.ts` (store + `groupShortcuts` + `isTextEntry` +
`formatKeys`), `useRegisteredHotkeys` which **registers and binds in one call**
so a binding cannot exist undocumented, `ShortcutsOverlay` + `ShortcutList`, and
a Settings → Keyboard shortcuts section rendering the same list. All five
existing hotkeys migrated; `mod+w` carries its browser-intercept caveat inline.

`useSaveHotkey` is documented rather than migrated: it binds per editor window,
so registering from there would add and remove the row as editors open, and
unmounting one editor would delete a row another still needed. Added
`useDocumentedShortcuts` for that case, called once from the shell.

Dev-time duplicate detection warns when two ids claim the same keys in a scope.

**Verified in a browser**: `?` and F1 open the overlay listing all shortcuts
including the caveat; `?` typed into the command palette input produces a
literal `?` and does not open the overlay; **`?` reaches the Terminal** (xterm's
hidden textarea) so no keystroke is stolen.

24 core unit tests, including the registry, the duplicate warning, grouping,
`formatKeys`, and `isTextEntry`. The `isTextEntry` test caught a real defect:
the function was declared `: boolean` but returned `undefined` where
`isContentEditable` is unimplemented, which TypeScript could not see because
lib.dom types it as boolean. Now coerced explicitly.

**Not done**: rebinding UI, deferred in the brief on purpose.
