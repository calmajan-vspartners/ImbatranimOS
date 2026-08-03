# Log

## [2026-07-16] decision | Architecture locked after research + grilling session

Researched four paths (MS-DOS base, Windows debloat wizard, Ubuntu/Arch
remix, from-scratch) and grilled every branch. Locked: minimal Ubuntu LTS
base, LXQt on X11 for v1 (labwc/Wayland + custom shell as v2 path),
Flatpak/no-snap, ~10-app curated preinstall, ISO-releases-only updates,
scripted debootstrap + live-build with local-only runs (no CI), Calamares,
visible branding + custom Qt Welcome app, friend-install bar as the v1
finish line. Full record in [wiki/decisions.md](wiki/decisions.md).

## [2026-07-16] maintenance | Corpus bootstrapped

Created the corpus skeleton (CLAUDE.md, index, routing, lint, wiki spine)
and seeded the wiki from the session's findings. Repo was empty before this.

## [2026-07-16] decision | Build-tech grilling: pipeline, language, versions, theming, host

Second grilling session resolved every technical unknown: hand-rolled
4-step pipeline (debootstrap/chroot/mksquashfs/xorriso) with AnduinOS as
reference; **build.c on tsoding's nob.h** driving versioned `.sh` chroot
steps (hybrid shape); **Ubuntu 26.04 LTS** (LXQt 2.3/Qt6/Kvantum); SDDM +
PipeWire + NetworkManager; theming = forked Fluent skeleton + ImbatranimOS
identity layer (from-scratch identity considered, deferred — same shape as
the labwc deferral); Welcome app in QML; KDE Discover Flatpak-only;
**privileged Docker on WSL2** as build host with Hyper-V VM fallback.
Details in [wiki/decisions.md](wiki/decisions.md); resolved items cleared
from [wiki/open-questions.md](wiki/open-questions.md).

## [2026-07-16] decision | Product/UX grilling: layout, identity, boot, updates, distribution

Third grilling closed every documentation gap: Win7-classic layout in
modern flat (not Aero), desktop icons + Win-key + Windows shortcuts,
2GB-with-zram floor (4GB rec), hybrid UEFI+BIOS ISO, Secure Boot via
Ubuntu shim, dual-boot supported, notify+one-click updates, English-only
v1, VLC, B&W retro-simple identity with parameterized accents (mockup
pick inside brief 03), semantic versioning, build-from-source
distribution (clone + build, ISO in dist/), Welcome app = tour + status
check. Full record in [wiki/decisions.md](wiki/decisions.md).

## [2026-07-16] todo | Briefs 01-07 filed — the complete v1 path

Filed seven briefs decomposing v1: 01 build-scaffold, 02
desktop-experience, 03 identity-theming, 04 app-layer, 05 installer, 06
welcome-app, 07 v1-release. Dependency order and one-liners in
[wiki/status.md](wiki/status.md). scaffold-iso-build todo marked promoted
into brief 01.

## [2026-07-16] done | Brief 01 (partial) — pipeline proven, then superseded mid-flight

Before the pivot landed: the gate smoke test PASSED (debootstrap + chroot
+ mksquashfs inside privileged Docker on WSL2 — durable finding, WSL2 is a
viable root-build host), Ubuntu 26.04 codename verified as `resolute`,
nob.h v3.9.0 vendored, build.c compiled clean (-Wall -Wextra), the signed
shim chain extracted (26.04 quirk: MokManager ships as plain mmx64.efi),
tool image built, full ISO build started and was interrupted by the pivot.
Code deleted uncommitted by explicit user choice — this entry is the record.

## [2026-07-16] decision | THE PIVOT — from installable ISO to web-OS-in-a-container

Fourth grilling. ImbatranimOS is now a real Alpine-based Docker container
whose entire GUI is a React web desktop ("B: real OS, browser = screen" —
real PTY terminal, real FS, real processes). Locked: Docker runtime;
NestJS backend (fork reuse over Go's smaller image); fork of
gandolh/minimal-web-desktop as the frontend/backend base; internet-
exposable with proper auth day 1 (single user, sessions + password, TOTP
option); shell as `imbatranim` with NO sudo; volume-backed /home; v1 apps
= terminal/files/system-monitor + notes/todo/bookmarks/notepad; identity
carryover (Win7-classic, B&W + accent); friend-run bar replaces
friend-install bar. ISO-era decisions superseded — compressed record kept
in [wiki/decisions.md](wiki/decisions.md).

## [2026-07-16] maintenance | Corpus rewritten for the web-OS era

Wiki spine rewritten (overview, architecture, decisions, status,
open-questions, CLAUDE.md invariants, routing). Briefs 01–07 moved to
superseded/ with top notes; briefs 08–15 filed covering the whole v1 path:
fork-bootstrap → container-image → auth → {terminal, files, monitor} →
reskin → v1-release. ISO-era files deleted from the working tree.

## [2026-07-16] decision | Brief 08 grilled — fork recon + layout/container/metadata calls

Inspected minimal-web-desktop (main): layout apps/frontend + apps/backend
+ infrastructure/, 2 containers (:5173/:3001), bind-mount ../data, and it
ALREADY ships xterm + a service-launcher, plus its own corpus/CLAUDE.md/
.agents/UBIQUITOUS_LANGUAGE.md. Grilling resolved: (1) keep fork's apps/
layout, update our architecture.md to match; (2) container = ONE
multi-stage Dockerfile, dev target (Nest+Vite HMR, 2 ports) / prod target
(Nest serves statics, 1 port, slim) — amends decision 09's one-port rule
to mean prod-only; (3) import code only, drop the fork's corpus/CLAUDE/
.agents/UBIQUITOUS_LANGUAGE (ours is source of truth), mine for facts
first; (4) xterm terminal already exists — brief 08 investigates the
backend PTY reality and adjusts brief 11's scope, does not rebuild blind.
Briefs 08 + 09 rewritten with these; architecture.md + decisions.md updated.

## [2026-07-16] done | Brief 08 — fork imported, pruned, dev loop verified

Imported apps/ + infrastructure/ from minimal-web-desktop (upstream
1a72385, clean copy). Pruned docker-desktop + service-launcher (FE) and the
docker + services modules (BE) + orphaned dockerode. Both apps typecheck +
build clean; node-pty native loads; dev loop smoke-tested (backend
/health + /api/todos, DB inits at configured path, Vite HMR serves).
Load-bearing findings folded into wiki: fork's "terminal" is an HTTP
command-runner not a live PTY (brief 11 stays real work, adjusted); fork
has ZERO auth (brief 10 greenfield); frontend deps split across
apps/package.json + apps/frontend/package.json; file-manager/notes overlap
brief 12. Committed to main in 3 commits (pivot corpus, raw import, prune).

## [2026-07-16] done | Brief 09 — dual-mode container image (desktop+API on one port)

One multi-stage infrastructure/Dockerfile: deps → builder → proddeps → prod
+ dev targets. Backend gained a conditional ServeStaticModule (prod serves
the built desktop on the API port, excludes /api + /health, SPA fallback);
prod frontend built same-origin (VITE_API_URL=/api). imbatranim user uid
1000 (default node user dropped), volume /home/imbatranim, idempotent
entrypoint. Verified: one-port desktop+API, unprivileged user, todo
survives container recreate on the volume, better-sqlite3 + node-pty load
in-image. Compose: prod service + dev profile (bind-mount + HMR, 2 ports).

REVISIT FLAGGED: prod image is 364 MB (cut from 657 MB by dropping the
frontend's hoisted node_modules from runtime + stripping native build
intermediates), over the ~150 MB target and the 200 MB tripwire. Backend-
language decision (NestJS vs Go) is up for a user revisit; recorded in
wiki/open-questions.md + status.md, not silently resolved.

## [2026-07-16] decision | Image-size revisit resolved — keep NestJS, retire 150MB target

User revisited the 364 MB prod image (brief 09 tripwire). Decision: keep
NestJS (fork reuse >> image bytes for a run-once container), retire the
~150 MB target / 200 MB tripwire as unrealistic for Node+Nest, set a new
bar of ≤~400 MB image with cold-start + idle RAM as the real "lightweight"
measure (recorded in brief 15). Amended in wiki/decisions.md.

## [2026-07-16] todo | Brief 16 filed — Turborepo integration

Filed [briefs/done/16-turborepo.md](briefs/done/16-turborepo.md): convert the
repo to a real npm workspace (root package.json + single lockfile; today there
are THREE independent npm ci roots — apps/, apps/backend, apps/frontend — and
apps/package.json looks vestigial from the fork), add turbo.json pipeline
(build/lint/test/dev), adapt infrastructure/Dockerfile install+build layers.
Layout stays locked per decisions.md.

## [2026-07-16] decision | Brief 16 grilled — turbo design locked

Grilling closed four branches: npm workspaces (not pnpm/bun); prod image
stays backend-only via `npm ci --omit=dev --workspace=backend` (not turbo
prune, not root ci); `turbo dev` replaces the dev CMD `&`-shell; local
cache only (no remote cache/CI — revisit with brief 15). Code check found
apps/package.json is PARTIALLY load-bearing: frontend resolves tailwindcss
+ @tailwindcss/vite from apps/node_modules (phantom deps) — brief now
rehomes those two and drops the three unused. Brief 16 rewritten as the
complete spec; build deferred.

## [2026-07-16] todo | Brief 17 filed — backend / core / add-ons restructure

Filed [briefs/done/17-os-restructure.md](briefs/done/17-os-restructure.md):
user-requested split into backend, core (desktop + main OS functions), and
add-ons with one directory per app. Flags an explicit revisit of the locked
"keep the fork's repo layout" decision (amend decisions.md when it lands)
and the interplay with brief 16's workspace/Dockerfile paths (sequencing to
be grilled). Ungrilled — open questions recorded in the brief.

