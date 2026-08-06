---
summary: The 2026-07-16 web-OS-era and 2026-07-17 Office/post-v1 decisions, still locked — the single-container shape, the add-on contract, the app roster and the Office-suite scope. Split out of decisions.md on 2026-08-05, which has a 200-line cap.
updated: 2026-08-05
---

# Decisions — the pivot era (2026-07-16 / 07-17)

Split out of [decisions.md](decisions.md) on 2026-08-05 when that page passed its
200-line cap. **Nothing here was revisited by the split**; these are locked calls,
and changing one still requires an explicit revisit plus a `log.md` entry. The
newest decisions, and the ISO-era inheritance, live on their own pages.

## Web-OS era decisions (fourth grilling, 2026-07-16)

- **Nature: B — real OS, browser = screen.** Not a browser simulation, not
  just an app platform: the terminal is a real PTY, the file explorer walks
  the real filesystem, the monitor shows real processes.
- **Runtime: Docker container.** `docker run -p 8080:8080 -v …` is the
  product. Bootable/kiosk variants are explicitly not v1. [2026-07-17,
  brief 18: the post-v1 kiosk ISO variant now exists as its own artifact
  under `iso/` (Alpine + cage/chromium, aports mkimage); docker remains
  the product and the primary dev/test loop.]
- **Backend: NestJS/Node** — familiarity + code reuse from
  minimal-web-desktop beats Go's smaller image; accepted trade: image
  ~100–150MB instead of ~20MB. Single port serves statics + API + WS.
- **Frontend: fork minimal-web-desktop** (React/Vite/TS, Tailwind v4,
  Framer Motion, NestJS patterns) and evolve it into ImbatranimOS.
- **Repo layout: `apps/backend` + `apps/core` + `apps/add-ons/<app>`**
  (SUPERSEDES 2026-07-17, brief 17, user-requested revisit of the
  brief-08 "keep the fork's layout" entry). Core = shell + auth +
  settings + Vite host, published to add-ons as `@imbatranim/core`
  (public-surface barrel `src/index.ts`); every windowed app is a
  workspace package `@imbatranim/<app>` under `apps/add-ons/` exporting
  a manifest; `apps/core/src/manifest.ts` is the ONLY file allowed to
  import add-on packages (eslint-enforced both directions). Backend
  keeps its own `modules/` tree — the add-on/backend seam is the HTTP
  API. The fork-import scoping from brief 08 (drop the fork's own
  corpus/CLAUDE.md/.agents) remains in force.
- **Dual-mode container, one multi-stage Dockerfile**: `dev` target runs
  Nest + Vite HMR (2 ports); `prod` target = Nest serves built statics on
  1 port, slim. The "one port / serve statics" rule describes PROD; HMR is
  a dev-target feature. [brief 08 grilling — amends the item below]
- **Security: internet-exposable with proper auth from day 1.** Single
  user; sessions + strong password, optional TOTP, rate-limited login;
  HTTPS built-in or via documented reverse proxy.
- **Shell trust: `imbatranim` user, NO sudo by default.** PTY/FS/API all
  act as this unprivileged user; container runs unprivileged. Root access
  is not a v1 feature.
- **User model: single user.** One login, one Linux user, one home.
- **Persistence: `/home/imbatranim` is a named Docker volume**; the SQLite
  app DB lives inside it. Delete the container, keep your computer.
- **v1 apps:** Terminal (xterm.js + node-pty/WS), Files (real FS),
  System monitor, plus the fork's sticky notes / todo / bookmarks /
  notepad. Cut: docker desktop, service launcher.
- **ISO-era code deleted uncommitted** (explicit choice over archiving);
  the corpus log is the record.
- **HTTPS: reverse-proxy TLS, not built-in** (2026-07-17, brief 10). The
  container stays plain-HTTP on one port; a documented Caddy recipe
  (infrastructure/README.md + Caddyfile.example) terminates TLS with
  automatic Let's Encrypt. Rationale: no cert lifecycle or privileged :443
  bind inside the unprivileged container; LAN/localhost use needs no TLS.
  Behind the proxy set `COOKIE_SECURE=true` + `TRUST_PROXY=true`. CSRF
  stance: SameSite=Lax cookie + Origin check on mutating requests.
- **App-install story, v1 stance** (2026-07-17, brief 13). The Linux side
  (packages, binaries) is fixed at image build time — the desktop user has
  no sudo and no runtime package manager. "Installing an app" in v1 means
  adding a web-app module to the desktop registry (frontend module +
  optional backend routes). A sandboxed native-app store is a possible
  future brief, explicitly out of v1 scope.
- **The fork's config-based `repl` module is deleted** (2026-07-17, brief
  11) — absorbed by the real WS terminal, both backend and frontend halves.
  Its leftover `repl_configs` table drop is on brief 15's fix list.
- **Reskin calls** (2026-07-17, brief 14): dark variant is the shipped
  default; fonts kept (Space Grotesk UI + Inter content); accent is one
  CSS var with 4 Settings presets — crimson `#c0263a` is the PROVISIONAL
  default, final pick awaits the user (see open-questions.md).

## Office suite + post-v1 apps (2026-07-17 grilling; built same day)

- **Client-side JS engines only** for office documents — no
  OnlyOffice/Collabora server, no LibreOffice in the image (slim-container
  identity holds). Viewers: pdfjs-dist (PDF Viewer), pptx-preview
  (Slides, best-effort + Download escape hatch). Editors: Univer grid
  (Sheets), SuperDoc (Docs).
- **Sheets xlsx bridge: ExcelJS (MIT)** — REVISED 2026-07-17 from the
  grilled "SheetJS CE ↔ Univer bridge" after the spike gate failed:
  SheetJS CE's *writer* strips fonts/fills/borders on save (Pro-only),
  destroying styling on every round-trip. User-approved revisit the same
  day; ExcelJS passed the full bar (values, formulas, number formats,
  bold, colors, fills, multi-sheet), verified via independent openpyxl
  read.
- **License: AGPL-3.0-only, repo-wide** (executed 2026-07-17 with brief
  20, approved with the office grilling): required by SuperDoc (AGPL);
  source is public and stays public, no plans to sell.
- **Editor UX: explicit Save only** (Ctrl+S + toolbar, overwrite in
  place, dirty `•`, close-guard warning) — no autosave, no Save As (v1).
  New documents are born in the file-manager (right-click → New →
  Spreadsheet/Document), editors stay dialog-free.
- **Opening files from Files: extension→app map** in the file-manager
  (`lib/openWith.ts`) drives double-click/Enter/context-menu; heavy
  engines are lazy dynamic-import chunks — the desktop boot bundle must
  not grow when apps are added.
- **Screenshot capture = DOM rasterization** (html-to-image), not
  getDisplayMedia (permission dialog breaks the OS illusion) and not
  server-side rendering (slim-image invariant).
