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

## Outcome — done 2026-08-06

Shipped as specified, with one deliberate departure and one location the brief
asked for that does not exist yet. **The dead double-click is gone**, which is the
part the brief correctly calls the most valuable, and the association table is now
derived from what each app declares rather than maintained in the file manager.

### The shape

- `contract.ts` gains `opens?: string[]`. Eleven add-on manifests populate it,
  mirroring the old constant exactly (table below). It is declarative data, so the
  eslint import boundary is untouched — core still imports add-ons only in
  `manifest.ts`.
- `core/shared/registry/associations.ts` derives ext → candidates from
  `APP_REGISTRY` and resolves in four steps: **user override → declared candidate
  → text fallback → nothing**. `resolveOpener` returns *why* it chose, which is
  what lets the file manager show a chooser only in the genuine "we don't know"
  case.
- `file-manager/lib/openWith.ts` went from a 100-line map to a ~40-line adapter
  over the registry. Double-click, Enter and the context menu still share the one
  path.
- New `OpenWithDialog`, and Settings → **Default apps** whose rows are computed
  from the registry, so adding an app puts its types in the list with no second
  edit.

### Departure: the chooser opens directly, not a Properties card

The brief says an unmapped binary should "show a Properties card offering Open
with…". That is one extra click on the way to the only action the card offers. The
double-click opens the chooser itself, with the claimants list empty and the
honest sentence *"No app claims this file type"* at the top. Properties is still
one right-click away for anyone who wanted the metadata.

### Not built as `system.intents`

The brief prefers this live in brief 48's capability rather than the
`@imbatranim/core` barrel. **Brief 48 has not landed**, so it ships as a core
export. The API was shaped to move without changing callers: everything the file
manager uses is a free function over a store (`resolveOpener`, `candidatesFor`,
`allOpenerCandidates`, `associationKey`), so 48 can re-export them behind
`system.intents` and delete the barrel entries. This is a real, recorded debt, not
a resolution.

### Two bugs the brief's regression surface caught

**`.md` would have dead-ended when Markdown Editor was disabled.** The first cut
listed text-ish extensions by hand and `.md` was not among them — so disabling the
app that owns an extension reintroduced exactly the dead click this brief exists
to remove. Fixed by *deriving* text-ishness from what the text apps claim, which
makes the property hold for any extension any text app declares, now or later.

**`.pdf` would have silently reverted brief 65.** Both PDF apps claim `pdf` and
`pdf-viewer` is registered first, so "first candidate wins" hands `.pdf` to the
340-line viewer again. `PREFERRED_DEFAULT` pins the contested case; a test asserts
it, and asserts that disabling norPDF hands `.pdf` to the viewer rather than
nowhere.

### The bug only a second browser could see

The override was wired to brief 49's `prefsStorage`, and every same-tab check
passed — including surviving a reload. It was still **not a dotfile**:
`writePref` silently drops any key absent from `DOTFILE_KEYS`, and
`imbatranimos:file-associations` was not in the list, so the value never left
localStorage. A same-tab reload cannot distinguish the two, which is precisely why
it went unnoticed. `rehydrateDotfileStores` was also missing the store, so even
with the key registered a fresh browser would have kept its import-time default.

Both fixed, and pinned two ways: a unit test asserting the persist key is in
`DOTFILE_KEYS`, and a second probe that sets the default in one browser profile and
reads it in an empty one. Registering a store in `DOTFILE_KEYS` is now documented
as load-bearing rather than bookkeeping.

### Also fixed while here

`@imbatranim/core` declared a dependency on `@imbatranim/logs` (brief 84), the
only add-on it declares, which made turbo print a circular-dependency warning on
every build. Removed — add-ons resolve through the workspace like all the others.

### Before/after: every mapping the old constant had