## [2026-07-16] decision | Brief 17 grilled — restructure design locked

Grilling closed the open branches: roots at apps/{backend,core,add-ons/<app>};
ONE WORKSPACE PACKAGE PER ADD-ON (@imbatranim/<app> — user chose stronger
than the folders+lint option); add-ons are frontend-only (backend modules/
tree untouched, seam = HTTP API); core roster = shell + auth + settings,
every windowed app is an add-on (terminal/files/monitor from briefs 11-13
will land as add-ons). Core is the Vite host; apps/core/src/manifest.ts is
the single composition root allowed to import add-ons — this inverts
today's backwards seam (registry + command sources statically import
modules). Sequencing: brief 16 (turbo) first. Brief 17 rewritten as the
complete spec; build deferred.

## [2026-07-17] done | Brief 10 built — auth lands, the OS has a lock

Auth is live end-to-end: single-user credential store in SQLite (argon2id),
httpOnly `imb_session` cookies (SHA-256 stored server-side), first-run
password wizard (no default password ever), optional TOTP (QR enroll in
Settings), per-IP login throttle with backoff, and a global NestJS guard —
every REST route 401s without a session except @Public() auth routes. WS
upgrades get `SessionService.validateFromRequest` via the `ws-auth` barrel
(consumed by brief 11). Frontend: AuthGate gates the whole desktop behind
LockScreen/FirstRunWizard. HTTPS open question RESOLVED: reverse-proxy TLS
(Caddy), recipe in infrastructure/README.md; cookies get Secure via
COOKIE_SECURE/TRUST_PROXY env switches. 32 unit + 11 e2e tests green.
Caveat: argon2-on-Alpine docker build verified by analogy, re-verified in
brief 15's security pass.

## [2026-07-17] done | Brief 11 built — a real terminal, the old repl absorbed

Streaming WS PTY bridge at `/api/pty`: node-pty login shell per socket,
cookie-session auth at upgrade (unauthenticated → 401), resize→SIGWINCH,
WS backpressure so output floods can't kill the tab, revoked sessions kill
their PTYs within 30s. Frontend Terminal (xterm + fit) replaces the
repl-interpreter UI; registry entry is now `terminal`, multi-instance (two
windows = two shells, verified by PID in e2e). The fork's config-based
`repl` module (HTTP command-runner) is deleted — absorbed by the real
terminal, resolving that open question. 17 unit + 3 e2e tests.

## [2026-07-17] done | Brief 12 built — the real filesystem in a window

`files` module extended with a `home` root over the actual home dir;
full REST surface (list/stat/content/download/upload/mkdir/move/copy/
delete) behind the global auth guard. Path jail is defence-in-depth
(percent-decode loop, NUL reject, absolute re-root strip, lexical
containment, realpath symlink verification incl. not-yet-existing
targets) — refusals proven by tests (`../../etc/passwd`, `%2e%2e`,
`%252e`, symlink-out). Binary upload/download round-trips byte-equal.
file-manager UI: tree + list panes, context menu, drag-drop upload,
notes→notepad open intent (also killed the old cross-module store import).
Resolves the files-vs-file-manager/notes reconciliation question: extend,
no duplication; notes module untouched and now rides the hardened service.

## [2026-07-17] done | Brief 13 built — live vitals, and the app-install stance

System Monitor lands: real CPU% (delta cache), memory, home-volume disk,
process table (pid/uid/cpu/mem via ps), About panel (hostname, kernel,
uptime, IMAGE_VERSION), and a kill endpoint hard-scoped to the server
process's own uid (/proc/<pid>/status check; 403 otherwise) with a signal
allowlist — 8 unit tests incl. an unmocked /proc self-read, plus a live
smoke test against the real host. Frontend polls at 1.5s via react-query.
The "app install without sudo" open question is RESOLVED for v1 and
recorded in decisions.md: the Linux side is fixed at image build; adding
apps means adding web-app modules to the desktop registry.

## [2026-07-17] done | Brief 14 built — ImbatranimOS looks like itself

The Win7-classic B&W identity is on screen: bottom taskbar with running-
window buttons and a live tray clock, start button wearing a new geometric
hourglass mark ("îmbătrânim" = we age), compact start menu with the app
list + Lock/Log off, flat near-black/off-white window chrome with an
accent focus tick, themed lock screen/first-run wizard, token-driven xterm
theme. Dark is the shipped default; Space Grotesk + Inter kept. One
parameterized accent var with 4 Settings presets; crimson #c0263a ships as
the PROVISIONAL default (recommended: distinctive vs OS-blue cliché, best
white-on-accent contrast ~6.5:1) — the accent open question stays open
until the user picks from the live desktop. No fork branding remains.
Browser-verified; builds clean.

## [2026-07-17] progress | Brief 15 engineering slice — hardened, measured, stamped

