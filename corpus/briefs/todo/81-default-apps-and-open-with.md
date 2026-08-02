# Brief 81 — Default apps: let the user decide what opens a file

Status: **todo (ungrilled)** · From the 2026-07-31 real-OS parity research.
MEDIUM · CORE (`contract.ts`, a new association registry) + `file-manager` +
Settings. Interacts with brief 48 (the `system.intents` capability) and brief 65
(which PDF app wins).

## Problem

File association is a hardcoded constant inside one add-on
(`file-manager/src/lib/openWith.ts:28`). Three consequences:

1. **Unmapped files dead-end silently.** `handleOpen` returns without doing
   anything for an extension not in the map (`FileManager.tsx:157-161`) — so
   double-clicking `.csv`, `.env`, `.ini`, `.conf`, `Dockerfile`, or any
   extensionless file does *nothing at all*. A dead double-click reads as a
   broken OS, and it is one of the first things a new user hits.
2. **The user cannot change anything.** No "Open with", no default-apps setting.
3. **Apps cannot declare what they handle.** The knowledge lives in the file
   manager rather than in each app, so adding an app means editing another app —
   which is exactly the coupling `manifest.ts` was designed to avoid, and it is
   why brief 65's PDF mismatch happened (the weaker app owns `.pdf`).

## Proposed decisions (ungrilled)

- **Apps declare their own openers**: add `opens?: string[]` to `AddonManifest`
  (`apps/core/src/contract.ts`) — the `.desktop` `MimeType=` analogue. Core
  derives ext → candidate apps from `APP_REGISTRY`, so the association table is
  computed, not maintained.
- **Build it as `system.intents`, not as a new core export.** Brief 48 already
  reserves "openApp + open-with" for that capability; shipping it into the
  `@imbatranim/core` barrel now means moving it later. If 48 has not landed,
  shape the API so it can move without changing callers.
- **The user's per-extension choice is one preference key**, stored with brief
  49's durable dotfiles — it is user config, not session state.
- **Always resolve to something.** Never a silent no-op: unmapped text-ish files
  open in Code Editor, unmapped binaries show a Properties card offering "Open
  with…". Removing the dead double-click is the single most valuable part of
  this brief.
- **Extension-based, not MIME sniffing.** Reading file headers to guess a type
  means reading bytes on every listing; extensions are what the rest of the OS
  already uses.
- **Add `csv` → Sheets while here** (brief 63 wants it too — one of them adds
  it, not both).
- **Rejected — per-file overrides.** Per-extension is what people mean; per-file
  is state nobody can find later.

## Fix

1. `contract.ts`: optional `opens?: string[]`; populate it in each add-on's
   manifest, mirroring today's map.
2. Core association registry: build ext → candidates from `APP_REGISTRY`, merge
   the user's override, expose `resolveOpener(path)` and `openWith(path, appId)`.
3. `file-manager`: context menu gains **Open with ▸** listing candidates plus
   "Always use this for `.csv` files"; `handleOpen` calls `resolveOpener` and
   uses the fallback rather than returning.
4. Settings → **Default apps**: a list of known extensions with a `Select` per
   row and a Reset.
5. Delete the hardcoded map once the registry is authoritative; keep
   `openWith.ts` as a thin re-export during migration if that eases review.

## Must preserve (regression surface)

- Every extension that opens something today opens the same thing after the
  migration, unless the user changed it — write the before/after table into the
  outcome.
- The add-on manager (brief 46): a disabled app must not appear as a candidate,
  and disabling the app that owns an extension must fall back rather than
  dead-end.
- The eslint import boundary — core still imports add-ons only in `manifest.ts`;
  `opens` is declarative data, not an import.
- Double-click, Enter, and the context menu keep going through one code path.

## Verify bar

`turbo typecheck`, lint + format green, `turbo build` ok. Unit tests for
resolution order (user override > single candidate > fallback), the
unmapped-extension fallbacks, and a disabled candidate being skipped.

**Verified in a browser**: double-click a `.csv` and land in Sheets; double-click
an extensionless file and get Code Editor rather than nothing; use "Open with ▸"
to open a `.md` in Code Editor once, then "always", and confirm it sticks across
a reload; change a default in Settings and reset it.

## Out of scope

MIME sniffing, per-file overrides, opening with an arbitrary command, protocol
handlers, and the brief-65 decision about which PDF app wins.
