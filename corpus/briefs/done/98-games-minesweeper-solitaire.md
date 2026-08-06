# Brief 98 — Games: Minesweeper + Solitaire (the identity-affirming tier)

Status: **done** (was: todo, ungrilled) · From the 2026-08-06 feature exploration
([wiki page](../../wiki/feature-exploration-2026-08-06.md)) — the landscape
pass found every comparable web desktop ships games (daedalOS's DOOM/emulators
are its most-loved feature; Puter ships a games shelf), and this OS's locked
identity is *Win7-classic with a joke about aging*. EASY/MED · two new add-on
packages (or one `games` package exporting two manifests — grill), zero new
dependencies, no backend.

## Problem

The desktop is a competent workstation and nothing else. The project's soul
is nostalgia — „îmbătrânim", the Win7 taskbar, the hourglass — and the single
most nostalgic thing a Windows-shaped desktop can contain is Minesweeper and
Solitaire. This is also the cheapest new *app category* available: pure
client, zero deps, zero backend, zero security surface.

## Proposed decisions (ungrilled)

- **Minesweeper**: Beginner/Intermediate/Expert presets, first-click-safe
  board generation, flags + question marks, chording, timer + mine counter,
  best-times persisted per difficulty. Keyboard playable.
- **Solitaire (Klondike)**: draw-1 and draw-3, drag *and* click-to-autoplace,
  unlimited undo, auto-finish when the board is trivially won, win/loss stats
  persisted. Cards are DOM/SVG — text ranks + SVG suit glyphs, B&W faces with
  the accent on backs and highlights; **no sprite assets** (the identity is
  tokens, not skins — and it keeps the chunks tiny).
- **Persistence**: local (the brief-49-shaped pref pattern) — best times and
  stats are user config; an interrupted game is session state and may die
  with the window in v1.
- **House rules apply fully**: lazy chunks, window min-sizes measured honestly
  at 1280×577, hotkeys through the shortcut registry (F2 new game is the
  era-correct binding), disableable in the add-on manager, `meta` keywords so
  the palette finds "mines"/"cards".
- **Grill: one package or two.** One `games` package exporting two manifests
  keeps shared bits (stats persistence, a `useGameTimer`) together and proves
  `manifest.ts` can register two apps from one workspace package; two packages
  is the boring precedent. Recommendation: one package, two manifests — the
  registry takes `AppConfig[]` entries either way.

## Fix

1. Package scaffold + two manifests wired in `apps/core/src/manifest.ts`.
2. Minesweeper: board model as a pure tested module (generation with
   first-click exclusion, flood reveal, chord logic, win/lose detection).
3. Solitaire: rules engine as a pure tested module (legal moves, auto-place
   targeting, undo stack, auto-finish detection); DnD via pointer events with
   click-to-place as the accessible fallback.
4. Stats/best-times persistence + a small shared timer hook.

## Must preserve (regression surface)

- Eager bundle unchanged (both are lazy chunks).
- No global hotkey collisions: game keys bind window-scoped via the registry.
- The desktop stays professional by default — games are normal Start-menu
  apps, not desktop icons pinned out of the box (icon layout is brief 53's
  territory; don't disturb it).

## Verify bar

Pure-module unit tests (board generation excludes the first click; chording;
flood reveal; every Klondike legal-move rule; undo round-trips; auto-finish
only fires when provably winnable). `turbo` gates green. **Verified in a
browser**: win and lose a game of each; drag and click-place both work;
best-time survives a reload; both windows usable at their min sizes.

## Out of scope

More games (FreeCell, Hearts, DOOM — emulators are rejected on the size/RAM
budget in [real-os-gaps.md](../../wiki/real-os-gaps.md)), multiplayer,
sound effects (no audio system exists), and animated win sequences beyond a
cheap CSS cascade.

## Outcome — DONE 2026-08-06

Shipped: one package, two manifests (the packaging question settled — brief
99 took the same answer), pure rule engines with 25 tests, zero deps, both
apps lazy chunks. Minesweeper: first-click-safe with protected neighbours,
flood reveal, chording (wrong-flag loss preserved as the rule), keyboard play
via roving focus, best times per difficulty. Solitaire: draw-1/3, click-to-
place with run-aware selection, double-click auto-place, foundation digging,
unlimited undo, auto-finish only when provably bookkeeping, lowest-rank-first.
**Departure: free drag deferred** — click-to-place is the accessible model and
good drag choreography is its own project. Found while building: setState-
inside-updater would have double-pushed undo under StrictMode, and
`useRegisteredHotkeys` captures handlers once per key set, so F2 would have
dealt at the first render's difficulty — both routed through refs, and the
same trap then avoided in briefs 95/96.
