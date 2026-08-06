---
summary: The 2026-08-06 feature-exploration sweep — code map + external landscape (Puter, daedalOS, AnuraOS, CasaOS/Umbrel) distilled into seven new ungrilled briefs (93-99), a cheap-wins list, a grill-first tier with the contentious questions named, and what was deliberately NOT proposed because real-os-gaps.md already rejected it.
updated: 2026-08-06
---

# Feature exploration — 2026-08-06

Charter: *"do code exploration and a deep research; write a brief for new
features or add-ons we should implement."* Method: a platform-capability map of
the code (backend route surface, `@imbatranim/core` seams, the manifest
contract, infra constraints), a corpus review (so nothing here re-proposes the
open queue or re-litigates [real-os-gaps.md](real-os-gaps.md)), and an external
landscape pass over the comparable projects — Puter, daedalOS, AnuraOS,
CasaOS/Umbrel.

## The thesis

The 2026-07-31 verdict still holds: the roster is wide (24 apps), the gap is
the layer underneath. What the code map adds is sharper: **the OS keeps
building capabilities and then giving them exactly one consumer.**

- `POST /api/http/request` — a hardened outbound-fetch relay; one consumer
  (REST client).
- `GET /api/files/search?content=1` — a real bounded grep; one consumer (the
  palette).
- `recent_files` + `/api/notes/recent` — a recents service; one writer
  (Notepad), and git-gui grew a *parallel* `git_recent_repos` table instead of
  sharing it.
- `desktopLayer` — an app can paint the desktop; one consumer (sticky notes).
- `commandSources` — global search is extensible; 2 of 23 apps contribute.
- Clock, Calendar and Todo each store schedules in the container, and each
  apologises in its own UI that nothing fires unless its window is open —
  three copies of the same missing core service.

So the best new "features" are mostly **second and third consumers for seams
that already exist**, plus the two genuinely missing app categories the Tier-2
list already named (an image editor; and — from the landscape pass — games,
which every comparable project ships and which the Win7-classic identity
practically demands).

## External landscape (what the comparables ship that we lack)

- **Puter** — app store + publish model, ONLYOFFICE, voice recorder, camera,
  games, an SDK exposing storage/AI to apps. Confirms demand for an app
  ecosystem (our version is [todos/install-apps-from-github.md](../todos/install-apps-from-github.md),
  gated on briefs 47→48) and for a games/creative tier. Its cloud/AI services
  are off-identity for us (egress + credentials).
- **daedalOS** — games and emulators (DOOM, DOSBox, v86), dynamic wallpapers,
  IPFS/Nostr. The lesson is *delight*: the apps people remember are the playful
  ones. Emulators fail our size budget; games do not.
- **AnuraOS** — PWA-first (fully offline), modular `.app` package system with
  a curated repo. Confirms the PWA-installability idea is table stakes for a
  "computer in a tab", and that a reviewed package format is the mature end
  state of the install-from-GitHub todo.
- **CasaOS / Umbrel** — their loved features are dashboard-glance (system
  stats at a look — our widgets angle), one-click app installs, and file
  sharing. Sharing means unauthenticated links — contentious against "auth
  everywhere"; listed under grill-first, not briefed.

## The seven new briefs (93-99, all ungrilled)

| # | Brief | Size | One line |
|---|---|---|---|
| 93 | [core-reminder-scheduler](../briefs/todo/93-core-reminder-scheduler.md) | MEDIUM | One desktop-lifetime scheduler so Clock/Calendar/Todo stop apologising three ways for the same gap |
| 94 | [recent-files-service](../briefs/todo/94-recent-files-service.md) | MEDIUM | Promote Notepad-only recents to an OS service: every opener records, Start menu + picker + palette consume |
| 95 | [paint-app](../briefs/todo/95-paint-app.md) | MEDIUM | The strongest missing app category; lift the snipping tool's annotation layer into a real canvas editor |
| 96 | [desktop-widgets](../briefs/todo/96-desktop-widgets.md) | MEDIUM | Generalise `desktopLayer` (one consumer today) into Win7-gadget-style widgets: clock, agenda, system sparkline |
| 97 | [auto-lock-on-idle](../briefs/todo/97-auto-lock-on-idle.md) | EASY | Lock exists; nothing ever locks by itself — the cheap security win for the VPS deployment |
| 98 | [games-minesweeper-solitaire](../briefs/todo/98-games-minesweeper-solitaire.md) | EASY/MED | The identity-affirming tier every comparable ships; two zero-dep classics, B&W + accent |
| 99 | [diff-tool](../briefs/todo/99-diff-tool.md) | EASY/MED | Monaco's DiffEditor is already in the bundle; give it a window and a "Compare" verb |

