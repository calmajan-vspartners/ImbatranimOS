---
summary: Locked choices of the web-OS era (2026-07-16 pivot grilling) plus the 2026-07-17 office-suite/post-v1 set, the 2026-07-18 REST-client SSRF stance, and a compressed record of the superseded ISO-era decisions — do not relitigate without an explicit revisit and a log entry.
updated: 2026-08-03
---

# Decisions (locked)

Changing any entry requires an explicit revisit + a `log.md` entry.

## The pivot itself (2026-07-16)

- **ImbatranimOS is a web-OS, not an installable distro.** A slim
  Alpine-based Docker container running a real Linux userland; the entire
  GUI is a React web desktop served from the container. All ISO-era
  decisions are superseded except where explicitly carried over below.

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

## Inherited from the ISO era

Moved to [decisions-iso-era.md](decisions-iso-era.md) — the carried-over
decisions that still bind (build-from-source, no runtime package manager, the
locked visual identity) and the compressed record of the ones the pivot
superseded. **Still binding**; split out only because this page has a 200-line
cap.

## 2026-07-19 — v1 finish-line decisions (first human walkthrough)

Locked during the first real human QA pass of the desktop:

- **Crimson accent is the confirmed default** (was provisional since brief 14).
  The other 3 presets stay user-selectable in Settings — not dropped.
- **VPS + HTTPS deploy is NOT a v1 gate.** Deferred; the Caddy reverse-proxy
  recipe stays documented for whoever deploys. Brief 15's acceptance is
  relaxed accordingly.
- **No git tags.** The release version lives in `package.json` (already 1.0.0
  across all 25 workspaces) + Dockerfile `LABEL`/`IMAGE_VERSION` + ISO init;
  the About panel reads it at runtime. "Tag v1.0" in brief 15 is void.
- **Kiosk ISO deferred until the OS is feature-complete** — do not treat the
  ISO (brief 18) or its SEC-10 `--no-sandbox` as v1 work.
- **Code-editor VS-Code-style File menu** (open / open-recent) → **v1.\***,
  post-1.0. Not a 1.0 blocker.
- **SEC-9 acted on**: CSP `connect-src` tightened to `'self'` (dropped the
  `ws:`/`wss:` wildcards). Carries a manual cross-browser terminal re-verify
  before it's considered proven — that browser check is the remaining gate.

## 2026-07-19 — OS layering / the compositor seam

Architecture-direction grilling. Canonical design: [os-layering.md](os-layering.md);
locked calls only below. **Reinforces existing locks — reopens none** (confirms
client-rendered desktop; single-container/build-from-source/no-sudo/first-party untouched).

- **Three-layer model:** kernel+userland (backend = syscall/init bridge) ↔
  compositor+display (browser tab = display, core window-manager = compositor,
  client **by necessity** — no server-side compositor/pixel-streaming) ↔ apps.
- **Seam = injected `system` capability handle (mechanism B), not narrowed
  imports** — app imports nothing from core, `SystemHandle` is the protocol spec,
  transport swaps (direct-call → iframe postMessage) without app rewrites. Barrel
  bisects by "can it cross postMessage?": components/hooks → `@imbatranim/ui`
  (library); data/effects → `system.{fs,http,window,intents,notify,on}`
  (`system.http` = lone escape hatch, per-app restrictable later).
- **Session vs dotfile split:** session = ephemeral per-tab in-memory window layout
  (fixes the shared-`localStorage` stomp bug); user config (wallpaper, accent, icon
  positions, pinned taskbar) = durable `$HOME` dotfiles, shared; tmux reattach = future.
- **Isolation = per-window error boundaries now (brief 47)** (first-party threat
  = buggy, not malicious); hard sandboxing = the transport swap, gated on
  third-party apps. **Kill-list (NOT built):** runtime package manager
  (`manifest.ts` is it), session-manager daemon, app-to-app IPC/D-Bus. **DOM
  stays substrate; canvas/WebGPU parked.** Specs: briefs 47 (first), 48, 49.

## 2026-08-03 — norPDF owns `.pdf`; PDF Viewer stays as the light option

Brief 65 asked which of the two PDF apps the OS opens. Measured on the same
40-page PDF, cold, in the shipped production build:

| | PDF Viewer | norPDF |
|---|---|---|
| time to first inked page | **4.2 s** | **5.3 s** |
| own code (gzip) | **5.2 KB** | 202 KB |
| pdf.js (shared by both) | 642 KB gzip | 642 KB gzip |
| chrome | one canvas, zoom + paging | outline, thumbnails, search, annotate, forms, organise, save |

**Decision: `openWith` routes `pdf` → `norpdf`. PDF Viewer is kept, not deleted.**

- The default had to move. While it pointed at the 340-line viewer, norPDF's 3886
  lines were reachable only by launching it from the desktop, which almost nobody
  does.
- Deleting PDF Viewer was the brief's preferred option and the measurement argues
  against it: it costs **5.2 KB gzip**, because pdf.js — the actual weight — is
  shared. There is no size win to collect, and it is measurably faster to first
  page with a fraction of the bytes fetched, which is a real use case ("just look
  at this file").
- Brief 81's "Open with ▸" is the mechanism for choosing it. Deleting the
  alternative *before* the chooser exists would remove the user's option and
  gain 5 KB.

**Known regression, recorded rather than hidden:** norPDF is ~1.2 s slower to
first page. Cause is visible in the numbers — it paints 7 canvases (the page plus
its thumbnail rail) and fetches several times the code. The fix is to get the
first page up before the rail, which is brief 66's territory (norPDF is
undocumented and untested; that brief owns it). Not fixed here, and not pretended
away.

**Also fixed under this brief:** norPDF's own "Open a PDF" was a native
`<input type="file">`, which reads the **host machine**. Brief 54 rules that out
by name — "the computer is the container", and a dialog browsing the user's laptop
instead of their home directory is actively wrong. It now uses the OS's own picker.
Drag-and-drop from the host is kept, because dropping a file is an explicit,
visible host action rather than a dialog pretending to be the OS's.