Security pass: route-by-route enumeration + live container probes found NO
auth bypasses (unknown /api/* is 404 JSON not SPA, HEAD hits the guard,
PTY upgrade fails closed on odd paths); FS jail re-reviewed adversarially
— solid, +4 traversal unit tests; multipart filename traversal verified
harmless (busboy basenames + jail backstop). Fixes: over-cap upload now a
clean 413; leftover repl_configs table dropped; dependency-free security
headers (nosniff, frame DENY, no-referrer, CSP tuned to the real build;
HSTS left to Caddy). Backend tests 73 unit + 29 e2e. README rewritten as
the product page (honest no-reset-flow FAQ); everything stamped 1.0.0
(package.jsons, compose imbatranimos:1.0, OCI labels, IMAGE_VERSION).
REAL prod container verified: argon2-on-Alpine WORKS (question closed),
full curl auth flow correct, headers live. Numbers: image 382 MB (≤400 ✓),
cold start 1.42 s, idle RAM 41.3 MiB — "lightweight" receipt recorded.
npm audit triage (nothing applied, lockfiles untouched): bump
@nestjs/platform-express (patched multer DoS) and axios (frontend,
runtime); vite/build-chain items dev-only. Brief 15 stays in todo/ —
remaining acceptance is human-gated: friend-run QA, VPS+HTTPS deploy,
accent final pick, dep bumps, git tag v1.0.

## 2026-07-17 — Brief 16 (turborepo) landed

npm workspaces + turbo 2.10.5, commit `15ae437`. One root lockfile
replaces the three per-dir installs; `apps/package.json` deleted —
tailwindcss + @tailwindcss/vite rehomed to frontend devDeps, the three
unused deps (react-router, react-hook-form, xterm) dropped as decided.
Root `npm run build/lint/test/format:check/dev` via turbo; FULL TURBO
cache hit verified. Dockerfile: one `npm ci` at /app, `npx turbo build`,
proddeps `npm ci --omit=dev --workspace=backend`; prod image 385 MB
(zero frontend deps confirmed), health 200 ~1.1 s; compose dev = Nest
watch + Vite HMR under `npx turbo dev`. Two decisions made while
landing: (1) turbo `envMode: loose` — strict mode filtered runtime env
(DB_PATH etc.) from tasks and crashed Nest in the dev container;
(2) prettier pinned exactly 3.8.3 in both apps — the regenerated
lockfile pulled 3.9.5 which reformats ~30 files. Found + fixed in
passing: dev image never copied entrypoint.sh (pre-existing; container
could not start). Found, NOT fixed (src off-limits): frontend eslint
errors + backend never prettier-clean → todos/lint-format-debt.md.
Fresh `npm audit`: 0 vulnerabilities at the new lockfile — the brief-15
audit-triage item is effectively closed by the dep refresh.

## 2026-07-17 — Brief 17 (restructure) landed

apps/{backend, core, add-ons/*}, commit `63876e9`. apps/frontend became
apps/core (shell + auth + settings + Vite host, published as
@imbatranim/core via a deliberate public-surface barrel); SEVEN windowed
apps extracted to workspace packages under apps/add-ons/ (the grilled six
plus system-monitor, which landed via brief 13 after the spec was
written — the roster decision covers it). The dependency direction is
inverted for real: add-ons export manifests (AppConfig + optional
commandSources), core/src/manifest.ts is the single composition root
that may import @imbatranim/* (eslint no-restricted-imports enforced in
BOTH directions, proven by deliberate violations), and the old
registry.tsx is a re-export shim so shell consumers didn't churn.
bookmarks/recent-files palette sources moved into their add-ons;
recent-files now delivers the opened path as an intent via openApp (the
shell-owned version opened an empty window). Verified end-to-end in a
real browser (agent-driven): wizard → login → all 8 apps open, live PTY,
add-on bookmark results in the palette; built CSS byte-identical.

Two significant finds: (1) REAL BUG, pre-existing — the taskbar Tray
typed /api/system/stats as {cpu: number, ramUsedGb…} but the API returns
{cpu:{percent,cores}, memory:{…}}; the desktop white-screened after
login on every deploy since the brief 13/14 seam. curl-based verify
(brief 15) could never see it — a browser-level check now exists as the
bar. Fixed in core. (2) The "backend was never prettier-clean" debt got
paid: formatting sweep `934619f` (89 files, verified neutral: tests +
byte-identical CSS), after root-pinning prettier 3.8.3 so backend's
eslint-plugin-prettier stops resolving whatever npm hoists. Root lint is
green for core + all 7 add-ons; backend#lint stays red on pre-existing
unsafe-any in raw sqlite code (out of scope for 17; still in
todos/lint-format-debt.md). Also fixed while acceptance demanded green
lint on the moved surface: 6 pre-existing react-hooks setState-in-effect
errors (render-time adjustment pattern) and dead ReplInterpreter.tsx
deleted.

## [2026-07-17] todo | Brief 18 filed — Alpine kiosk ISO, researched

Filed briefs/todo/18-alpine-kiosk-iso.md: the post-v1 bare-metal
variant — a bootable Alpine ISO whose whole interface is one fullscreen
chromium (cage Wayland kiosk) rendering the web UI served by a local
backend. Research done inline and folded into the brief: cage 0.2.0 +
chromium 142 (263 MiB installed) are in Alpine 3.22 community;
greetd/agetty autologin recipes exist and are proven (~235 MB X11
signage image as prior art); cog/wpewebkit not packaged, ruled out.
Build = aports mkimage.sh custom profile (mkimg.imbatranim.sh +
genapkovl-imbatranim.sh) driven by build.c + vendored nob.h in Docker,
per the user's spec — same pipeline shape as the superseded ISO era.
Diskless run-from-RAM model; est. 1.5–2 GB RAM floor, to be measured.
Docker stays the primary dev/test loop; doesn't flip the "bootable is
not v1" decision.

## 2026-07-17 — Office suite grilled: todo promoted to briefs 19 + 20

Grilled todos/office-suite-addon.md into two post-v1 briefs. Locked:
client-side JS engines only (no OnlyOffice/Collabora server, no
LibreOffice in the image — slim-container identity holds). Four
packages, Google-flavored names: PDF Viewer (react-pdf, view-only),
Slides (best-effort pptx renderer, view-only, spike-gated), Sheets
(Univer Apache-2.0 + SheetJS CE xlsx bridge, editing, spike-gated),
Docs (SuperDoc, real docx round-trip editing). SuperDoc is AGPL-3.0 —
user approved relicensing the repo AGPL-3.0-only (source stays public
on GitHub, no sale plans); the relicense lands in brief 20. UX locked:
explicit Save only (Ctrl+S, overwrite in place, dirty `•`, no autosave
despite the notepad precedent), new documents via file-manager
right-click → New → Spreadsheet/Document (editors stay dialog-free).
Brief 19 = viewers + file-manager ext→app map; brief 20 = editors +
LICENSE. Both queued after brief 15 (v1), non-gating. Brief number 18
was already taken by the kiosk ISO.

## 2026-07-17 — Snipping Tool + preview pane grilled: briefs 21 + 22

Grilled todos/screenshot-tool-addon.md and todos/file-preview-pane.md.
Brief 21 (Snipping Tool, @imbatranim/snipping-tool — the Win7-era
name): capture = DOM rasterization, spike-gated (getDisplayMedia
rejected — permission dialog breaks the OS illusion; server-side
rendering rejected — slim-image invariant). One flow: dim + crosshair
overlay via body portal (covers taskbar), drag region / Enter = full
desktop; annotation kit arrow/rect/text/pixelate/freehand + undo +
color; exits = Save to ~/Pictures/Screenshots (primary) + Copy
(clipboard, secure-context best-effort) + Download. Per-window capture
and keybinds deferred. Brief 22 (preview pane): extends the existing
file-manager (no new package) with an Explorer-style toggleable pane —
text/images/audio/video via native rendering, zero new deps, metadata
card fallback; PDF/markdown previews deferred (removes any dep on
brief 19). Both post-v1, non-gating, independent.

## 2026-07-17 — Brief 18 done: Alpine kiosk ISO boots into the browser

Built the post-v1 bare-metal variant under `iso/` (own lane, no
`apps/**` or `infrastructure/**` touched). `./build iso` = a C driver on
vendored nob.h v3.10.0 that exports a clean `git archive HEAD` snapshot,
builds an Alpine 3.22 Docker toolbox, and runs the official aports
`mkimage.sh` **unprivileged (fakeroot)** — the WSL2 smoke test passed on
the first try (no privileged fallback needed; that durable ISO-era
finding still holds, now for mkimage too).

Decisions (open questions resolved, rationale in `iso/README.md`):
- **App delivery = custom signed `.apk`** (not tarball-in-overlay). The
  payload — backend dist + core statics + prod node_modules with
  better-sqlite3/node-pty/argon2 compiled for Alpine's musl+nodejs ABI —
  ships as `imbatranim-os`, served to mkimage from a local signed repo.
  Its `depends=` drags in the whole kiosk stack so the apkovl world is two
  lines (alpine-base + imbatranim-os) and the overlay stays tiny (~950 B),
  which matters for diskless RAM. Feasible, so the fallback wasn't needed.
- **Autologin = greetd** (not agetty+profile): `initial_session` execs the
  kiosk launcher as `imbatranim` with no greeter and no getty on any VT →
  satisfies "no console / no shell flash" cleanly. seatd for seat mgmt,
  XDG_RUNTIME_DIR set by the launcher (no elogind, lighter).
- **Kernel lts**, **stateless tmpfs** (fresh setup each boot — invariant-
  clean; lbu persistence is the later path), **browser knob** deferred.

Verification (QEMU/VirtualBox binaries absent, but `/dev/kvm` present, so
booted qemu inside Docker with `--device /dev/kvm`): the ISO **boots via
BIOS straight into fullscreen chromium showing the ImbatranimOS first-run
login** — hourglass logo, "Set up this computer" password form, crimson
theme, no console, no window chrome, no shell. Screenshot-verified. Two
bugs found+fixed this way: (1) the launcher couldn't `mkdir /run/user/<uid>`
(no elogind) → fall back to a `/tmp` runtime dir; (2) when the session
failed greetd showed a fallback `login:` prompt → launcher now never exits
(loops forever) so the browser always owns the screen. Measured: ISO
**580 MiB**, RAM floor **2 GB** (1 GB reaches OpenRC but the run-from-RAM
install exhausts tmpfs), boot-to-login **< ~2 min** under emulation.

Human-gated remainder (couldn't do headless): UEFI *live* boot (the ISO
has the UEFI El Torito image + bootx64.efi structurally, and BIOS boot
works), VirtualBox/Hyper-V, real/old hardware, and the interactive
type-password → terminal/files walkthrough. Docker dev loop untouched;
root README gained one `iso/` pointer (docker stays the headline).

## 2026-07-17 — Briefs 22 + 21 done: preview pane and Snipping Tool

Wave 1 of the post-v1 backlog run (orchestrated: plan-split-dispatch in
waves, one commit per brief). Brief 22 (`2b014b2`): Explorer-style
toggleable preview pane inside file-manager — text/images/AV native,
metadata card for everything else (never an error), 1 MB text cap,
debounced selection with stale-fetch protection, drag-resizable width +
toggle persisted in localStorage, auto-collapse below 640 px, zero new
deps. Found + fixed a pre-existing FileList bug: row clicks bubbled to
the background clear-selection handler, so mouse click-to-select had
never worked. Brief 21 (`acfe862`): Snipping Tool on html-to-image
(spike passed — xterm v6 runs the DOM renderer here, so terminal
content rasterizes as real DOM), dim+crosshair portal overlay, 5
annotation tools + undo, Save/Copy/Download exits; rasterizer a lazy
chunk; tray icon + PrintScreen deliberately skipped (scope latitude,
rationale in the brief outcome).

## 2026-07-17 — Brief 19 done: PDF Viewer + Slides, ext→app open map

Commit `685012c`. Spike PASSED on a real 11-slide deck → Slides ships
(pptx-preview; synthetic pptxgenjs decks render empty, so a "nothing
rendered → Download" fallback covers unparseables). Deviation: PDF
engine is pdfjs-dist direct instead of react-pdf (cleaner lazy
loading). The shared plumbing both office briefs need landed here:
file-manager `lib/openWith.ts` extension→app map driving double-click,
Enter, and context menu. Durable pattern for all document apps: latch
the open-intent in a ref-guarded effect (notepad's render-selector
consume is StrictMode-unsafe — captured as
todos/notepad-intent-strictmode.md), fetch bytes via core's authed
client, keep engines behind dynamic import (verified separate chunks).

## 2026-07-17 — Brief 20 done: Sheets + Docs, AGPL relicense; sheets engine REVISED

Commits `b9fe0fa` (relicense) + `3531b41` (editors). The SheetJS CE ↔
Univer spike FAILED the locked formatting bar: SheetJS CE's writer
strips fonts/fills/borders on save (Pro-only) — confirmed with a pure
read→write→read, independent of the bridge. User re-decided same day:
**ExcelJS (MIT) is the xlsx bridge** (decisions.md revised); its spike
passed the full bar (values, formulas, number formats, bold, colors,
fills, multi-sheet; verified via independent openpyxl read). Docs hit a
second landmine: SuperDoc 1.45 export silently returns the ORIGINAL
bytes when a docx lacks styles.xml / document.xml.rels / custom.xml
(unguarded `convertedXml[...].elements[0]` reads, throw swallowed) —
root-caused and fixed with `normalizeDocx()` injecting minimal parts on
open; round-trip then verified on disk. Repo is now AGPL-3.0-only
(SuperDoc requirement, approved at grilling). Core windowStore gained
generic `updateTitle` + close-guard hooks (the brief's "one manifest
line" core assumption was wrong; controller-authorized). Explicit-Save
UX per spec: Ctrl+S, dirty •, close warning, New → Spreadsheet/Document
from embedded blank templates.

## 2026-07-17 — Review pass over the backlog run: 6 findings fixed

Three scoped sonnet finders (integration/wiring, new-module logic,
security/invariants) swept the cumulative diff; integration finder came
back clean. Six confirmed findings fixed in `b46f64e`: (1) xlsx bridge
read `value.sharedFormula` — the master ADDRESS, not a formula — for
fill-down followers, corrupting every shared formula on save; now reads
the translated `cell.formula` (round-trip-proven). (2+3) both editors
cleared the dirty flag after an in-flight save even when edits arrived
during the upload (close-guard then silent → data loss); fixed with an
edit-counter snapshot. (4) Slides stale renders could interleave two
decks in the shared stage node; renders now own detached targets
committed only if current. (5) screenshot filenames collided within the
same second; ms suffix. (6) ISO post-install ran `passwd -u` (unlock)
under a "lock the password" comment — the belt-and-braces `*` line made
the end state safe incidentally; now `passwd -l`. Reuse debt (4×
duplicated fileBytes/openedFileStore helpers, hand-rolled download
URLs) deliberately NOT refactored at the tail of the run — captured as
todos/office-addon-shared-helpers.md for a core-contract brief.

## 2026-07-17 — Full review pass + brief 23 (shared-addon-kit)

Ran a 3-reviewer + verifier sweep (security / performance / code-smell,
each opus; opus verifier to drop false positives) over the whole
codebase. 30 findings survived verification (no outright false positives;
one dedup, a few line corrections). Applied + committed the **safe
subset**: the genuinely dangerous security items (session cookie
auto-Secure from req protocol, TOTP enroll step-up password, WS terminal
Origin check, PTY concurrency cap + geometry clamp, throttle global
backstop, `/files/content` size cap, Content-Disposition sanitize) plus
perf/code-quality wins (debounced layout persist, tab-gated system-monitor
poll + row cap, streamed uploads, bookmarks index/typing, query-DTO
validation, dead-code + magic-number cleanup, PTY types). Backend 80 unit
+ 29 e2e green; monorepo typecheck/format clean; backend#lint debt
unchanged (pre-existing, [lint-format-debt](todos/promoted/lint-format-debt.md)).
Deferred the larger refactors + product-decision security items as todos.
Two commits on `main`.

Then built **brief 23** via plan-split-dispatch (1 senior core surface +
8 consumer chunks). Collapsed the duplicated add-on spine into
`@imbatranim/core`: `fetchFileBytes`/`uploadFileBytes`/`UploadTooLargeError`/
`downloadUrl`/`fileName`, `createOpenedFileStore`,
`useOpenIntent`/`useSaveHotkey`/`useUnsavedGuard`, `ConfirmDialog`/
`useConfirm`. All four document add-ons deleted their local
`api/fileBytes.ts` + `store/openedFileStore.ts` (8 files) and adopted the
hooks; download buttons route through core `downloadUrl`;
bookmarks/sticky-notes/notepad dropped native `confirm()` for the themed
dialog (file-manager kept its already-correct themed delete Dialog — a
deliberate scope trim). Net −333 LOC. Gates: turbo typecheck 13/13,
format 14/14, lint 13/13, build ✓. A 2-finder review (opus integration +
sonnet core-logic) confirmed the single shared opened-file store is a safe
singleton (uuid windowIds, multiInstance) and hook behavior parity is
exact; its findings (`useConfirm` re-entrancy + unmount promise-hang, a
param-shadow, a sheets fallback drift `workbook.xlsx`) were fixed.
Promoted todos office-addon-shared-helpers + destructive-action-confirm-ux
removed on completion; discovered nits captured in
add-on-cleanup-nits (dead `zustand` deps, notepad native `prompt()` — both
since resolved in brief 30). Human-gated remainder: the in-browser
walkthrough per the brief's verify bar.

## 2026-07-17 — Full-auto backlog run: briefs 24 + 25 (review-pass todos)

Master-orchestrator run through the deferred review todos (standing
authorization). Briefs 24 and 25 built in parallel (disjoint file sets),
verified together, committed separately.

- **Brief 24 (window-render-perf, PERF-1):** one senior agent, indivisible
  core change. `WindowContainer` subscribes only `{id,appId,zIndex,
  isVisible}` via `useShallow`; `Window` is `React.memo` reading its own
  instance via `s.windows.find`; `ResizeHandle` reads `getState()` in its
  handler. Untouched windows keep object identity + the container's
  projected list is drag-invariant, so only the moving window's chrome
  re-renders and no app subtree reconciles. Per-frame store updates kept
  (snapping byte-identical). No transform-drag (out of scope).
- **Brief 25 (notes/FilesService dedup, CS-7):** backend `notes` collapsed
  to `/notes/recent`; Notepad repointed to `/files?root=notes`; removed the
  8 delegation methods, the FilesService dep, and the file-ops/directory-ops/
  path-query DTOs. `createFile` is now an upsert (no create-only `/files`
  endpoint) — accepted for single-user Notepad. `FilesService.ROOTS.notes`
  kept so File Manager + Notepad share one validated surface.

Gates (both): turbo typecheck 13/13, build ✓, format 14/14, lint 13/13,
backend 80 unit + 29 e2e green. Human-gated remainders: in-browser drag
feel (24) and Notepad walkthrough (25). Remaining backlog: CS-3 (26),
PERF-6 (27), SEC-2 (28), lint-debt (29), add-on polish (30); SEC-9 + SEC-10
deferred (browser/ISO-gated).

## 2026-07-17 — Full-auto backlog: briefs 26 + 27

- **Brief 26 (filemanager-split, CS-3):** one senior agent split the
  752-line FileManager into a 531-line orchestrator + 6 focused units
  (useFileSelection / useFileClipboard / useDeleteFlow / usePaneResize /
  useListKeyboardNav + lib/buildMenuItems.tsx). The two delete states
  became one discriminated union; the CS-4 partial-failure banner is
  preserved. "Move, don't rewrite" — no shift-range invented. A sonnet
  behavior-preservation review traced every unit line-by-line: no drift.
- **Brief 27 (docx-offthread-unzip, PERF-6 docx slice):** docxNormalize
  swapped fflate sync `unzipSync`/`zipSync` for async `unzip`/`zip`
  (off-thread), identical output. The xlsx/ExcelJS worker slice stays open
  in office-parsing-blocks-ui-thread.md (needs a real worker + browser
  verification — not headless-verifiable, so out of this pass).

Gates (both): turbo typecheck 13/13, build ✓, format 14/14, lint 13/13.
Committed separately. Remaining: SEC-2 (28), lint-debt (29), add-on polish
(30); SEC-9 + SEC-10 stay deferred (browser/ISO-gated).

## 2026-07-17 — Full-auto backlog: briefs 28 + 29

Parallel wave (auth-feature vs backend-lint lanes), combined-verified.

- **Brief 28 (first-run-setup-token, SEC-2):** opt-in `SETUP_TOKEN`,
  default-OFF (byte-identical to before when unset). Set → `/auth/status`
  advertises `setupTokenRequired` and `/auth/setup` demands a matching token
  (constant-time: `timingSafeEqual` over SHA-256 of both sides) before any
  account is created. Wizard shows the field via the existing status path.
  New auth-setup-token e2e; 80 unit + 34 e2e green. Localhost-bind
  alternative deliberately not taken (would break remote first-run).
- **Brief 29 (backend-lint-typing):** paid the backend `no-unsafe-*` debt —
  typed the raw better-sqlite3 sites + pty/main/test `any`. `backend#lint`
  and root `npm run lint` are now **green (0/0)** — the last lint red is
  gone. Types only, zero behavior change. Two auth-lane leftovers
  (auth.guard + spec) that fell between the 28/29 lanes were fixed by the
  orchestrator at the combined verify.

Gates: turbo typecheck 13/13, build ✓, format 14/14, lint 13/13, backend
80 unit + 34 e2e. Remaining: B30 add-on polish; SEC-9 + SEC-10 deferred
(browser/ISO-gated).

## 2026-07-17 — Full-auto backlog: brief 30 (add-on polish) + run close

- **Brief 30 (addon-polish):** (1) Notepad's open-intent now drains in a
  ref-guarded effect (StrictMode-safe) instead of a render selector; (2) new
  `PromptDialog`/`usePrompt` in core (sibling of ConfirmDialog, same
  re-entrancy/unmount safety) replaces notepad's native `window.prompt`;
  (3) dropped the dead `zustand` dependency from docs/sheets/slides/pdf-viewer
  and regenerated the root lockfile. Gates: typecheck 13/13, build ✓,
  format 14/14, lint 13/13.

**Full-auto review-cleanup wave complete (briefs 23–30).** Realized todos
removed on completion; the promoted-but-historical captures kept. **Still
open:** the xlsx/ExcelJS Web-Worker slice of PERF-6
(office-parsing-blocks-ui-thread.md), and the two browser/ISO-gated security
items — SEC-9 CSP `ws:` scoping (csp-connect-src-ws-wildcard.md, risks the
terminal on some browsers) and SEC-10 kiosk `--no-sandbox`
(kiosk-no-sandbox.md, needs Alpine userns + a QEMU boot test). Every shipped
brief carries a human-gated in-browser verification remainder.

## 2026-07-17 — Daily-driver expansion: research capture + brief 31

- **Test run:** all gates green on brief 30 (`format:check` 9/9, `typecheck`
  13/13 FULL TURBO, `lint` 0/0, `test` 80/80, clean `--force` build 9.1 s).
  Bundle finding: eager login chunk = 1.30 MB raw / 397 KB gzip in ONE chunk;
  root cause = zero `React.lazy` (every add-on `component` is a static import in
  `manifest.ts`); office engines split, app shells don't.
- **Research capture:** "what to build next for a daily driver (normal users +
  web/low-level programmers, no gaming)" pass captured 14 todos — dev apps
  (Monaco code editor, git GUI, REST client, markdown preview), normal-user apps
  (calculator, archive mgr, image viewer, media player, clock, calendar),
  platform (notification center, global search, addon manager), and the
  eager-bundle-lazy-load perf/tooling item.
- **TanStack question:** confirmed Query is already the data layer and well
  configured (nothing to add); the gap is virtualization.
- **Brief 31 (virtualize-long-lists):** promoted after grilling — TanStack
  Virtual on ProcessTable + FileList, dep centralized in `@imbatranim/core` via
  a `useVirtualList` helper, always-virtualize; keyboard-nav `scrollToIndex` and
  scroll-stable-across-refetch called out as the integration risks.
- **eager-bundle-lazy-load:** grilled → **held as a todo, not promoted.** Trigger
  to promote = when a heavy app (Monaco) lands in the eager bundle; no hard size
  target then. A draft brief for it was written and removed per this decision;
  brief number 31 was reassigned to the virtualization work (draft never
  committed).

## 2026-07-17 — Full-auto backlog run (PAUSED near quota; see HANDOFF.md)

User: "go full auto with the remaining todos" via the `orchestrate` skill; scope
"everything actionable" (excl. human-gated SEC-9/SEC-10 + brief 15 remainder).
Ran as a controller + dispatched-subagent loop, one commit per brief. **Paused
mid-run for quota; resume point captured in `corpus/HANDOFF.md`.**

Shipped + committed on `main` (all gates green at each commit):
- **Brief 31 (virtualize-long-lists)** `e8652b5` — TanStack Virtual on
  ProcessTable + FileList via core `useVirtualList`; core `ScrollArea` gained a
  `viewportRef` so the virtualizer reads the scroll node directly (no reliance on
  Base UI internal DOM attrs).
- **Brief 32 (xlsx-offthread-worker, PERF-6 xlsx slice)** `e37bdd3` — ExcelJS
  round-trip moved into a lazy module Web Worker; `xlsxToUniver`/`univerToXlsx`
  signatures unchanged (Sheets.tsx untouched); id-correlated requests, buffer
  transfer, and an onerror/onmessageerror backstop; exceljs now bundles into the
  worker chunk, off the main thread.
- **Brief 33 (eager-bundle-lazy-load)** `0341230` — the held todo's trigger fired
  (Monaco is landing this run), so every app component became `React.lazy` +
  `<Suspense>` in WindowContainer. Eager index gzip **399.6 KB → 121.5 KB
  (−69.6%)**; contract widened to accept lazy components; snipping-tool `APP_NAME`
  moved to a sibling module so a static metadata import stopped defeating its
  split.

Bookkeeping still owed (first resume task): move briefs 31/32/33 to `done/` with
outcome notes, add status rows, mark source todos promoted. Remaining waves
(34 notification-center → light apps 35-40 → heavy/backend 41-44 → platform
45-46) are fully specced in HANDOFF.md.

Note: turbo `core:build` cache key omits add-on `src` — use
`npm run build -- --force` when measuring bundle output.

## 2026-07-18 — Resume full-auto backlog run; 31/32/33 bookkeeping settled

Resumed the paused run (see `HANDOFF.md`). Cleared the owed first-resume task:
briefs **31/32/33** moved to `briefs/done/` with Outcome notes (commits
`e8652b5`/`e37bdd3`/`0341230`), `wiki/status.md` rows updated (31→done, 32/33
added, summary + daily-driver section refreshed), and source todos marked
`promoted` (`virtualize-long-lists` already was; `office-parsing-blocks-ui-thread`
— both docx+xlsx slices now shipped; `eager-bundle-lazy-load` — trigger met).
Verified typecheck 13/13 green before recording. Committed as `docs(corpus)`.
Continuing into Wave B tail: brief 34 notification-center.

## 2026-07-18 — Brief 34 (notification-center) shipped

CORE platform surface (commit `82c635b`). Persist-backed `notificationStore`
(zustand + `persist`, partialized so live toasts never resurrect on reload;
history bounded 100); public `notify(input) => id` + `useNotificationStore` +
types on `@imbatranim/core`. `ToastHost` = bottom-right auto-dismiss stack above
the taskbar (errors sticky, pointer-events scoped, cap 5), mounted in App.
`NotificationPanel` = tray-bell popover with unread badge, history list, mark-all
-read / clear-all / DnD, click-to-open. Level visual is icon + accent/error token
only (no new palette); `LevelIcon` + `levelStyle` split to satisfy
react-refresh/static-components. Gates green (typecheck 13/13, lint 14/14,
format, build); eager index gzip 121.5 → 125.1 KB (+3.6 KB shell cost). First
callers will be clock alarms (36) + calendar reminders (40). Next: Wave C.

## 2026-07-18 — Wave E: platform surfaces (45–46) shipped; full-auto backlog COMPLETE

Two CORE surfaces, built by a 2-agent parallel batch (disjoint file sets, no
conflicts), integrated + gated, commit `3e72333`:
- **45 global-search-launcher** — jailed + bounded backend FS search
  (`GET /api/files/search`: filename + opt-in content grep; root via
  `resolveSafe`, walk joins only dirent names, symlinks never followed, caps on
  results/entries/depth/time → `truncated`, skips node_modules/.git/dotdirs;
  content grep size-capped + binary-sniff; 9 tests). Frontend: a "Files" command
  source, a `paletteStore` (App.tsx refactored so Mod+K + a new Taskbar Search
  button share open-state), and a file-manager `{navigatePath}` intent to reveal
  a hit's folder. Extends `CommandSourcesRegistry` — no fork.
- **46 addon-manager** — persisted per-user disabled-set (`imbatranimos:addons`)
  + a single `enabledApps` filter for the launchers (Start/palette/Desktop),
  an `openApp` guard, and a Settings "Apps" section; runtime (Taskbar running
  windows, WindowContainer render) stays on the full registry;
  settings/file-manager/terminal are non-disableable.

Gates: FE typecheck 23/23 + lint 24/24 + build; BE build + **tests 135/135** +
lint. No new dependency. The search endpoint was self-reviewed (read-only, jailed
via the proven `resolveSafe`, symlink-skip, bounded) rather than given a full
adversarial subagent pass like Wave D's exec/proxy surfaces.

**The full-auto daily-driver backlog (briefs 34–46) is now COMPLETE.** Across the
run: 1 CORE notification center, 6 light apps, 4 heavy/backend apps (3 backend
modules, adversarially security-reviewed + hardened), 2 CORE platform surfaces —
13 briefs, each committed with green gates, plus a `docs(corpus)` per wave and
the SSRF decision recorded. Desktop = 23 apps; backend = 135 tests. What remains
before v1.0 is only the human-gated set the run explicitly excluded (SEC-9,
SEC-10, brief 15 remainder) + per-brief human walkthroughs. `HANDOFF.md` retired.

## 2026-07-18 — Wave D: heavy/backend apps (briefs 41–44) shipped + security-reviewed

Built by a **4-agent opus batch** (each scoped to its own module/package dir),
integrated serially by the controller (app.module.ts for 3 backend modules,
manifest.ts + openWith.ts + file-manager context menu, one `npm install` adding
monaco). Then — per the user's "all 4 with extra security review" choice — **3
adversarial security-review subagents** (git-arg-injection/jail-escape, SSRF,
zip-slip) ran over the backend modules. **No exploitable finding in any module.**
Four hardening findings were fixed (with tests) before commit. Landed as one Wave
D commit `4be1777`.

- **41 code-editor (Monaco)** — self-hosted (no CDN; `loader.config({ monaco })`
  + Vite `?worker` chunks), fully lazy → eager `index-*.js` gzip unchanged.
  Multi-tab, find/replace, real-FS save. Deps monaco-editor + @monaco-editor/react
  (justified: lazy). Code exts rerouted from notepad. The lone `cdn.jsdelivr.net`
  string is the library's inert default (bypassed; CSP blocks it anyway).
- **42 git-gui** — backend git module: `execa` array-args, no shell, `--`
  pathspec guard, `GIT_LITERAL_PATHSPECS=1`, jailed `cwd` via `resolveSafe`,
  work-tree + (hardening) `--show-toplevel`-within-jail check. 20 tests. LOW
  ancestor-`.git` finding closed.
- **43 rest-api-client** — owner-authed HTTP proxy; scheme allowlist per redirect
  hop, size/timeout/redirect caps, no cookie/auth leak (+ cross-host strip
  hardening). SSRF stance recorded in decisions.md. 13 tests. Reviewer: safe as-is.
- **44 archive-manager** — zip (fflate) + tar.gz (tar via execFile) with per-entry
  `resolveSafe` (zip-slip-proof), temp+realpath symlink walk, ratio-bounded caps
  fixing a **Medium forged-header amplification DoS** (387 B → 512 MiB), + a
  hardlink guard. 13 tests (incl. amplification regression). Used `execFile` (not
  execa: ESM/CJS) — same no-shell guarantee.

Desktop now **23 apps**; backend has git/http-proxy/archive modules, all authed
+ jailed. Gates: frontend typecheck 23/23 + lint 24/24 + build (Monaco lazy,
eager unchanged); backend build + **tests 126/126** + lint + format. No new
backend dependency. Next: Wave E platform surfaces (45 global-search-launcher,
46 addon-manager).

## 2026-07-18 — Wave C: six daily-driver apps (briefs 35–40) shipped

Built as a **6-agent parallel batch** (sonnet build subagents, each scoped to
one `apps/add-ons/<app>/` dir, no shared-file edits), then integrated serially
by the controller (manifest.ts 6 imports+entries, openWith.ts image+media exts
and md/markdown reroute + labels, one `npm install`). Landed as **one Wave C
commit `a7632ab`** — a deliberate deviation from strict one-commit-per-brief:
the six were a cohesive parallel wave sharing manifest.ts / openWith.ts /
package-lock, each brief is named in the commit body + has an outcome note, and
the tree gates green so nothing is left uncommitted. Apps:

- **35 calculator** — Basic (shunting-yard, no `eval`) + Programmer (BigInt
  64-bit, HEX/DEC/OCT/BIN + bitwise/shift). Own lazy chunk 3.82 KB gz.
- **36 clock** — world clocks (Intl, no tz lib), stopwatch, timer, alarms;
  timestamp-driven; alarm/timer → `notify()`. 4.52 KB gz.
- **37 image-viewer** — root-aware `<img>` via `downloadUrl`, zoom/fit/rotate,
  folder prev/next; registered 9 image exts. 2.68 KB gz.
- **38 media-player** — native `<audio>`/`<video>` range-streamed (no buffering,
  memory-cap posture), custom transport, folder queue; registered 14 AV exts.
  4.00 KB gz.
- **39 markdown-editor** — split-view react-markdown + remark-gfm, **no
  rehype-raw** (XSS-safe), full save flow; `md`+`markdown` reroute from notepad.
  1.81 KB gz (renderer shared).
- **40 calendar** — month/week, persisted events (own store), reminders →
  `notify()`. 3.98 KB gz.

Clock (36) + calendar (40) are the first real notification-center callers. No
new dependencies (all hoisted). Desktop now **19 apps**; every new app is its
own lazy chunk, eager `index-*.js` gzip unchanged (~125 KB). Gates: typecheck
19/19, lint 20/20, format, build all green. `npm install` reports 4 moderate
audit findings — pre-existing transitive dev-dep advisories, not introduced by
these client-only apps (no runtime dep added); flagged for a later audit pass,
not gating this wave. Next: Wave D (heavy/backend — Monaco, git-gui,
rest-api-client, archive-manager).

## [2026-07-19] qa | First human walkthrough of v1 — findings + fixes

A real person drove the desktop (docker-compose run) and reported issues; this
session triaged and fixed the writable ones. Fixed:

- **Media Player seek** (backend). `GET /api/files/download` piped the whole
  file with 200 and no `Accept-Ranges`, so the media element could never seek
  to an unbuffered position (auto-advance worked because it just plays to the
  end). Added HTTP Range support: `statFile`/`openRange` in FilesService,
  206 + `Content-Range`/`Content-Length` + `Accept-Ranges: bytes` +
  416-on-unsatisfiable in the controller (`parseRangeHeader`), range-less GET
  still 200. 3 new e2e tests; files e2e 11/11.
- **Global search scroll-reset** (core). CommandPalette auto-scrolled the
  active row into view on *every* selectedIndex change, and hover set the
  selection — so wheel-scrolling dragged the pointer across rows, reselected,
  and yanked the list back. Now only keyboard nav (`keyboardNavRef`) triggers
  scrollIntoView, and it queries the real `[aria-selected]` row (the old
  `children[selectedIndex]` indexed group `<li>` wrappers, not rows).
- **Git GUI crash** (core). `Select` placed `BaseSelect.Label` *outside*
  `BaseSelect.Root` → "SelectRootContext is missing" whenever a `label` prop
  was passed (only git-gui does). Moved Label inside Root; fixes the crash +
  the nested-`<button>` warning for every Select consumer. core typecheck green.
- **SEC-9** — CSP `connect-src` tightened from `'self' ws: wss:` to `'self'`
  (CSP3 covers same-origin ws/wss). Removes the XSS exfiltration wildcard;
  **needs cross-browser terminal re-verify** (the reason it was left broad).

Decisions this session: **crimson accent CONFIRMED** as the default; the 4
presets stay selectable in Settings. **VPS+HTTPS deploy dropped from the v1
bar** (deferred, recipe stays documented). **git tag dropped** — version lives
in package.json (already 1.0.0 across all 25 workspaces + Dockerfile
LABEL/IMAGE_VERSION + ISO init; About panel reads it). **Kiosk ISO deferred**
until the OS is feature-complete. **Code-editor VS-Code-style File menu**
(open / open-recent) → **v1.\*** (post-1.0).

Not done / needs a decision:

- **Clock timer off-by-one** (05:00 flashes 05:01 at Start — stale `useNow`
  tick makes `endAt - now` momentarily exceed durationMs and round up). Fix is
  a one-line clamp to `durationMs`; **BLOCKED — `apps/add-ons/clock/src` is
  read-only** (owned by `imbatranim`, group `imbdev` has no write; same for
  git-gui/calendar/media-player/code-editor/… — every Wave C/D add-on source
  dir, created with a restrictive umask during the autonomous run). Patch saved
  to scratchpad `clock-timer-fix.patch`. Unblock: `sudo chmod -R g+w
  apps/add-ons/*/src` (needs the sudo password this session doesn't have).
- **uuid advisories** — `npm audit` now shows 6 moderate (uuid `<11.1.1`,
  bounds-check-on-`buf`) via `exceljs` (Sheets) + `pptx-preview` (Slides). NOT
  exploitable here (both use random `v4`, never `buf`). The brief-15 "dep
  bumps" (`@nestjs/platform-express`, multer) are already at latest (11.1.28 /
  multer 2.2.0); **axios is not a dependency at all**. The clean surgical fix
  (root `overrides` → uuid `^11.1.1`) is **silently ignored by npm here** (never
  written to the lockfile even via `--package-lock-only`); it only takes with a
  full `rm -rf node_modules` reinstall, not run unattended given native modules
  (argon2/better-sqlite3/node-pty) and no way to smoke-test Sheets/Slides.
  Left at baseline (6 moderate, lockfile unchanged) pending a decision.

## [2026-07-19] design | OS-layering grilling — the compositor seam

Grilled the `os-architecture-layering-research` todo end-to-end (grill-me).
Drivers resolved as (b) SSH-session feel + (c) app isolation + (d) soul — not
app-layer pain. Locked a three-layer model (kernel/userland ↔ compositor/display
↔ apps) with the app↔OS seam as an **injected `system` capability handle**
(mechanism B, not narrowed imports — so the transport can swap from direct calls
to sandboxed-iframe postMessage later without rewriting apps). Bisected the
`@imbatranim/core` barrel by "can it cross postMessage?": components/hooks →
`@imbatranim/ui` (library), data/effects → `system.{fs,http,window,intents,
notify,on}`. New session/dotfile split: ephemeral per-tab window layout (fixes
the shared-`localStorage` stomp bug) + durable `$HOME` dotfiles for user config.
Kill-list: no runtime package manager, no session-manager daemon, no D-Bus. App
isolation = per-window error boundaries now (first-party threat model); hard
sandboxing gated on third-party apps arriving. DOM stays the substrate;
canvas/WebGPU (raw-surface primitive + effects overlay) parked, not rejected.
**Notable: this reopened no locked decision — it reinforces the client-rendered
desktop and first-party/build-from-source locks.** Recorded in
[wiki/decisions.md](wiki/decisions.md) + new page
[wiki/os-layering.md](wiki/os-layering.md); todo promoted to briefs 47
(per-window error boundaries) + 48 (the protocol seam) + 49 (ephemeral per-tab
session + durable server-side dotfiles); todo removed.

## [2026-07-19] research+grill | Web browser (Tier-2 proxy) + containerized dev pipeline

Researched the "add a web navigator" ask (2026 MV3 landscape, service-worker
proxies) and grilled it end-to-end (grill-me). It is **not** a Chrome add-on —
it's a Browser desktop app for ImbatranimOS, which is itself a React desktop in
a tab. Resolved the tree: **Tier 2 proxied-interactive** (real sites, not
reader/headless); engine = **Scramjet** (Mercury Workshop, service-worker +
WASM rewriter + Wisp backend, AGPL-3.0, consumed as **prebuilt dist** — no
Rust); the "without iframes" idea dropped (blocker was `X-Frame-Options`/CSP,
not iframes; the sandboxed iframe is the point). Housing = **OS capability**
(backend Wisp module + core SW registration + `<ProxyView>` via the barrel;
thin add-on) rather than a self-contained add-on. **Egress = auth-gate + SSRF
filter that blocks private ranges — deliberately the OPPOSITE of brief 43's
REST-client stance** (there the owner types every URL; here arbitrary
third-party JS drives the proxy, so an XSS = SSRF cannon). Profile = **OS-level,
synced, encrypted** cookie jar in the home volume/db (follows the container,
not the laptop). v1 = **thin MVP** (URL bar + back/fwd/reload, prove Google +
YouTube; reuse Bookmarks via `openApp`); DRM/Widevine out of scope. → **brief
50**. Mid-grill the user also asked to containerize dev: `npm run dev` →
**`docker compose --profile dev watch`** (sync `apps/**`, ignore node_modules —
kills the stale hand-listed anonymous volumes), plus **de-staling the Dockerfile
`deps`/`proddeps` manifest lists** (same 7-of-24 rot — the real blocker to
"contained"), host tooling reduced to Node/npm via `npm install
--ignore-scripts` (Dev Containers rejected). → **brief 51**. **Notable: reopened
no locked decision** — reinforces auth-everywhere, lightweight, build-from-
source; adds a second (stricter) SSRF stance to record alongside brief 43's.
Both briefs land in `briefs/todo/`; decisions to be recorded in
`wiki/decisions.md` when the work executes (per the brief-43 pattern).

## [2026-07-31] sweep | Improvement research: 3 shipped bugs fixed, briefs 52-86

Asked for research on what more the OS could do and how to improve the existing
apps, one brief per app, plus what it would take to mimic a real OS more.

**Method changed the result.** The OS was run locally — backend + Vite dev
servers against a sandbox home — and driven with a scripted browser walkthrough
that opened all 23 desktop icons, collected console errors, and flagged controls
clipped under the taskbar. Docker image pulls are blocked by this environment's
proxy, so the container itself could not be built or booted; everything
container-specific below was verified from source instead (busybox's own `ps.c`
and `tar.c`, the Dockerfile, the ISO APKBUILD).

**Three bugs that were live in the shipped artifacts, all invisible in
development** — which is exactly why they passed review:

1. **System Monitor's process table was empty in every shipped image.**
   `getProcesses()` ran `ps -eo pid,ruid,pcpu,pmem,rss,comm --no-headers`, which
   is GNU procps syntax. Both artifacts are Alpine/busybox, whose `ps` takes
   short options only, has no `ruid`/`pmem`, and has `pcpu` commented out of its
   column table. The call always threw, the catch swallowed it into `return []`.
   Replaced with a `/proc` walk — no binary needed, and the same interface `ps`
   itself reads. A shared-baseline bug in the first implementation (two
   concurrent pollers collapsing the CPU delta window to 0%) was caught only by
   hitting the live API twice; unit tests passed straight through it.
2. **The Git app was dead in production.** `git` is installed in neither the
   Docker prod stage (which runs no `apk add`) nor the ISO's `depends=`. Both
   fixed, plus a 503 that names the problem — the execa seam runs with
   `reject: false`, so a missing binary was arriving as `exitCode: 1` with an
   empty stderr, i.e. every operation failing with nothing to show the user.
3. **Core's `Tooltip` emitted `<button>` inside `<button>`** at 33 call sites.
   base-ui's Trigger renders its own button unless given `render`. This was the
   source of the 2026-07-19 walkthrough's console errors, which had been
   attributed to the File Manager subtree — the subtree was innocent. Note the
   warning is development-only in React, so a production build looks clean.

4. **Notepad's notes were written outside the volume** — found later the same
   day by chasing a 404 in the browser walkthrough. `NOTES_DIR` is in the env
   schema, set in both Dockerfile stages, and created by `entrypoint.sh`, but
   `files.service.ts` hardcoded `resolve(cwd, 'data/notes')` and never read it.
   In the container that is `/app/data/notes`, the image's writable layer,
   while the volume is `/home/imbatranim`. Every note was destroyed on
   container recreation — which the README actively encourages. The 404 was the
   symptom; the data loss was underneath it. This is the only one of the four
   that lost user data rather than disabling a feature.

Cleared one claim: busybox `tar` **does** support `--no-same-owner` and the
`-czf`/`-tzf` forms, so the archive module is not affected.

Also fixed, both pre-existing on `main`: the repo could not `npm install` with
its own declared `packageManager: npm@11.11.0` (npm 11 blocks install scripts;
esbuild, the eslint resolver and all three native modules were unbuilt), and
`format:check` was red in `pdfcore-engine` (16 files) and the backend.

**Briefs 52-86 — 35, all explicitly ungrilled.** 52-54 cross-cutting platform
(window clamp, desktop icon overlap, a shared Open dialog for the 8 apps that
dead-end), 55-78 one per app covering all 24 registry apps, 79-86 real-OS
parity. New wiki pages: `backlog-2026-07-31.md` (one line per brief +
dependency order), `real-os-gaps.md` (Tier 2 + the standing rejection list with
reasons), `ui-conventions.md` (the house style as 46 rules + a 14-item
pre-flight checklist, derived by reading the kit).

**Notable findings recorded in the briefs**: Settings has no change-password
route at all; Calendar and Clock persist to the viewing browser's
`localStorage` rather than the container; `openWith` maps `.pdf` to the
340-line viewer, hiding the 3886-line norPDF suite, which is itself the largest
undocumented thing in the repo and writes PDFs with no tests; System Monitor's
kill has no confirmation despite being uid-scoped to the process running the
OS; and unmapped double-clicks silently do nothing.

Twelve research subagents were dispatched; two returned (parity research and
the UI conventions), ten died without output or notification, so briefs 52-86
were written directly instead.


## [2026-07-31] build | Implementation wave: briefs 52, 53, 54, 79, 86 + a test runner

Went down the dependency order agreed with the user, building as specified and
choosing the conservative option wherever a brief flagged a contentious call.

- **Core got a test runner.** `apps/core` had none, so all frontend logic was
  unverifiable except by driving a browser. vitest, node environment by default,
  jsdom per-file only where a DOM is genuinely needed. The 11 backfilled tests
  were mutation-tested: reintroducing the original bugs fails 8 of them.
- **52 window clamp** and **53 desktop icon layout** — both reproduced at
  1280×577 before and verified gone after. 53 turned out to have three
  compounding causes, including `settings` consuming a grid cell it never
  renders into.
- **86 shortcut registry** — registration and binding happen in one call, so a
  binding cannot exist undocumented. `?`/F1 overlay, verified not to steal
  keystrokes from the Terminal.
- **79 Trash** — freedesktop spec, `rename` not copy, restore treats the
  recorded original path as untrusted. 20 tests including the adversarial set.
- **54 shared Open dialog** — all eight dead-ending apps wired. The pick latches
  into the store `useOpenIntent` already reads, so each app needed only a button.

Two deviations worth knowing: no Undo button in the Trash toast (`notify()` has
no action support, and adding one is a change to a shared surface that deserves
its own decision), and the Open dialog is a new focused picker rather than a
promotion of Notepad's `FileBrowser`, which on reading is a notes *manager*
rather than a picker.

Gates at the end: typecheck 25/25, lint 26/26, format 26/26, build ok, tests
**262** (168 backend + 70 engine + 24 core) — up from 135 backend-only.

## [2026-07-31] brief 83 + todo housekeeping | Storage, disk-full, and a legible todos/

**Brief 83 shipped.** `GET /api/files/size` (bounded walk, `truncated` flag,
symlinks never followed), `ENOSPC`/`EDQUOT` translated to a human 503 across
every write path, and Settings → Storage with a per-folder breakdown, drill-down
and a once-per-session 90 % warning driven off the Tray's existing poll. A full
volume no longer presents as random unexplained save failures. Backend 168 → 174.

**`corpus/todos/` was 28 files of which only 5 were open work.** The rest were
already `status: promoted` with pointers to their briefs — history the corpus
deliberately keeps ("Kept for history" in `lint-format-debt`), so deleting them
would have destroyed the record. Moved the 23 promoted/resolved ones to
`corpus/todos/promoted/` instead: the top level now shows only genuinely open
work, and nothing is lost. Two were closed by this session's work and carry a
resolution note — `app-walkthrough-bugs` (all three findings fixed) and
`desktop-icon-layout-resolution-bugs` (superseded by brief 53, which found the
cause was worse than described).

Still open at the top level: `code-editor-file-menu` (consumed by brief 61),
`csp-connect-src-ws-wildcard` (SEC-9) and `kiosk-no-sandbox` (SEC-10) — both
human-gated — `desktop-drag-selection`, and `install-apps-from-github`.

corpus lint caught four sibling links into the moved files; repaired.

## [2026-08-02] briefs 87, 88, 89 | The user's four feature asks, three shipped

Four features requested directly: a file-explorer context menu, code-editor file
creation with VS Code features, VLC-grade media transport, and medium Word /
Excel / PowerPoint parity. Briefs 87-90 written; 87, 88 and 89 shipped. 90 is
gated on briefs 62-64 and is the remaining one.

**Brief 87 — File Manager.** Properties (name, where, type, size with the
bounded folder walk, modified, created, permissions) and New File… with any
extension. The find underneath it: the entry context menu was **implemented but
unreachable**. The row's `onContextMenu` did not stop the bubble, so every
right-click on a file reached the wrapper's background handler and reopened the
menu with `entry: null` — the empty-space menu. Rename / Copy / Cut / Delete had
been shipped and could not be clicked. One `e.stopPropagation()`, matching the
`onClick` handler three lines above that already had one.

**Brief 89 — Media Player.** ±5s buttons, a real scrub bar with buffered ranges
and pointer capture, 0.25×-4× speed, VLC's key tiering registered through brief
86. `clampSeek` is unit-tested because `duration` is `NaN` before metadata and
`Infinity` on a stream, and assigning either wedges the element.

**Brief 88 — Code Editor.** File / Edit / View menus, New File (name picks the
Monaco language, same rule as 87), New Folder, Save As with model retargeting,
and the app's last `window.confirm` replaced by the themed dialog. `FilePicker`
gained a `directory` mode and `useFileDialog` a `pickDirectory`, so every app
can ask for a folder now. Manifest default height 680 → 620, which fits a 720px
viewport.

The brief asked whether the **Monaco workers are genuinely active** or silently
falling back to the main thread. **They are active**: `editor.worker.js` and
`ts.worker.js` both spawn, and the TypeScript worker returns a real type error
for `const answer: number = 'not a number'` in a `.ts` tab. Nothing to fix.

Tab restore shipped narrower than the brief asked and the reason is structural:
`PersistedWindow` has no window id, so ids are re-minted on reload and a
per-window record could never be matched to its window. One session record,
claimed by the first editor window, is what is honest.

**The recurring theme across all three.** `react-hooks`' set-state-in-effect and
ref-during-render rules fired five times this session, and every one pointed at
a real defect rather than a style preference — a stale-response race in three
components, a hover value read from a ref during render in the `Timebar`, and in
88 a StrictMode bug where cancel-on-cleanup would have discarded the restored
tabs, because `claimTabSession` answers once and the second mount run no longer
asks. None were suppressed; each was restructured.

Tests **275 → 283** (174 backend + 70 engine + 24 core + 7 media-player + 8
code-editor). Eager bundle 125.71 → 125.77 KB gzip; Monaco stayed lazy.