Suggested order: **97 → 93 → 94** (platform spine, and 93/94 both want brief
49's prefs/dotfiles thinking nearby), then **95 / 98 / 99** (independent app
tier, any order), then **96** (wants 49 for durable placement; check brief 85's
workspaces hasn't just rewritten the desktop layer underneath it).

## Cheap wins (below brief-size; fold into other work or batch as one)

- **More palette sources**: calendar events, todos, bookmarks-folders, git
  recent repos as `commandSources` — the registry exists, 21 apps contribute
  nothing (`apps/core/src/shared/commands/CommandSourcesRegistry.ts`).
- **Find-in-files UI**: `content=1` search is live on the backend; the file
  manager has no search box that reaches it.
- **Register more app hotkeys** through the shortcut registry — only 2 apps do,
  so the `?` overlay under-sells the OS.
- **Save-spine coverage audit**: norpdf has `useSaveHotkey` but no
  `useUnsavedGuard`; several editors have neither.

## Grill-first tier (real candidates, each with a named contention)

- **RSS reader** — the natural second consumer of `/api/http/request`; the
  contention is untrusted-feed sanitisation (stored XSS via item HTML) and
  whether polling belongs client- or server-side.
- **PWA installability** (manifest + minimal SW) — cheap and real ("a computer
  whose screen is a browser tab" should install as one); contention: the first
  service worker in the codebase is currently reserved to brief 50's browser,
  and CSP interactions (SEC-9) want tightening in the same motion.
- **Sound recorder** — real-OS parity, `MediaRecorder` → `~/Audio`; needs
  HTTPS + mic permission, so it is gated on the VPS/proxy deployment being the
  normal case.
- **Hex viewer** — fills the unmapped-binary hole; wants brief 81's
  always-resolve rule to exist first so it has a place in the open-with chain.
- **Image wallpaper + custom accent** — the most-asked personalisation
  anywhere; **touches the locked visual identity**, so it is a decisions.md
  revisit, not a feature brief. Brief 49 already plans to make wallpaper a
  durable dotfile; `/api/files` can already serve the image.
- **Disk-usage treemap** — extends brief 83's Storage pane into WinDirStat
  territory; contention is whether it is a Storage tab or an app.
- **File share links** (CasaOS/Umbrel's loved feature) — tokenised
  unauthenticated download URLs are *by design* an auth bypass; would need an
  explicit decisions.md revisit of "auth everywhere". Not briefed.
- **Cross-app drag & drop protocol** — the missing glue the code map surfaced
  (drops exist only OS-file→app); pairs with
  [todos/desktop-drag-selection.md](../todos/desktop-drag-selection.md).
- **TOTP recovery codes** ([todo](../todos/totp-recovery-codes.md)) and
  **install-apps-from-GitHub** ([todo](../todos/install-apps-from-github.md),
  gated on 47→48 + a kill-list revisit) — already captured; this sweep
  endorses both, second one as the strategic "add-ons" story.

## Deliberately not proposed (already rejected — see real-os-gaps.md)

Nothing here re-opens the rejection list: no root features, no runtime package
manager (the GitHub-install todo is the sanctioned, gated exception), no
services view, no mixer, no man pages, no printing spooler, no clipboard
manager, no screen recorder, no SSH app, no emulators (daedalOS's flashiest
tier fails the size/RAM budget — the ISO runs entirely from RAM), no
multi-user (the schema enforces `CHECK (id = 1)`; that is an era decision, not
a feature), no i18n (single-user, English-authored; revisit only with a real
second-language user), no email client / external sync (stored credentials +
egress; file-based interop stays the answer).