| Extension(s) | Before | After | Note |
| --- | --- | --- | --- |
| `md`, `markdown` | markdown-editor | markdown-editor | |
| `txt`, `log` | notepad | notepad | root gate already gone (brief 59) |
| `json` `ts` `tsx` `js` `jsx` `css` `html` `sh` `py` `c` `cpp` `h` `hpp` `go` `rs` `java` `rb` `php` `yaml` `yml` `toml` `xml` `sql` | code-editor | code-editor | |
| `pptx`, `ppt` | slides | slides | |
| `xlsx`, `xls` | sheets | sheets | |
| `csv` | sheets | sheets | already added by brief 63, not by this one |
| `docx` | docs | docs | |
| `pdf` | norpdf | norpdf | contested; pinned by `PREFERRED_DEFAULT` |
| `png` `jpg` `jpeg` `gif` `webp` `bmp` `svg` `avif` `ico` | image-viewer | image-viewer | |
| `mp3` `wav` `ogg` `oga` `flac` `m4a` `aac` `opus` | media-player | media-player | |
| `mp4` `webm` `ogv` `mov` `m4v` `mkv` | media-player | media-player | |
| **unmapped text-ish** | **nothing** | **code-editor** | the headline |
| **unmapped binary** | **nothing** | **Open with chooser** | |
| `zip` `tar` `gz` `tgz` `bz2` `tbz2` `tbz` `xz` `txz` | *nothing* | archive-manager | **new** — see below |

Nothing was lost and nothing moved. A parameterised test walks the whole table, so
the migration cannot drift.

### The one genuinely new mapping, and the bug it nearly shipped

Archives were **not** in the old map at all — double-clicking a `.zip` did nothing,
and "Extract here…" in the context menu was the only way in. Declaring
`opens: ['zip', 'tar', …]` on Archive Manager is the obvious fix and it was wrong
on the first cut: the app drains a **typed intent** (`{ action: 'extract', root,
path }`) and ignores the generic `{ openPath, root }` payload every other opener
receives. So the double-click launched an *empty, idle* Archive Manager — a click
that technically opened something and did nothing, which is worse than the dead
click this brief removes, because now it looks like the app is broken rather than
the association.

Fixed in the app that owns the knowledge, not at the call site: Archive Manager
normalises the generic payload into `action: 'extract'` with no `dest`, which is
already brief 78's **list-and-wait** path. Double-clicking an archive now browses
it, which is what "open an archive" should mean.

The general lesson, worth carrying: `opens` is a promise that the app can act on the
*generic* open payload. Any app added to a manifest's `opens` needs that checked,
and reading its intent handler is the check.

### Verified

`turbo typecheck lint format:check test build` — 115/115. Backend unit 408, e2e
141, frontend vitest 1150 (83 of them new here). No new dependencies.

Three Playwright probes against a production bundle served by the real backend, all
23 checks passing with no page errors:

- `.csv` → Sheets; `Dockerfile` and `nginx.conf` → Code Editor; `firmware.bin` →
  the chooser saying nothing claims the type.
- Open with… → Code Editor once, and a plain double-click still uses Markdown
  Editor afterwards; then with "always" ticked, the choice appears in `/api/prefs`
  and survives a reload.
- Settings → Default apps lists the types, reports `Reset all (1)`, and resetting
  clears the server copy and restores Markdown Editor.
- A second, empty browser profile signs into the same account and opens `.md` in
  Code Editor — the account-not-browser claim, actually observed.
- Double-clicking a real `bundle.zip` opens Archive Manager **already listing**
  `one.txt` and `two.txt` with "Extract all" offered — the new mapping doing
  something, not just launching.

Probe-only note, no product bug: `force: true` skips Playwright's hit-target
*check* but the browser still delivers the event to whatever is topmost, so a
restored window overlaying the file manager ate every navigation double-click
silently. Worth remembering for the next probe that reloads.

### Deferred

- Moving the registry behind `system.intents` when brief 48 lands (above).
- "Open with an arbitrary command" and protocol handlers stay out of scope.
- The chooser is per-extension by design; per-file overrides remain rejected.
