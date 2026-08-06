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

## [2026-08-03] brief 62 | Docs could not open a single .docx in any shipped image

Brief 62 was written as "a failed save is silent". It was. Verifying that turned
up something worse.

**`docxNormalize` used fflate's async API, which spawns a worker from a `blob:`
URL — and this OS's own CSP refuses that.** `worker-src` is unset, so it falls
back to `script-src 'self'`, and a blob URL is not `'self'`. fflate 0.4.8 then
throws inside its *own* error handler instead of calling our callback, so the
promise never settled: no rejection, no timeout, no notification, and the window
sat on "Loading document…" forever. Every `.docx`, every shipped image.

Confirmed against the production build served by the real backend with the real
CSP, and reproduced identically on `HEAD` before any of this brief's changes.
It failed in dev too, by a different route (Vite's optimized fflate dep breaks
its inlined worker source) — which is exactly why it had never been diagnosed as
environment-specific. Fixed with fflate's synchronous API: same output, no
worker, no blob URL, and a comment saying not to go back.

That makes six production bugs from this sweep, and the second whose symptom was
"the app looks like it is working". The first five were "green in dev, dead in
the image"; this one was dead in both, which is the harder kind to notice,
because there is nothing to compare against.

**Second find, from the same CSP log:** SuperDoc defaults to
`telemetry: { enabled: true }` and POSTs to `ingest.superdoc.dev` on every
document open. The CSP refused it — that refusal is how it was found — but
relying on CSP to suppress a call the app deliberately makes is the wrong layer.
Now disabled at the source. The desktop's only offsite request is the Google
Fonts stylesheet the CSP already allows.

**Shared error reporting landed in core.** `reportFileFailure` /
`reportFileRefusal` return the inline banner text *and* raise the notification,
so the two cannot drift and neither can be forgotten — brief 86's
`useRegisteredHotkeys` reasoning applied to failures. Briefs 63 and 64 adopt it
rather than each growing their own. A disk-full 503's message (brief 83) is
passed through verbatim instead of being replaced by a generic failure, and "the
backend did not answer" reads differently from "the backend said no".

The dirty-clear condition was already correct and is now a tested pure function,
because "never clear dirty unless the write succeeded" is one accidental
`finally` away from wrong and that mistake loses work silently.

Tests **283 → 317** (174 backend + 70 engine + 36 core + 22 docs + 8
code-editor + 7 media-player): core 24 → 36, docs 0 → 22.

## [2026-08-03] brief 63 | No workbook with a chart would open, and merges were multiplied

Brief 63 asked what the ExcelJS bridge drops on write. Measuring it turned up
three defects that mattered more than the inventory.

**Sheets could not open any `.xlsx` containing a chart.** `xlsx.load` reconciles
drawings against their rels and reads `drawing.anchors`, but ExcelJS only builds
anchors for `<xdr:pic>`; a chart's `<xdr:graphicFrame>` leaves the model empty and
it throws. Verified with both absolute and Excel-style relative rel targets, so
not a writer quirk — charts are one of the most common things in a real workbook
and every one of those files failed.

**Comments broke for anything not written by Excel.** ExcelJS matches
`xl/commentsN.xml` at the package root only; openpyxl writes
`xl/comments/comment1.xml`. Excel's files loaded, a Python pipeline's did not.

**A merged range was multiplied rather than dropped.** ExcelJS reports the
master's value for every cell in a merge, so `A8:D8` came back as four copies of
"merged header" and a save wrote four copies into the file — data it never
contained. Found by looking at a screenshot, not by a test; the test that claimed
to cover merges only checked the anchor cell, so it passed while the bug was in
front of it.

All three fixed in the pass that already had to unzip: strip the parts ExcelJS
cannot be handed (drawings, charts, media, comments), prune the rels and sheet
references that point at them, and read only the master cell of a merge. The
stripped copy exists only as ExcelJS's input — the saved file is built fresh — and
stripping is not hiding, because the open-time warning still names them.

**The fidelity matrix is a test, not a paragraph.** An openpyxl-built fixture
(independent writer, so not our own bug reflected back) carries charts, CF, data
validation, defined names, comments, merges, frozen panes, autofilter,
hyperlinks, currency/percent formats and two sheets. The test asserts both
directions — what survives, and that every feature the scan reports is genuinely
gone after a round-trip — so the warning list cannot drift from the loss list.

The warning is a standing banner, not only a toast: the moment it matters is the
moment the user reaches for Save, which can be an hour after a toast has gone.

**CSV in and out**, no dependency, and `csv → sheets` in `openWith` — it was not
mapped at all, so double-clicking one did nothing. Three coercions are refused on
purpose: a leading zero stays text (`01234` is a postcode; coercing it makes the
save write `1234`), >15 significant digits stays text (a double cannot hold them),
and a field starting with `=` stays a literal rather than becoming a formula.

Also added a 120s request timeout to the bridge. `onerror` catches a worker that
fails loudly, not one that is alive and silent — brief 62's fflate hang is the
standing lesson that an unsettled promise is a spinner forever with nothing to
report.

That is nine production bugs from this sweep. The pattern worth naming: **three of
the last four were found by looking at the running app rather than by reading the
code** — the fflate hang, the chart failure, and the merge smear. Two of them had
passing tests nearby.

Tests **317 → 360** (174 backend + 70 engine + 43 sheets + 36 core + 22 docs + 8
code-editor + 7 media-player).

## [2026-08-03] briefs 91-92 | Every PDF page was blank, and wasm cannot run here at all

Both found while gathering evidence for a study, not from a brief.

**Brief 91 — the PDF Viewer rendered nothing, for every PDF.** pdf.js 6.1 calls
`Map.prototype.getOrInsertComputed` inside `getOptionalContentConfig`, which
`render()` runs for every page. That method shipped in Chrome 142; the browser
under test was Chromium **141**, released weeks earlier and entirely current,
where it is `undefined`. So `render()` threw and the canvas stayed empty — a
595×841 surface with **zero** non-white pixels, in the shipped production build,
with no error shown to the user. Measured by counting pixels rather than looking
at a screenshot, which is how it was distinguished from "still loading".

Fixed with a polyfill in core (and a deliberate copy inside `pdfcore-engine`,
which is standalone by design), installed before pdf.js loads in all three PDF
surfaces. Same canvas now has 17 822 non-white pixels. pdf.js also calls these
methods inside its worker on conditional paths; that gap is recorded in the brief
rather than papered over.

**Brief 92 — the study.** Answer to "can we use wasm": not today, not one byte.
The shipped CSP refuses every WebAssembly entry point —
`new WebAssembly.Module`, `compile`, `instantiate`, `instantiateStreaming` — with
"Refused to compile or instantiate WebAssembly module because 'unsafe-eval' is
not an allowed source of script". It would take adding `'wasm-unsafe-eval'` to
`script-src`, which is a security decision in the same file and class as SEC-9
and therefore human-gated. Not done.

The repo already has a wasm dependency: `pdfjs-dist` ships openjpeg, jbig2, qcms
and quickjs-eval. None are copied into the build output, so they would 404 before
the CSP refused the compile. A plain PDF never asks for them; a scanned PDF with
a JBIG2 image would render that image as nothing.

Workers, measured rather than assumed: xlsx at 50 000 cells costs 240 ms to parse
and 328 ms to serialize, so its worker is vindicated by the numbers. The docx
normalize brief 62 made synchronous is 31 ms for a real file and 76 ms for a
pathological one — a worker there would add a round-trip and a failure mode to
save nothing perceptible. CSV is the one genuine candidate: 95 ms at 1.5 MB is
fine, the same code at 15 MB is a second of frozen desktop, and the xlsx worker
already speaks a request/reply protocol, so it is a message kind rather than new
infrastructure. Archive, hashing and SQLite — the classic wasm candidates — are
already server-side.

The rule that comes out of both: **our own module workers are fine, any library
that builds its own worker from a `blob:` URL is not**, and the CSP is
load-bearing runtime behaviour that is *invisible in dev* because Vite sets no CSP
at all. Three of this sweep's bugs came from that blind spot.

Tests **360 → 369** (core 36 → 45).

## [2026-08-03] brief 64 | Slides is a viewer, and now a good one

**The decision is locked: Slides stays a viewer.** pptx-preview has no editing
model, so "light editing" would mean a second engine and owning write fidelity for
a third Office format — the risk surface briefs 62 and 63 spent their time
containing. Brief 90 inherits the answer.

Shipped: a thumbnail rail, keyboard navigation, presenter mode, zoom, speaker
notes, `notify()` on failure, and PNG export of the current slide.

The thumbnails are **clones of the rendered slides**, scaled with a transform.
Exact by construction, and no second parse — which is the expensive part, since
pptx-preview rebuilds everything from OpenXML on each call. Clones are
`aria-hidden` and `pointer-events: none` so a link inside a slide is unreachable
from the rail. Zoom is a transform for the same reason: re-rendering to change
zoom would re-parse the deck and hand the stale-render interleave a fresh chance.

Two findings worth keeping:

**`notesSlideN.xml` is not numbered to match slides.** Notes parts are allocated
only for slides that have them, so a deck with notes on 1, 2, 4 and 5 produces
`notesSlide1..4` — index by slide number and slide 4 shows slide 5's note. The
parser follows `<p:sldIdLst>` → `presentation.xml.rels` → the slide's own rels,
finding the notesSlide *by relationship type*. The fixture leaves slide 3 without
notes precisely so the wrong-mapping case is under test.

**pptx-preview consumes the buffer.** Parsing notes after the render came back
empty every time, because there was nothing left to unzip. Notes are read first
now.

And a bug of my own, caught in the browser: `requestFullscreen` can be refused,
presenting in-window is a fair fallback, but then no `fullscreenchange` fires and
the user was trapped in a black overlay. Escape is handled independently now, plus
a visible Exit button.

**Also worth naming: two of this session's "failures" were my test, not the app.**
The notes panel appeared broken because my regex was case-sensitive against
CSS-uppercased text, and the merged-cell test passed while the bug was in front of
it because it only checked the anchor cell. Verifying in a browser catches things
tests miss; it also produces its own false signals, and both directions need
checking before anything is reported.

Tests **369 → 384** (slides 0 → 15).

## [2026-08-03] brief 90 | The Office gap was not missing UI — it was the bridge dropping what the UI produced

The brief said Docs "exposes almost no editing surface — no find/replace, no
styles UI, no tables". That was measured against the app's *own* toolbar.
**SuperDoc mounts its own, with 31 controls** — including tables and table
actions, linked styles, lists, alignment, colour, highlight, and accept/reject
tracked changes. Almost the whole Docs list was already shipped; building a second
toolbar would have duplicated it worse.

**The real gap was Sheets, and it was silent data loss reachable from the toolbar
the app already had.** Univer's ribbon sets underline, strikethrough, font family,
font size, alignment, wrap and borders — and the ExcelJS bridge carried none of
them. Univer's `IStyleData` has `ul`, `st`, `ff`, `fs`, `ht`, `vt`, `tb`, `bd`; the
mapping handled `bl`, `it`, `cl`, `bg`, `n`. Underline a heading, set 18pt
Georgia, centre a column, draw a border → save → reopen → gone, with no warning,
because brief 63's open-time scan reports what the *package* holds and not what the
*ribbon* can produce.

All eight now map in both directions, with the awkward parts written down: ExcelJS
reports vertical centre as `middle` (xlsx writes `center`); borders are per-edge
with independent styles, so a double bottom and a dashed left must both survive;
Excel's border vocabulary is wider than Univer's, so `dashDot` and friends map to
their nearest neighbour rather than vanishing; Univer requires a colour on a
border and Excel's default is black; wrap wins over shrink-to-fit because Univer
has one strategy. And no style is invented on a plain cell, which has its own test.

There is a combined-attributes test on purpose: an implementation that assigns
`cell.font` twice, or replaces `cell.alignment` while setting borders, passes every
single-attribute test and loses half a cell that has everything.

**Docs got the two things genuinely absent:** find (`Ctrl+F`, match counter,
wrapping next/previous) and word count. The search text is regex-escaped —
unescaped, `a.b` matches `axb` and a bare `(` throws mid-typing. The count reads
the rendered text, turns block tags into newlines so `end</p><p>Begin` is two
words, and counts code points so an emoji is one character.

**Replace is not built and is recorded as blocked on the engine.** SuperDoc
exposes `search` but no replace command; `replaceAll` in its types is a label for
its own search UI. Doing it anyway means driving ProseMirror transactions against
the docx model and owning mark and tracked-change correctness by hand — the exact
silent-corruption surface briefs 62 and 63 exist to contain.

One self-inflicted bug caught in the browser: the word count read "0 words" over a
19-word document, because it was computed when the engine object was constructed
rather than when the document was loaded — `getHTML()` has nothing to give at that
point. Moved into `onReady`.

**This closes briefs 62, 63, 64 and 90 — the whole Office group — plus 87, 88, 89
from the user's four asks, and 91/92 found while verifying.** Tests **384 → 406** (174 backend + 70 engine + 51 sheets + 45 core + 36 docs + 15 slides + 8 code-editor + 7 media-player).

## [2026-08-03] brief 65 | norPDF owns .pdf, and its Open was reading the wrong computer

Brief 65 was a decision: which of the two PDF apps the OS opens. Measured on the
same 40-page PDF, cold, in the shipped build — PDF Viewer reaches first inked page
in **4.2 s** and costs **5.2 KB gzip** of its own code; norPDF takes **5.3 s** and
202 KB, and pdf.js's 642 KB is shared by both.

**`openWith` now routes `pdf` → `norpdf`, and PDF Viewer is kept.** The default had
to move — while it pointed at the 340-line viewer, norPDF's 3886 lines of outline,
thumbnails, search, annotate, forms, organise and save were reachable only by
launching it from the desktop. But the brief's preferred "retire PDF Viewer" is
what the measurement argues against: it buys 5 KB, because the weight is pdf.js and
that is shared. It is also faster with a fraction of the bytes, and brief 81's
"Open with ▸" is the chooser that makes keeping it worthwhile. Deleting the
alternative before the chooser exists removes the option to gain nothing.

Time-to-first-page was measured by **sampling canvas pixels**, not by waiting for a
canvas element — brief 91 is the standing reason that distinction matters.

**Found while doing it: norPDF's "Open a PDF" was a native `<input type="file">`,
which reads the host machine.** Brief 54 rules that out by name — "the computer is
the container", and a dialog browsing the user's laptop instead of their home
directory is actively wrong here. Now `useFileDialog`, so the pick runs the same
path a File Manager double-click does. Drag-and-drop from the host stays: that is an
explicit, visible gesture, not a dialog impersonating the OS's.

The routing table now has **tests**, which is the actual reason `.pdf` pointed at
the weaker app unnoticed for so long. One of them documents a dead end instead of
fixing it: **`.txt` under `home` resolves to nothing**, because Notepad is not
root-aware and its rule is notes-only. That is brief 59's headline, so it is
asserted as current behaviour with a pointer — brief 59 gets a test to flip rather
than a surprise to find.

**Recorded, not hidden:** norPDF is ~1.2 s slower to first page, because it paints
seven canvases (page + thumbnail rail) and fetches several times the code. The fix
is first-page-before-rail, and it belongs to brief 66, which owns norPDF.

Also split `decisions.md` — adding this decision pushed it past the 200-line cap,
so the ISO-era inheritance moved to `decisions-iso-era.md`. Still binding; only the
location changed.

Tests **406 → 415** (file-manager 0 → 9).

## [2026-08-03] brief 66 | Every save in the OS could truncate the user's file

Brief 66 asked for an atomic save in norPDF so an interrupted write could not
truncate a PDF. Chasing it found the problem one layer down and much wider:
`FilesService.uploadFile` did `fs.copyFile` **straight onto the destination**, and
`copyFile` truncates before writing. Any failure part-way — full disk, OOM kill,
container restart — left the file truncated with the original bytes gone.

**Every save in the OS goes through that method**: Docs, Sheets, Slides, Notepad,
Code Editor, Markdown, images, norPDF. So the fix went in once, at the backend —
stage a sibling temp in the destination's own directory, then `rename` over it. A
rename within one directory is atomic on POSIX; staging *beside* the destination
rather than in the OS temp dir is what makes that hold, because a
cross-filesystem rename is not atomic and degrades to a copy. The previous file's
mode is copied across first, or the rename would quietly widen a `0600` file.

Seven tests, provoking failures with real filesystem conditions rather than
mocking `fs` — its exports are non-configurable in Node 24. Both windows covered:
the source vanishing before the staged copy, and a commit failing *after* it.

**The write path is now proven to preserve, not just to write.** A rich fixture —
three pages with distinct text, full Info metadata, two filled AcroForm fields —
goes through annotate, forms, sign and page reorder/delete/rotate/extract, and each
asserts both that the change landed and that everything else survived: page count
and order, the other pages' text, metadata, the form field the user did not edit,
that annotations stay on their page, that a second save does not duplicate them,
and that saving an untouched document does not damage it. The brief called this its
highest-value item and was right. The engine already had 70 tests proving the
intended change lands; what was missing was the half that costs a user their file.

**Second green-test-proving-nothing of the session.** The first draft called
`doc.text.extract(p)` with a bare page number; `extract` takes `{ pages }`, and a
number is silently accepted as an options object with no `pages` — extracting the
whole document. Every per-page assertion was reading all three pages and passing
for the wrong reason. **Typecheck** caught it, not the test run. The behaviour was
correct anyway, so no expectation changed — but that is now twice.

`corpus/wiki/norpdf.md` finally documents the largest app in the OS: the
app/engine split, the three platform entries and why `UnsupportedPlatform` is
load-bearing, the read-vs-write model separation, the save→`reloadDocument()` cache
contract that until now lived in one comment, and the known gaps.

Also: confirmed the `rounded-*` classes §46 calls dead really are — `index.css`
has `* { border-radius: 0 !important }`, so every one in the tree is inert.
Removed the four it names. `SignatureDialog`'s literal colour is **kept**, with the
reason written down: it previews ink on paper and must match what lands in the PDF,
so a semantic token would show white ink in dark mode for a signature that saves
black. §46 read it as an oversight; it is a decision.

Noted, not fixed (FIXED 2026-08-04 in brief 58): **the backend has no `typecheck` script**, so its `test/`
directory has never been type-checked and carries two pre-existing supertest typing
errors. `src/` is still compiled by `nest build` under `turbo build`.

Tests **415 → 439** (backend 174 → 182, engine 70 → 82).

## 2026-08-04 — brief 67 (Image Viewer): pan, a rotation that survives, and "Fit" fixed in three apps

[Brief 67](briefs/done/67-image-viewer-navigation-and-edit.md) done. Pan, rotate
that persists via a canvas re-encode, and a refusal path with the reason on screen
for formats that cannot take one. 24 unit tests, zero new dependencies.

**The brief's EXIF item was measured wrong and deliberately not built.** It asks
for an orientation parse "applied as the initial transform"; the browser has been
honouring EXIF all along (`imageOrientation: from-image` is the default), so that
would **double-rotate every phone photo**. Two JPEGs with identical pixels, one
tagged `Orientation=6`: the tagged one reports `naturalWidth/Height` as 200×400
where the plain one reports 400×200, and `drawImage` receives the already-rotated
pixels. A canvas re-encode is therefore naturally orientation-safe — it bakes in
what the user sees and writes no EXIF, so the output cannot disagree with itself.
That is the third brief this sweep whose premise did not survive measurement
(after 90 and 66's "no tests").

**"Fit to window" had never fit anything, in three apps.** Image Viewer, PDF
Viewer and Slides had each hand-rolled a `ResizeObserver` in a `useEffect(…, [])`
against a ref that is **null on the first commit** — all three early-return an
"Nothing open" tree until `useOpenIntent` drains the intent in an effect. With `[]`
deps there is no retry, so the measured size stayed at its initial value for the
window's entire life. Image Viewer showed every image at 100%; PDF Viewer's
`containerWidth` stayed `null`, making `fitWidth && containerWidth` falsy, so Fit
width silently fell back to 100% zoom (canvas 595px in a 718px pane, vs 686px
after); Slides' fit target was `{0,0}` so `resolveScale` returned its
degenerate-input fallback of 1 and the slide overflowed the pane. Fixed once as
core's **`useElementSize`** — a ref callback, which binds whenever the node
attaches and has no dependency array to get wrong.

Two more, found the same way:

- **Image Viewer applied its scale twice.** The `<img>` is a flex child, so its
  layout box was already shrunk to the pane before any transform ran and
  `scale(fitScale)` shrank the shrunken box: fit came out a third of the right
  size and "100%" showed 638px of a 2000px photo. Now sized explicitly, transform
  reserved for rotation + pan, pane `overflow-hidden` so panning is the only way
  to move the image.
- **Slides had a second instance of the class**, independent of the pane:
  `slideBox` took one `offsetWidth` reading in an effect keyed on `[slideCount]`,
  which commits while pptx-preview is still laying out. It was **flaky, not
  consistently broken** — the same build measured 0.84 on one run and 1 on the
  next, which is precisely why one reading is not enough. Now observed.

Also: **navigating to a sibling silently discarded an unsaved rotation.**
`useUnsavedGuard` only guards closing a window, so an arrow key reset every
per-image state without a word — the same defect as rotate not persisting, just
harder to notice. It asks first now. And **a Tooltip on a disabled button never
opens**, so the reason Save was greyed out for a `.gif` was unreachable; there is
no dead button any more, the reason is inline.

Deferred with reasons in the brief: thumbnail strip, file actions (want Trash +
the `system` seam), and the large-image guard (no threshold measured). The listing
cache is **not** deferred — the brief's premise was wrong, the app already lists
once per window rather than per step.

Tests **439 → 463** (vitest 277, backend jest unchanged at 182).

## 2026-08-04 — brief 55 (File Manager): sorting, Icons view, Ctrl+H, one dialog dialect

[Brief 55](briefs/done/55-file-manager-explorer-parity.md) done. 28 unit tests, zero
new dependencies.

**Two of its six items were already fixed by later briefs and the brief did not
know.** Properties shipped in brief 87; the Details list already had Size and
Modified columns, so item 2's premise ("no columns to sort by") was wrong — what was
missing was only the sorting. Stated here because acting on a stale brief is how a
second Properties dialog gets built. That is now four briefs this sweep whose
premises did not survive contact with the code (90, 66, 67, 55).

**The real hazard was where sorting happens, not sorting itself.** `sortEntries` was
called twice — in `FileManager` for the virtualizer count and keyboard nav, and again
inside `FileList` for rendering — and `FileList` was in fact being handed the **raw,
unsorted** query array while the virtualizer counted the sorted one. It lined up only
because it re-sorted identically. User-controlled sorting turns that into two chances
to disagree, whose failure mode is arrow keys moving to a different row than the one
highlighted. Now filtered and sorted **once**, in `FileManager`, and passed down;
`FileList` no longer sorts and `fileKind.ts`'s old `sortEntries` is deleted rather
than left as a second way to do it.

Decisions worth keeping: a directory's `size` is an inode size the user cannot see,
so two directories fall back to name; an unparseable `modifiedAt` sorts last rather
than returning `NaN` (which makes the order depend on input order *and* the engine's
sort); name is the tiebreak for every key so equal-size files never swap between
renders; and clicking a *new* column starts at its natural direction (A→Z for names,
biggest/newest first otherwise) instead of inheriting the previous column's.

**A draft I had to correct against Explorer rather than against my tests.** I first
special-cased directories to stay A→Z under a descending sort; two tests caught it.
Explorer reverses them, and folders running A→Z while the files beneath them run Z→A
from the same click reads as a bug — so the tests were corrected to match Explorer
and the reason written down at the comparator.

**Icons view** is virtualized with one virtual item per **row of tiles**. Count, size
estimate and the `scrollMargin` (which must be 0 with no `<thead>`) are all derived
in one place so they cannot disagree. `useListKeyboardNav` gained `columns`: Up/Down
move a row, Left/Right one tile, and Left/Right stay unclaimed in Details.

**One dialog dialect at last** (ui-conventions §44): the bespoke delete `<Dialog>` is
core's `ConfirmDialog`, whose `message` was widened from `string` to `ReactNode` so
the bolded filename survived — forcing plain text would have made the shared
component worse than the bespoke one it replaced. Failures now go through one
`failAction()` that raises the notification *and* sets the banner: the notification
is what gets noticed in a background window, the banner is what stays readable while
the user fixes it.

**A bug I introduced, and the hardening it earned.** Composing the pane's measuring
ref with the existing `listContainerRef` as an inline arrow **blanked the whole
desktop**: React re-runs a fresh-closure ref callback (cleanup then attach) every
render, `useElementSize` wrote state on attach, and that drove the next render —
an infinite loop surfacing only as minified React error #185 on a white screen. Fixed
at the call site with `useCallback` **and** in the hook, which now writes state only
when the box actually changed. That hook is a day old and has four call sites; it
must not be a footgun.

Measured in the production bundle (`uitest/fm55.mjs`, `uitest/fmscroll.mjs`): every
column sorts both ways with `aria-sort` tracking and clearing, Ctrl+H reveals and
hides, the grid renders 25 tiles at 96×92 across 5 wrapped rows in the same order as
the list, ArrowRight moves one tile and ArrowDown a whole row, and Details rows stay
a uniform 25.50px apart with **no cumulative drift** (0.5px over 24 rows). Zero page
errors.

Two lessons about probing a virtualized list, recorded in the scripts: only *mounted*
rows exist in the DOM, so assertions must check the rendered names are a
**subsequence** of the expected order, not equal to it; and `useFileSelection`
documents that a plain click on the sole selected entry *clears* it, so a probe that
clicks an already-selected tile reads a correct app as broken. Both cost a round.

Noted, not fixed: the Details row estimate is `29px` where rows measure `25.50px`.
Harmless (`measureElement` corrects mounted rows; only the scrollbar length is
slightly off) and it predates this brief.

Tests **463 → 478** (vitest 277 → 296, backend jest 182).

## 2026-08-04 — brief 56 (Terminal): reconnect proven against a real process kill

[Brief 56](briefs/done/56-terminal-reconnect-and-affordances.md) done. 25 unit tests,
two new first-party xterm addons (search, web-links).

**The reconnect is a decision table, not a retry loop.** "Retry on close" would have
been wrong: several closes are the user or the server saying *stop*. `closeReason.ts`
classifies first, off the codes in `pty.gateway.ts`/`pty-session.ts` — `pty-exit`
(the user typed `exit`) and `session-revoked` never retry, `shutdown` always does,
`1000` is a normal closure per RFC 6455 and gets a manual button instead.

**The 1006 ambiguity is the part worth remembering.** An unauthorized upgrade is
refused with a raw 401 and `socket.destroy()`, which the browser never surfaces to
script — a refused handshake and a yanked cable both arrive as 1006 with no reason. So
the brief's "must not retry forever against a 401" *cannot* be satisfied by reading
the close code. Covered instead by an `everOpened` flag (never-opened ⇒ refused at the
handshake, the case worth suspecting auth for) plus a bounded budget, after which the
hook asks `/auth/status` and reports the real cause rather than guessing.

**Two premises did not survive measurement — that is four briefs in a row now** (90,
66, 67, 55, and both halves of this one):

- **"No paste… not possible at all"** is wrong on this platform, and my own first
  implementation proved it: Ctrl+Shift+V produces one keydown **and** one native
  `paste` event on xterm's helper textarea, and xterm already writes that to the pty
  — so my handler made every paste arrive **twice** (`echo PASTED_OKecho PASTED_OK`).
  Returning `false` from `attachCustomKeyEventHandler` does not help; the paste event
  is not xterm's key processing. Keyboard paste now belongs to the browser, which
  also works for Cmd+V on macOS and needs no `clipboard-read` permission.
  Middle-click and right-click have no native path, so those keep `readText()` with a
  `notify()` on rejection — the genuinely missing part.
- **Reading the surface token is not enough to theme a terminal.** xterm's default
  ANSI 16 are tuned for dark; on `#f3f3f1` bright yellow/cyan/white are invisible, so
  every `ls --color` would have unreadable words. `xtermTheme.ts` carries a palette
  per mode with tests asserting each entry clears 3:1 on its own surface; on light,
  "bright" means more saturated, and `brightWhite` maps to near-black.

Measured in the production bundle, and the headline is a **real `kill -9` and
restart** rather than a mocked close: the terminal reconnects on its own with the
prior scrollback intact, is usable again, and `stty size` is still `28 86` — SIGWINCH
survives. Killed and left down, it gives up after exactly 5 attempts (1s, 2s, 4s, 8s,
8s), names the cause, keeps the scrollback and offers Reconnect. Theme measured in
**pixels** — `[13,13,14]` → `[230,233,236]`, switched live through the real Settings
UI with the Terminal already open. Computed styles cannot answer that one: xterm's DOM
renderer leaves `.xterm-viewport` at xterm.css's own `#000` whatever the theme says,
which had an earlier probe reporting black in both themes. Four open/close cycles
leave zero xterm nodes behind. No page errors anywhere.

Also: the xterm instance moved from `useState` into a ref built by a **ref callback**,
because xterm's API is mutation (`term.options.theme = …`) and React's immutability
rule refuses mutation of a `useState` value. And the whole socket lifecycle collapsed
into **one effect** with plain local closures — an earlier draft used `useCallback`s
with mirror refs, which needed a self-referencing callback for the retry and got
rejected by the lint rules twice.

`ui-conventions.md` §8/§46 updated: the Terminal's `bg-[#0d0d0e]` violation is gone,
and §46 now records that a light terminal needs its own ANSI palette.

Not done, deliberately: the unicode-width addon for CJK/emoji alignment — a third
dependency for a narrower problem, worth its own decision.

Tests **478 → 503** (vitest 296 → 321, backend jest 182).

## 2026-08-04 — brief 57 (Settings): the OS can rotate its own password

[Brief 57](briefs/done/57-settings-password-and-real-about.md) done. The OS had **no
way to change its password at all** — a password typed once at first-run could only
be replaced by deleting the database and losing the account, which for a system the
README recommends exposing behind a reverse proxy was a real gap.

`POST /auth/password` is authenticated (no `@Public()`), re-proves the **current**
password even though the caller already holds a session (a cookie is a bearer token;
a thief must not be able to lock the owner out), demands a TOTP code when TOTP is on,
enforces the same ≥10 minimum as first-run, and re-hashes with identical argon2id
parameters.

Three orderings inside it are load-bearing, and each has a test:

- **Verify the current password BEFORE validating the new one** — the reverse lets
  someone with a stolen session probe the strength rule, and get a distinguishable
  error, without knowing the current password.
- **Change the password BEFORE dropping sessions** — dropping first would sign the
  user out of every device on a *failed* change, a denial of service anyone with a
  session could trigger at will.
- **A no-op change is refused** — "succeeding" while evicting every other session
  would look like a rotation that rotated nothing.

**Every session dies, including the caller's**, and the caller gets a fresh cookie in
the same response. `destroyAll()` rather than "all but mine": the reason to rotate is
usually that a credential may have leaked, and the caller's current token is as
plausibly leaked as any other. **Throttled on login's own counter**, because the route
re-verifies the current password and is therefore an oracle for it — otherwise a
stolen session could brute-force from inside the OS while the lock screen stayed
protected. Only a failed *credential* check feeds the throttle; a rejected weak or
unchanged password is the user fumbling their form and must not lock them out.
**TOTP is untouched** by a password change, with a test, because silently dropping the
second factor would be the worst possible side effect of a security action.

**About this machine** was three hardcoded strings (`OS: ImbatranimOS`, `Shell: React
desktop on Alpine`, `Status: Developer Preview`) plus a `v0.1 · preview` footer, while
`/api/system/about` had always returned the real hostname, kernel, platform, arch,
uptime and `IMAGE_VERSION` and `package.json` was at 1.0.0. Now five rows from the API,
with the version lifted into `Settings` so the panel and the footer come from one fetch
and cannot drift. The error state says it could not *read* the machine rather than
asserting something false — the old rows could never fail, which is exactly what was
wrong with them.

Under the change form, stated plainly rather than implied: **there is no password
recovery**, and the only way back in is deleting the data volume. The brief rejects a
reset flow and is right — with one local account, any recovery path is a back door.

Verified with **two independent browser contexts** (separate cookie jars, so two
genuinely signed-in browsers): after the change the changing browser is still
authenticated and the other is not; a *failed* change signs nobody out; the old
password then 401s at login and the new one 200s. About renders `hostname=vm`,
`kernel=6.18.5-fc-v18`, `uptime=13m`, `IMAGE VERSION=1.0.0-dev` matching the API field
for field, and the footer reads `v1.0.0-dev`.

Backend **192 unit + 46 e2e** (was 182 + 36). Frontend vitest **321 → 336**.

Still worth a todo: **TOTP recovery codes.** Lose your phone today and you are locked
out with no fallback — the same class of gap this brief just closed for passwords.

## 2026-08-04 — brief 58 (System Monitor): the kill asks first, and the OS knows its own pid

[Brief 58](briefs/done/58-system-monitor-history-and-safety.md) done. All five problems
closed, plus a piece of missing test infrastructure the work itself exposed.

**The kill now confirms**, naming the process and pid, with the outcome through
`notify()` instead of an inline "not permitted" sitting in a virtualized row that
scrolls away. The case worth building: `/api/system/about` now reports `serverPid`, so
the backend's own row is marked `(this OS)` and killing it gets a *different* dialog
saying it will disconnect every app and end the session. **Warned, not forbidden** — a
real OS lets you shoot your own foot, it just should not happen by accident. The kill
was already uid-scoped, but the backend runs as that same uid, so "you are allowed to"
and "you meant to" are different questions and only the client can ask the second.

**Three of the new stats were already being measured and thrown away.** Per-core CPU
came free — `sampleCpus()` computed per-core samples and then summed them, discarding
the detail. Swap comes out of the same `/proc/meminfo` read as memory (reading twice
would be two syscalls and two chances for the halves to disagree about one instant).
Load average and uptime are one call each. Only network is genuinely new.

**Two `/proc/net/dev` traps, both now tested.** Loopback *must* be excluded and that is
the load-bearing one: in this OS the desktop talks to its own backend over `lo` — every
file read, every stats poll, the whole PTY stream — so counting it would report the
machine's internal chatter as network traffic and a box with no network at all would
show megabytes. And there may be **no space after the colon**: once a counter outgrows
its column the kernel prints `eth0:123456789012` flush against it, so tokenising the
line on whitespace reads the byte count as the interface name — only on the busy
machines whose numbers you care about.

**`cpuPercent` is now `number | null`** and renders `—`. The first poll has no baseline,
so nothing is known, and a confident `0.0` for a busy process is a lie that lasts 1.5s.
An existing test asserted `=== 0` on the first poll; that encoded the behaviour being
fixed, so it was changed deliberately with the reason written into it.

**History with no charting dependency**: a 120-sample ring buffer (~3 min at the
existing poll), gone when the window closes — honest, since nothing records while the
app is shut. The scale is **fixed at 0–100, not auto-fitted**, and the tests pin that:
auto-fitting would make a series wobbling between 0.1% and 0.4% fill the box and turn
idle noise into a crisis.

**Found while working: the backend was never type-checked.** `nest build` rejected a
change `turbo run typecheck` had just passed, because the backend had **no `typecheck`
script** — only `build` ever checked `src/`. It also carried two long-standing supertest
typing errors in `test/`, which is presumably why nobody added one. Both fixed:
`binaryParser` takes `unknown` and narrows (superagent declares its parser's first
parameter as its own `Response` type, so a `ReadableStream` parameter was never
assignable, even though the runtime object *is* a readable stream — which is why it
worked), and the script exists. `turbo run typecheck` went 25 → 26 tasks. This closes
the "noted, not fixed" item from the 2026-08-03 brief-66 entry.

Also worth remembering: I filtered away the error I was hunting. `tsc | grep "^src/"`
matches nothing when tsc emits colour, because the line begins with an ANSI escape.

Verified in the shipped bundle by spawning a **real** `sleep 600` in the container: the
confirm names it, **Cancel leaves it alive** (checked with `kill -0` from outside the
browser), confirming really ends it, and the backend row produces the backend-specific
warning. `loadAvg {0.34, 0.62, 0.3}`, 4 per-core cells for 4 cores, real network rates,
and this swapless host reports zeros → "none configured". First poll renders `—`; the
filter narrows to one row by name and by pid; sparklines grow 3 → 8 points. No page
errors.

Tests: backend **208 unit + 46 e2e** (was 192 + 46), frontend vitest **336 → 353**.

## 2026-08-04 — brief 59 (Notepad): one filesystem, and the save spine it was assumed to have

[Brief 59](briefs/done/59-notepad-one-filesystem.md) done. 36 unit tests, one 183-line
private component deleted.

**The brief was wrong about its own biggest item, in a way that inverted the work.** It
lists autosave under "rejected" and puts "the save spine: `useOpenIntent`,
`useSaveHotkey`, `useUnsavedGuard`, the dirty `•` … and the close guard" under *must
preserve* — but **Notepad was the autosaving app**, writing on a 1-second debounce after
every keystroke and using none of those hooks. No dirty marker, no Ctrl+S, no close
prompt. So the brief's non-change was its largest change: converting Notepad *to* the
spine it was believed to already have. That is the fifth brief this sweep whose premise
did not survive contact with the code (90, 66, 67, 55, 56, and now both halves of 59).

Explicit save is the right way round here: there is no version history and no undo
across a reload, so a debounce put a stray keystroke on disk within a second with
nothing to recover from. The reload path is now careful about the case the old code
could not be — when the file changes on disk **and** the user has unsaved edits, the
new content is deliberately *not* adopted, because silently replacing what someone is
typing is the worst available resolution.

**Second half of the root problem, unmentioned by the brief: a `.txt` in your home
directory opened nothing at all.** `openWith.ts` gated Notepad to `onlyRoots:
['notes']`, so `home/notes.txt` resolved to null — no app claimed it and the
double-click was silently swallowed. A test left by brief 65 already recorded this as
"a dead end … brief 59 has a test to flip", and it is flipped.

The migration decision: default to `home`, keep `notes` reachable, and decide **per
install** rather than storing a flag — `notes` while it still holds files, `home`
otherwise. Silently switching would show a returning user an empty home directory and
read as "my notes are gone", which is worse than the inconsistency being fixed. The
store now holds `{ root, path }` instead of a bare path, because a path alone became
ambiguous the moment the app stopped being hardwired: `Documents/todo.txt` exists in
both roots, and a window remembering only the path would read one and save to the other.

Find/replace is pure and tested because each piece has a silent failure in it: an empty
query must not report a match at every position; `aa` in `aaaa` is two matches not
three; and **replace-all scans the original and assembles a new string**, because
replacing in place re-searches text that already contains the replacement, so `a` → `aa`
never terminates. The query is literal, not regex — typing `(` into a find box must not
throw. The size guard refuses >1 MiB and **hands the file to Code Editor** rather than
just saying no, reading the size from the directory listing (downloading a 200 MB log to
discover it is too big to open is the problem the guard exists to avoid).

Measured in the shipped bundle: double-clicking `note59.txt` in home opens Notepad and
the toolbar badge reads `home`; Ln/Col tracks the caret (`Ln 1` → `Ln 3` after two
ArrowDowns); find reports `1 of 8` and a miss says **"No results"** in words rather than
colour alone; the dirty `•` appears and **the file on disk is still unchanged at that
point**, proving autosave is gone; Ctrl+S writes it and the marker clears; a 1 MiB `.log`
is refused with an explanation and Monaco opens it. No page errors.

Probe lesson worth keeping: a **>1 MiB JSON `PUT` to `/files/content` silently 413s**, so
the first version of that test was exercising a file that had never been created. Big
fixtures go through multipart `/files/upload`.

Tests: frontend vitest **353 → 389**, backend unchanged at 208 + 46.

## 2026-08-05 — brief 60, Markdown Editor: an authoring tool, not a preview pane

Toolbar, keymap, scroll sync, draggable split, outline rail, images into the real
filesystem, and lazily-loaded syntax highlighting. Brief moved to
[done/60-markdown-editor-authoring.md](briefs/done/60-markdown-editor-authoring.md).

**The first brief in this run whose problem list was accurate.** Five apps in a row
had briefs that misdescribed their own code; this one's six problems were all real.
What it got wrong was one-directional: it framed images as a missing *input* ("no
image paste"), and the *output* path was broken too — a document that already
contained an image at `docs/shot.png` never showed it, because the src went to the
**web origin** rather than the filesystem. In an OS whose selling point is real files, the
markdown app could not see them. Two neighbours fell out of the same fix: remote
images are refused by the shipped CSP with no explanation (now a labelled chip), and
inline `data:` images rendered as nothing because react-markdown's own sanitizer
strips the scheme (now permitted for image `src` only, `data:text/html` in an `href`
still stripped, both pinned by tests).

Not in the brief at all: **links in the preview navigated the whole desktop away.**
An `<a href>` in there is a live link inside the single-page app hosting the entire
OS, so clicking one in someone's README replaced the desktop, unsaved buffer
included. External links now open in a new tab with `noopener` — this page holds an
authenticated session — `#anchors` scroll the preview's own container (headings
gained `id` slugs, so a document's table of contents works), and relative links are
intercepted.

Scroll sync is anchored on **every** block, not the brief's headings-only proposal: a
checklist or a changelog has no headings and would get no sync at all. The editor
half is the part nobody plans for — a textarea exposes `scrollTop` and nothing else,
and `line * lineHeight` is wrong as soon as a line wraps, which in prose is every
line — so line tops are *measured* with a mirror element, capped at 4000 lines.
Measured on a 2800px document with one full-width image: anchored sync lands the
target heading 0px from the top, proportional would be **140px** out. On pure prose
the two agree, which is precisely how this ships broken.

The toolbar does not go through React state, and that is deliberate: assigning
`textarea.value` — which a state update does — **clears the element's undo history**,
so one Bold click would cost the user every undo step they had. Edits apply as a
selection plus `execCommand('insertText')` over the minimal changed span. Measured:
Ctrl+Z reverses a toolbar edit and keeps going into the typing before it.

Found in the browser and not in review: **Ctrl+K inserted a link and opened the
command palette on top of it**, because the shell binds `mod+K` globally on `window`.
`stopPropagation` at the React root fixes it; the shadowing is now a documented row
in the shortcut registry, with the same "only while X has focus" note File Manager's
`mod+H` carries. Headings are on `mod+shift+1..3` because `Ctrl+1..9` is a reserved
browser accelerator a page cannot cancel, and shifted digits match on `event.code`
since `Ctrl+Shift+8` arrives as `key: '*'`.

Highlighting adopted with the numbers the brief asked for: the lazy chunk is
**53.68 kB gzipped** (167.79 kB raw) plus 0.32 kB of CSS, loaded only when a document
turns out to contain a fence, and the loader costs 0.26 kB in the editor's own chunk.
Dropping eight of sixteen grammars saved **0.19 kB** — the engine is the entire cost,
so a shorter list buys nothing and extending it later is nearly free; lowlight's
`common` (37 grammars) would not be. The theme is hand-written against the OS tokens
rather than an imported highlight.js stylesheet, which hardcodes a palette that looks
wrong in half the desktop's themes and contradicts the locked B&W + accent identity:
comments recede, declarations are bold, literals take the accent.

Two more, unasked: **task checkboxes are clickable** (remark-gfm renders them
`disabled`, which is right for a static preview and useless in an editor), and
`md-preview` — a class with no CSS anywhere in the repo — is now load-bearing for
the anchor lookup and the highlight scope.

An environment note worth keeping: installing a dependency with the **default node22**
rebuilt `better-sqlite3` against the wrong ABI, and 37 backend tests started failing
with "Module did not self-register" — nothing to do with the code. `PATH=/opt/node24/bin
npm rebuild better-sqlite3` restores it. Use node24's npm for installs in this repo.

Tests: frontend vitest **389 → 492** (103 new in a package that had none), backend
unchanged at 208 unit + 46 e2e, `turbo typecheck lint test format:check build` green
across 94 tasks. New dependency: `rehype-highlight` (pulling lowlight + highlight.js),
justified by the measurement above.

## 2026-08-05 — brief 68, Media Player: remember the queue, name the codec, keep the volume

Persistence (volume, mute, rate, repeat, shuffle, per-file resume), shuffle and repeat on a
derived order, durations in the queue, sidecar subtitles, and the deferred keys from brief
89. Brief moved to
[done/68-media-player-playlist-and-codecs.md](briefs/done/68-media-player-playlist-and-codecs.md).

Six of its seven problems were real. The seventh — "an unplayable codec is a black box" —
was **half-fixed already** by the work around brief 89, which the brief predates: the error
mapping, the overlay and the "Download instead" button existed. What was missing was
naming the file (the queue auto-advances, so the message was about an unidentified one of
twelve tracks), a container hint, a `notify()` for when the window is behind others, and a
test. Deliberately still not done: skipping a failed track and carrying on, which VLC does
and which here would make the diagnosis invisible again.

Two bugs the brief did not know about. **The Open dialog offered formats the app rejects** —
its extension list had drifted from `mediaKind`, offering `avi`/`weba` (pick one and you got
"Unsupported file type", a dead end reached through the app's own dialog) and omitting
`oga`/`ogv`; it is now derived from the same constants. And the icon-only transport buttons —
Prev, Next, Play/Pause, Mute — carried a `<Tooltip>` and **no accessible name**, which a
tooltip is not. Found because the probe could not address them.

Subtitles have no `<track>` element, for two measured reasons: `/files/download` serves
`application/octet-stream` and a text track is only parsed as `text/vtt`, and the usual
`blob:` workaround is refused by the shipped CSP — there is no `media-src`, so `<track>`
falls back to `default-src 'self'`. Cues are therefore parsed in-app (one parser for WebVTT
and SubRip) and pushed in with `addTextTrack` + `VTTCue`: no new route, no dependency, and
**no CSP relaxation**, which matters because widening the policy is human-gated here.
Whether a cue is actually painted is not queryable — `activeCues` stays populated when a
track is `hidden` — so it was measured by screenshotting the video frame with subtitles on
and off and comparing bytes.

Three design errors the browser caught, all mine:

- **Shuffle pinned the playing track first** so switching it on would not "jump away". That
  re-derives the order on every track change, so Next re-permutes the queue: a three-track
  folder played **b, c, b**. The pin is gone; the order depends only on paths + seed, and a
  full cycle provably returns to its start.
- **Repeat-one did nothing.** Re-selecting the path already playing changes no state, so
  nothing remounted and the track just stopped. The element replays itself now.
- **Repeat-one disabled Next** on the last track. A repeat mode that disables navigation is
  a bug; manual moves wrap, only `ended` replays.

Resume remembers nothing under 60s and treats the last 15s as finished, so short clips
accumulate no state and the credits are never offered as a resume point; writes are
throttled to one per 5s (a `timeupdate` fires ~4×/second) and the map is capped at 200 with
the least-recently-written dropped. Durations come from a detached element with
`preload="metadata"` — sequential, capped at 60 tracks, cached per session, because this is
the one feature here that can otherwise fire dozens of requests nobody asked for.

Prefs are hand-rolled localStorage (still zero non-core dependencies in this add-on). The
brief wants them on brief 49's durable dotfiles and it is right, but **`CONFIGS_DIR` is
declared in the backend env schema and used by no module** — there is nowhere durable to put
them yet. One function to move when 49 lands.

Probe technique worth keeping: all the media was generated **in the page** — WAV bytes
written by hand (a 150-second file for the resume test) and a canvas recorded with
`MediaRecorder` for real vp8 video — then uploaded through the API. Real decodable files the
backend range-streams, with no binary fixtures in the repo.

Tests: frontend vitest **492 → 550** (58 new here, which had 7), backend unchanged at 208 +
46. All 94 turbo tasks green.

## 2026-08-05 — brief 69, Snipping Tool: say what it can capture, and destroy what it redacts

A launcher instead of an ambush, delay capture, an opaque redaction beside the pixelate one,
per-region detection of what a DOM raster cannot see, and reopening a saved capture. Brief
moved to [done/69-snipping-tool-honest-capture.md](briefs/done/69-snipping-tool-honest-capture.md).

**The question the brief asked to have answered — is the Terminal actually captured? — is
yes.** Measured against ground truth rather than asserted: the browser's own screenshot of a
rectangle over a text-filled Terminal, versus the tool's capture of the same rectangle. The
per-row ink profiles correlate **0.986 at a 0px offset**, with total ink 31% vs 39%; that gap
is subpixel versus grayscale antialiasing, not missing glyphs, and the stacked pair reads
identically by eye. It is contingent, as the brief suspected: xterm runs its DOM renderer
here (measured: zero canvases inside `.xterm`) and `@xterm/addon-webgl` would silently
invert the answer — which is why the new detection looks at what is in the region rather than
at a list of apps.

Two probe bugs produced a confident wrong answer before that number: opening a Terminal
window does not focus xterm's textarea (so the first comparison was of two empty prompts),
and taking the ground-truth screenshot *after* launching the tool put the tool's own window
inside the rectangle (so the two images were of different desktops, and correlation fell to
0.5). Both are the same lesson: when a measurement disagrees with the picture, suspect the
measurement.

**Item 3 was wrong.** "Five annotation tools exist, but not the one with a real purpose" —
the fifth *was* the redaction tool, pixelate, sampling from the pristine base image. But the
brief's reasoning survives its own error: it argues for opacity because a blur can be
reversed, and so can a mosaic — recovering pixelated text is a solved exercise, and the old
`8×ratio` blocks were squarely in range. So **Black out** (flat, opaque, fixed colour, first
in the toolbar) now sits beside a much coarser pixelate, and the labels say which is which.

**`getDisplayMedia` is rejected**, which the brief flagged as its one contested call. It
captures the host browser surface — chrome, other tabs, whatever the user picks in the
browser's own picker — and the illusion this project rests on is that the tab *is* the
display; it also needs a permission prompt per capture, which is the same ambush the
launcher exists to remove. The gap it would close is now *visible* instead: the region is
scanned for canvas, video and cross-origin images, and the capture carries a dismissible
banner naming what may be missing. Deliberately "may not" — whether an element survives
depends on the browser and on how it draws itself.

The hijack is fixed (the app opens to Region / Whole desktop / after 3s / after 5s / Open a
saved capture, and arms only on a choice), and Escape now returns to that launcher instead of
closing the app. Half of the brief's complaint there was already false: the overlay has
always carried a "Drag to select a region · Enter for the whole desktop · Esc to cancel"
hint. Delay capture's countdown badge is `pointer-events: none` — load-bearing, since the
whole purpose is photographing things that vanish when clicked — proven three ways, including
opening a real menu mid-countdown.

The `calc(100vh - 140px)` line was real but not for §16's reason: this stage is a full-screen
portal, so `100vh` genuinely is its height. The bug is the hardcoded 140px of chrome under a
**wrapping** toolbar. Now flex-sized; measured at 1280×577 the canvas sits 13px inside its
stage instead of overflowing.

The redaction check is the brief's verify-bar item, done as a browser measurement rather than
a unit test: the saved PNG is fetched back off the filesystem, decoded, and the pixel inside
the redacted rect read out — `[11,11,13]` where it was `[236,236,233]`. A unit test could
only have checked a canvas mock; this checks the file.

Tests: frontend vitest **550 → 568** (18 new in a package that had none), backend unchanged.
All 95 turbo tasks green, no dependency added.

## 2026-08-05 — brief 70, Calculator: every key reachable, then worth reaching

Scientific mode on the existing evaluator, memory keys and a tape, a measured `minSize`, and
full precision through a chained calculation. Brief moved to
[done/70-calculator-reach-and-depth.md](briefs/done/70-calculator-reach-and-depth.md).

**Item 4 was already done, and was hiding a worse bug.** The brief says `0.1 + 0.2` renders as
`0.30000000000000004`; `formatResult` had been rounding to 12 significant digits all along, so
it read `0.3` before this brief started. But the brief's *reasoning* — "keep full precision
internally" — pointed at a real defect nobody had spotted: only the rounded **string** was
kept, and the next operation re-parsed it, so `1÷3` then `×3` gave `0.999999999999`. A number
token now carries an optional `exact` value beside its display text: the expression shows
`0.333333333333×3` and evaluates to exactly `1`. The display says when it is rounded and a
copy button hands over `0.30000000000000004`.

**The layout diagnosis in the brief is backwards.** It blames the keypad for losing the flex
fight, but `flex-1` on the display already meant the display shrinks first and `flex-none` kept
the keypad at its natural height. What was missing is a floor for the display and, mainly, an
**honest `minSize`** — the manifest's 280×420 predates Programmer mode and was never measured.
Scientific is the tallest mode: 276px keypad + 27px memory row + 36px display floor + ~29px
tabs + ~32px chrome = 400px before the display shows anything, so `minSize` is now 300×430.
Verified by measuring every key's rect against where the taskbar starts, at 1400×900, at
1280×577, and at exactly 300×430.

One measurement to pass on: a window **opened** at 1280×577 is fine; a window opened tall and
then squeezed by shrinking the desktop puts its keypad ~200px below the taskbar. That is brief
52's own recorded follow-up (reflow-on-resize, and `restoreLayout` not re-clamping), left alone
deliberately — it belongs to the window manager, not to this app.

Scientific mode extends the **same** tokenizer rather than forking one, so Basic is unchanged
by construction (its expressions are a strict subset) and the two tabs cannot drift. Three
details the tests forced out: `^` must be right-associative (`2^3^2` is 512, and the loop that
was there would have said 64); factorial cannot be folded into the number as it is read,
because at the closing paren of `(2+2)!` the value does not exist yet — it is a postfix token
emitted straight to RPN; and function names must be matched before constants, or the `e` in
`exp` is read as Euler's number. Domain errors explain themselves (`sqrt(-1)` → "sqrt needs a
value that is not negative") instead of returning NaN, and `=` closes parentheses the user left
open. **No `eval`, no `new Function`** — grepped as well as read.

Memory and tape are session-scoped and live at the `Calculator` level so they survive a Basic ⇄
Scientific switch. **Programmer mode takes neither**: BigInt at a fixed 64-bit width, where a
double from the register would be right in one tab and wrong in another.

Probe lesson: the Programmer check reported "base conversion is broken" and it was not —
**Programmer mode opens in HEX**, so typing `255` and pressing HEX changes nothing. Diagnosed by
writing a unit test for `setBase`. That mode now has 9 tests of its own (all four bases and
back, AND/OR/XOR, shifts, `NOT 0` = `18446744073709551615`, division by zero), because it is on
the must-preserve list and had none.

Tests: frontend vitest **568 → 647** — 79 new in a package that had **zero**, which is worth
naming: 1123 lines of arithmetic engine had shipped untested.

## 2026-08-05 — Brief 71: Clock, the countdown off-by-one and the storage decision for two apps

[Brief 71](briefs/done/71-clock-timer-off-by-one-and-scheduling.md) done. The first
brief in this run whose problem list was **accurate in every item**: the `Math.round`
was exactly where it said, the disclosure it told me not to touch was already there
and already right, and the storage complaint was correct for the reason it gave. The
work was to do it, not to correct it.

`Math.round` → `Math.ceil` in `formatClockDuration`, with the comment the brief asked
for on **both** formatters explaining why they differ — a countdown answers "how long
until it fires?" so any non-zero remainder reads at least `00:01`; a stopwatch answers
"how much has passed?" so unelapsed time must not be shown. Sampled from inside the
page on a 6-second timer: `00:06` for 1036ms, then 983 / 1018 / 993 / 992 / 1013ms,
and `00:00` first at 6036ms — the instant it fires, not 400ms early.

The brief's verify bar asks to watch a **5-second** timer, which the app could not
express: presets are whole minutes and the custom box parsed minutes, so `1:00` was
the floor. `parseDurationInput` now keeps a bare number meaning minutes (what the box
always meant) and reads a colon form as clock parts — `0:30`, `1:30`, `1:02:03`.

**Found by the probe, in no brief:** pressing Start on that 6-second timer flashed
`00:08` for 263ms. `useNow` freezes while inactive, so the first render after `active`
flipped true used a `now` from before the click and `endAt - staleNow` exceeded the
duration. Fixed twice: a zero-delay catch-up tick beside the interval, and
`remainingMs` clamped to `durationMs` — a countdown can never have more time left than
its own length, which is worth asserting in code whoever calls it.

**The storage decision, landed once for Clock and Calendar (brief 72): there is no new
mechanism.** A typed table per domain plus a NestJS module, exactly as `todos`,
`sticky_notes` and `bookmarks` already do. A generic key-value blob store was
considered and rejected — it would accept a malformed alarm time silently, where DTOs
reject `7:00`, `25:00` and `MTWTF..` at the door. Brief 72 should copy this shape
rather than invent a second one. Two deliberate choices inside it: rows map to
**camelCase at the service boundary** (the older modules leak `pos_x` and `created_at`
into React props; new surface starts clean, old ones keep their shape because changing
them is a client-visible break for no user gain), and **`lastFiredAt` is opaque to the
server** — a "07:00" alarm is due by the *viewer's* wall clock, so a server clock
deciding it would be a second, disagreeing source of truth.

The migration is a `POST /clock/import` that refuses a non-empty table, in a
transaction, so two tabs opening at once cannot double every alarm. Imported alarms
get the **every-day** mask because that is what they did before repeat existed;
importing them as one-shots would quietly change what the user had. Unreadable
entries are counted and reported rather than dropped. Verified by seeding the exact
zustand blob the old app wrote: both alarms and the world clock adopted, the legacy
key removed, two notifications raised, and everything still there after a reload with
no clock `localStorage` at all.

**Snooze has to live in the window**, because `notify()` raises a toast and there is
no notification-action API — a Snooze reachable only from the notification centre is
one the user cannot press. A ringing alarm banners above the tab strip, visible from
every tab. Snoozing patches `enabled: true` as well as `snoozedUntil`: a one-shot
alarm has just disabled itself, and without the re-arm the snooze silently never
arrives. A pending snooze also suppresses the scheduled time, or snoozing at 07:00:10
rings again at 07:00:11 while the clock still reads 07:00. Waited for a real minute
boundary to check all of it, including the one-shot disabling itself with
`lastFiredAt` set and the row reading "Snoozed — rings again at 17:29".

Multiple timers without reintroducing drift: the transitions moved into `timerModel`
as pure functions taking `now`, one shared interval for the tab, nothing counting
ticks. Against a genuinely backgrounded tab (a second page brought to the front, so
Chromium really throttles) the display read `03:49` after 72s away where the wall
clock said `03:49`.

Two UI facts worth carrying: **core's `Input` forwards `className` to the `<input>`**
and leaves its own wrapper div intrinsically sized, so sizing the component does
nothing to its footprint — the width must go on a wrapper you own; and **the spacing
scale is rem against a 13px root**, so `w-36` is 117px, not 144, which is why the
original `w-28` (91px) clipped the time field to `:24 PM` in a 12-hour locale.

The core scheduler stays unbuilt, as the brief directs — a closed app has no code
running and the honest fix is OS-level, so no half-scheduler went into Clock. The
existing disclosure stays, extended by one sentence now that the alarms genuinely are
in the container.

Tests: frontend vitest **647 → 701** (54 new in a package that had **zero**), backend
e2e **46 → 59**, unit unchanged at 208. All 97 turbo tasks green. Zero new
dependencies.

## 2026-08-05 — Brief 72: Calendar, the storage mechanism reused and recurrence that stays a rule

[Brief 72](briefs/done/72-calendar-storage-and-recurrence.md) done. The storage
complaint and the recurrence gap were exactly right; two smaller items were not — one
was **already implemented**, and another had been **fixed by a different brief** since
this one was written.

**Storage reuses brief 71's shape on purpose.** A `calendar_events` table, camelCase at
the service boundary, class-validator DTOs, global `SessionAuthGuard` (the e2e asserts
401 on all five routes). Fifth app to persist here, nothing invented: the DTOs reject
`FREQ=HOURLY`, `interval: 0`, a `2026-7-6` exception date and an off-palette colour at
the door, which is the whole argument against the generic blob store that brief 71
already rejected. `POST /calendar/import` serves both the one-time `localStorage`
hand-over and ICS import, differing only by an `onlyIfEmpty` flag.

**`reminderFired` is deliberately not migrated.** It was a persisted boolean per event
and that model cannot survive recurrence — the first ring would silence every later
occurrence of the series forever. The guard is now `eventId:YYYY-MM-DD` in a
session-scoped Set; `FIRE_WINDOW_MS` already prevents replaying old triggers, so
persistence would only add silence for a reminder that is still due.

**Recurrence stays a rule.** No library, `dayjs` remains the only date dependency, and
instances are never materialised — a weekly standup is one row and the views ask for the
occurrences in the window they paint. Two behaviours that look identical and are not,
both now pinned: a month too short to hold the date (Feb for a "31st" rule) generates
nothing and therefore **consumes no `count`**, while an instance removed by an
**exception does** consume its index and its count. My first test asserted the opposite
of the former; the implementation was right and the test was wrong. Jan 31 also does not
slide to Feb 28 — sliding invents an occurrence on a date the user never picked.

**The three edit scopes are pure plans** (`seriesEdit.ts` returns patch/create/delete
rather than mutating), which is what made the subtle case obvious: "all events" must
apply the change as a **delta**, so editing the third Monday to 10:00 moves the series to
10:00 *on its own original date*. Setting the series start to the edited occurrence is
the obvious implementation and it silently deletes every earlier occurrence. "This
event" detaches (exception + standalone event, no override table). "This and following"
splits, dividing a `count` — 10 split at the third leaves head-ends-on-a-date and
tail=8, still ten in total — and collapses to "all" at the first occurrence, because
truncating a series to end before its own start leaves an empty series behind. A test
expands both halves and asserts they cover the original dates exactly once each.

**ICS refuses to pretend.** All-day `DTEND` is written exclusive as the spec requires
(the classic off-by-one), times are floating local with no `TZID`, and an RRULE outside
the subset — `FREQ=MONTHLY;BYDAY=-1FR` — imports as a single event and increments a
counter rather than becoming "monthly on the 26th", which would be wrong every month
with no way to notice. Round-tripped through the real filesystem via the OS save/open
dialogs.

**Two brief items that were not what the brief said.** "No all-day events" is wrong —
`allDay` was in the type, the dialog and both views since Wave C. The real gap was
multi-day **rendering**: both views filtered on `isSame(event.start, day)`, so a
three-day trip was visible on its first day and invisible on the other two (measured: 1
cell, now 4). And "the bottom row clips at 1280×577" was **already fixed by brief 52's
window clamp** — measured at that viewport, the window is clamped to 533px and the last
row's bottom is 513 against a taskbar top of 533. The `minSize` was still dishonest
though, for a different reason: the grid compresses rather than overflows, so the
question is not "does it fit" but "does it still say anything", and at 480×380 a week row
is **25px** — the date number and nothing else, six times over. Below 520px wide the
toolbar also wraps and eats 31px of grid. Now 520×400, where a row is 46px.

**Found while probing, in no brief.** A midnight-crossing timed event was drawn as an
all-day banner, turning a 22:00→02:00 night shift into a two-day bar with no times; the
banner is now all-day only and timed events clip per day (measured as two blocks,
`top:1056 h:96` and `top:0 h:96`). And unticking "All day" on a month-cell creation left
a midnight-to-midnight 24-hour block — it now snaps to 09:00–10:00, unless the event
spans more than one day.

Also delivered: an **Agenda view** (the more useful reading of "day or agenda" — a day
view is a week view with one column) which is the only place **search** is meaningful,
and a six-colour palette shared by all three views through one module so an event cannot
be amber in one and blue in another.

Tests: frontend vitest **701 → 782** (81 new in a package that had **zero**), backend
e2e **59 → 80**, unit unchanged at 208. All 98 turbo tasks green. Zero new dependencies.

## 2026-08-05 — Brief 73: Todo, and an ordering bug hiding under a wrong problem statement

[Brief 73](briefs/done/73-todo-dates-and-structure.md) done. Due dates, priority, one
level of lists, bulk actions and keyboard-first adding all landed as specified. Two of
the six problems were **not what the brief said**, and the one it got half wrong was
sitting on a real bug it had not noticed.

**"No ordering" is half wrong.** Manual drag-to-reorder has been there all along and
works end to end — a `useDrag` handle, `PATCH /todos/reorder`, a transaction writing
`position`, `ORDER BY position ASC`. What was missing is the **priority flag** and
**sort options**. But the brief's instinct that ordering was unreliable was right for a
reason it did not give: `reorder(ids)` wrote positions **1..N onto whatever ids it was
handed**, and the client hands over the *visible* rows. Reordering on the Active tab
therefore stamped 1..N over the completed rows' positions, two todos ended up sharing
position 3, and `ORDER BY position` was free to pick either. It looked correct because
the list being renumbered was exactly the list on screen. `reorder` now treats the ids
as a **relative** reordering of a subset — normalise to 1..N, find the slots those ids
occupy, place them into those slots in their new order — so rows the client cannot see
keep their exact places. Measured with `b`/`d` completed: Active `[a,c]` swapped gives
`c@1 b@2 a@3 d@4`, positions still unique, surviving a reload.

**The `position` column shipped with `DEFAULT 0`**, so every row predating it tied at
zero and the reorder above wrote over ties. The migration normalises to 1..N by
`(position, id)` and runs only when there is something to fix. `DbService.migrate()`
became public to test that: a `:memory:` database is per *connection*, so re-running
`onModuleInit` silently hands back an empty one, whereas `migrate()` is idempotent by
construction and can just be called again.

**Item 5's clipped input measures fine, and I did not prove why.** At 1280×577 with a
26-row list the add input sits 66px *above* the taskbar. I tried to isolate whether
this brief's `min-h-0` is what fixed it by stripping the class live, the strip hit a
nested element inside core's `ScrollArea` (which has its own `overflow-hidden`, so its
min-content was already zero), and **that experiment proved nothing** — so no cause is
claimed. Most likely brief 52's clamp, same as Calendar's equivalent item. The
`minSize` did need changing for a different reason: two new header rows mean 130px of
measured chrome, which left the old 280×300 with 138px of list, under four rows. Now
300×340.

**Due dates store the deadline instant, not the day.** A date-only due date is
`23:59:59.999` of that day, so `isOverdue` is a plain `dueAt < now` — correct across a
day boundary by construction, with no special case in any caller. The alternative
(store midnight and remember to treat it as end-of-day) pushes that reasoning into
every call site, which is where off-by-a-day bugs live: a todo due "today" would read
as late from 00:01. The cost lands on *display* instead — a `23:59:59.999` value is
shown as a bare date, so someone deliberately picking 23:59 gets a label off by a
minute. Cheaper than being off by a day in the comparison, and taken deliberately.
Overdue uses `error` tokens only; due-today gets a plain emphasis and the two states
are exclusive.

**Manual order does not float priority.** Priority leads the `due` and `created`
comparators and is purely a marker in `manual`, because a list that reorders itself
after you drag it is not a list you can arrange. Dragging is disabled outside manual
order for the same reason, and the toolbar says so instead of leaving a dead handle.

The module also moved to **camelCase at the service boundary** with `completed` as a
real boolean — it arrived as `0 | 1` and the frontend type read
`completed: boolean | number`, which is a type admitting it had a problem. Brief 71
deliberately left older modules alone, but this brief rewrites both sides in one
commit and Todo is the only consumer, so the exception is bounded.

**Found while probing, in no brief:** "Clear completed" was a **dead button on the
Active tab** — its count came from the loaded list, which by definition has no
completed todos, so it was disabled exactly where a user would reach for it. It now
asks without a number and reports what the server deleted. Write failures also
notified nowhere: a rejected PATCH rolled back and the row silently sprang into its
old state. And a query-key collision caught while writing it — lists under
`['todos','lists']` would be swept up by `peekTodos`'s `['todos']` prefix and
flattened into its `Todo[]`.

**Handed to brief 75 (Bookmarks):** `PRAGMA foreign_keys` is never enabled on this
connection, so `bookmark_links … ON DELETE CASCADE` is decorative, and
`removeGroup` deletes the group without its links — deleting a bookmark group
**orphans every link in it**. Not fixed here; enabling the pragma globally would change
behaviour for a module this brief has no business touching. Todo's own list deletion
therefore unfiles its todos and deletes the list in one transaction rather than
trusting an FK — which is the right behaviour anyway.

Tests: frontend vitest **782 → 811** (29 new in a package that had **zero**), backend
e2e **80 → 101** (21 new), unit unchanged at 208. All 99 turbo tasks green. Zero new
dependencies.

## 2026-08-05 — Brief 74: Sticky Notes are sticky, and on-style

Two halves, and the first one mattered for the whole repo:
`wiki/ui-conventions.md` §45 named this file as "NOT a template", and it was still
the app a newcomer would copy. Rows were `<div onClick>` (unreachable from a
keyboard), delete was a raw `<button>`, scrolling was a raw `overflow-y-auto`, and
`console.error` was the only signal a write had failed — three briefs after
`notify()` shipped. All four are fixed, and the row controls are now **siblings** of
the row button rather than nested inside it, which also avoids the
`<button>`-in-`<button>` trap (§42). That was the better answer to the brief's
suspicion that clicking delete also opened the note: it did **not**
(`stopPropagation` was already there), and with siblings there is nothing to
propagate. This was also the last console-only failure path in any add-on.

The second half gave core a new seam. `desktopLayer` went onto **`AppConfig`**, not
`AddonManifest` — the shell reads `AppConfig[]` from `useEnabledApps()`, so the
manifest type typechecks in the add-on and fails in core. Core still imports no
add-on package; it knows only "some app contributed a layer", exactly as it knows
only "some app contributed a command source". The layer sits **above** the icon grid
(which spans the whole desktop and would otherwise intercept every click aimed at a
note) and **below** every window, inside one `pointer-events-none` wrapper that each
interactive element opts back out of. `ui-conventions.md` §47–48 now carry that
contract, and §45 was rewritten from a defect list into a fix record.

**The colour decision the brief asked to be grilled: it was already settled one brief
earlier.** Brief 72 gave Calendar a six-name palette applied as a tinted border plus
a low-alpha fill, on exactly the reasoning this brief re-raises — enough hue to tell
two things apart, not enough to read as a saturated block. So this reuses that
palette and treatment rather than inventing a second scheme. Rejected: saturated
sticky yellow (off-identity), and the brief's own suggestion of surface-container
steps alone (on-identity but five near-identical greys, which defeats the only
organisational affordance a note colour has). The map is duplicated deliberately —
the rule promotes a shared helper to core on the *third* copy, and this is the
second.

`pos_x`/`pos_y` were **reused** as the desktop position rather than replaced, so the
migration moves no data, and existing notes default to list-only: putting a note on
the desktop is a user action, never a migration's decision. Drag and resize persist
**once on release** via `setPointerCapture` in about twenty lines rather than a new
dependency, and the clamp is a pure tested module because it is the one thing here
that can lose data — a note dropped past the edge is unreachable after a reload.

**Found while probing, in no brief:** the layer mounts the notes query at **page
load** instead of when the window opens, so the cache now lives for the whole
session and a stale cache is reachable for the first time (a second tab, or brief
80's restore). Verified it degrades correctly: a delete on a vanished id 404s, the
user is told, and the list converges to the server's truth instead of showing a
phantom row. It also invalidated an assumption in my own probes, which seeded via
raw `fetch` and then drove the UI — safe when the window mounted the query
afterwards, wrong now. The probes reload after seeding and say why.

Tests: frontend vitest **811 → 828** (17 new in a package that had zero), backend
e2e **101 → 115** (14 new), unit unchanged at 208. All **100** turbo tasks green —
the 100th is this package's new `test` task. Zero new dependencies.

## 2026-08-05 — Brief 75: Bookmarks becomes a model, and three bugs surface

The brief existed because brief 50 (web browser) plans to **reuse this app** as the
OS's bookmark store rather than build its own, which turns a flat one-level model into
a load-bearing limitation. So: nested folders via `parentId` with a cycle guard,
`href` → `url` renamed all the way to the SQLite column, Netscape-HTML import/export,
search that keeps the path to a match, and duplicate detection on a normalised URL.
The contract brief 50 will consume is written into this app's `index.ts` — the field is
`url`, only `http(s)` can be stored, the tree is flat + `parentId` with reusable
helpers — so it is settled once instead of translated at that seam forever.

**The bug brief 73 handed over is fixed.** `deleteGroup` relied on
`ON DELETE CASCADE`, and even carried a comment saying SQLite handled it — but
`PRAGMA foreign_keys` is never enabled on this connection, so the constraint was
decorative and every folder deletion silently orphaned its links, invisibly and
forever. Now an explicit subtree delete in one transaction, plus a migrate-time sweep
for what the shipped bug already produced: orphaned links are **deleted** (the user
confirmed "delete the group and all its links", so undoing that would be the wrong
repair) while a folder whose parent is gone is **promoted to the root**, because
nobody ever confirmed losing that. The pragma stays off — flipping it globally would
change behaviour for every module at once — so each column that would want a foreign
key now carries a comment saying why it has none.

**Found while probing, in no brief: `@IsUrl()` was wrong in both directions at once.**
Measured, it rejected `http://localhost:3000` and `http://imbatranim` — the OS is
itself a localhost web app, so a user could not bookmark their own dev server — while
accepting `ftp://x.com`, a scheme nothing here can open. Replaced with an explicit
`http:`/`https:` allow-list parsed by the platform's `URL`. That became
security-relevant the moment this brief added import: a Netscape file is untrusted
input, bookmarks render as `<a href>`, and a `javascript:` URL in the table would be
stored XSS. The whole import is refused rather than partially applied if one URL fails.

**Found while probing, in no brief: core's `Select` showed values instead of labels.**
The new folder picker read `6` rather than `Work / Specs`. `<Select.Value>` with no
children renders the raw value, because base-ui can only resolve a label when
`Select.Root` gets an `items` map — so **every** Select whose value differed from its
label was affected, including git-gui's repository picker and Calendar's reminder
offsets. Fixed once in `ui/Select.tsx`; verified in the browser that git-gui's picker
now reads "Home". No jsdom added: core's vitest config explicitly defers component
tests until a brief needs them, and a browser check is the stronger evidence anyway.

**And one of mine:** the new delete confirm said "the empty folder Work" about a folder
holding a subfolder and two bookmarks — the subtree walk recursed with the same "is
this the target?" predicate and so kept looking for the target instead of collecting
its children. A confirm that understates what will be lost is the one direction that
must never happen; it is now a tested pure function.

The app also owed the same style debt brief 74 just paid for sticky-notes: raw
`<button>`s, a `<span onClick>` rename no keyboard could reach, and **no failure signal
at all** — every mutation had `onSuccess` only, so a rejected write did nothing
visible. Kit `Button`s, real rows, one `reportFailure()` per mutation.

Tests: frontend vitest **828 → 886** (58 new in a package that had zero), backend e2e
**115 → 138** (23 new), unit unchanged at 208. All 101 turbo tasks green. Zero new
dependencies.

## 2026-08-05 — Brief 76: the Git allowlist grows, without loosening

The git backend was already the most carefully built thing in the repo — one `execa`
seam, array args, never a shell, a `--` pathspec guard, `GIT_LITERAL_PATHSPECS=1`, a
jailed cwd, and an adversarial security review behind it. Brief 76 is the **first
extension of its subcommand allowlist since that review**, from 7 to 12, so the point
was to add capability without adding surface. Grepped afterwards to be sure: still
exactly one `execa(` call site, still one `shell: false`.

**The crux is that a ref is not a pathspec.** `--` separates options from *pathspecs*;
there is no equivalent for `git switch <name>`, so a branch name beginning with `-`
would simply be read as a flag. `assertRefName` enforces git's own ref-format rules
in-process and refuses such input **before it becomes an argument** — 27 hostile names
are tested, `--upload-pack=/bin/sh` among them. The existing pathspec guard is
deliberately not reused: it permits `-` and `..` on purpose, which is precisely what
must not pass for a ref. `stash@{n}` is built from a validated integer for the same
reason: the client names an item, never a revision expression.

**Per-hunk staging is `git apply --cached` with the patch on stdin**, which is the one
new capability the seam gained. Stdin is itself the safety choice — a patch is the only
large structured client-supplied text here, and this way it is never an argument, never
a temp file, never anything a shell sees. The path safety is git's own default, and it
was **measured on git 2.43 before the code was written to depend on it**: `../outside`
is refused with "does not exist in index", `../../etc/x` with "invalid path". So
`--unsafe-paths` must never be passed, and a test asserts its absence.

**Two considered departures from the brief**, both now locked in `decisions.md`.
No server-side dirty-tree block on a switch: git already refuses a switch that would
overwrite local changes and deliberately allows one that carries clean changes across,
which is a normal safe workflow — blocking it would make the app worse than the
Terminal it exists to replace, so the warning lives in the UI and git's refusal is
surfaced verbatim. And discard is tracked-files-only: discarding an untracked file
means *deleting* it, which is `git clean`, a different and more dangerous verb, so the
user is told that instead of getting a silent no-op.

**Push/pull/fetch are explicitly out**, with the reason written down rather than left
as an implied gap: they need a credential living in the container and an outbound path,
which is a real security design owed its own brief alongside brief 50's SSRF stance.

**Found while probing, in no brief:** the 10 MB output cap **failed silently** — with
`reject: false` an overrun arrives as a result with empty stdout, indistinguishable
from "no changes", so a big diff read as "this file has no changes". Fixed with a 413
carrying a real sentence… and then my own frontend swallowed it, because I put the
message into the `diff` state where the parser found no files and rendered "0 hunks"
over an empty body. Found only by actually opening a 16.7 MB diff instead of trusting
the backend test. Also: a phantom context line in every parsed hunk (a bare `''` from
`split('\n')` treated as context, when git writes an empty context line as a *space*)
which corrupted every rebuilt patch's `@@` counts — caught by the parse → patch → parse
round-trip test before it ever reached git.

Recents got their own `git_recent_repos` table rather than reusing Notes'
`recent_files`: that one is a bare path with no root, and folding two meanings into one
table is the pattern this repo has refused since brief 71.

The security review was run through the **real HTTP API**, not only unit tests: every
case on the brief's list refused, all 13 new routes 401 without a session, and zero of
8 candidate artefacts created anywhere outside the work tree.

`decisions.md` passed its 200-line cap and was split — the 2026-07-16/17 pivot-era
decisions moved to `decisions-pivot-era.md`, unchanged and still locked.

Tests: backend unit **208 → 282** (74 new), frontend vitest **886 → 916** (30 new in a
package that had zero). Backend e2e unchanged at 138. All 102 turbo tasks green. Zero
new dependencies.

## 2026-08-05 — Brief 77: the REST client gets a workflow

Environments are the feature that makes a REST client usable rather than a curiosity:
`{{var}}` in URL, headers and body, substituted **at send time and never stored**, so
one saved request works against localhost and a deployed instance without editing.

The security-relevant part is that a variable ends up inside a URL the proxy fetches,
so the reviewer's trick is a value that smuggles a scheme — an innocent
`{{base}}/users` with `base = file:///etc/passwd`. That is refused in the client **and**
by the proxy: defence in depth, where the shallower layer exists to give the better
message (which scheme, and where to fix it) rather than an opaque backend error. Same
for a variable injecting `\r\n` into a header. A *missing* variable, by contrast, is
only a warning — sending is still the user's call — and the strip offers to add it to
the environment in one click.

Secrets are stated plainly to be **unencrypted on disk**, at the top of the editor,
because encrypting them needs a key and the honest home for that key is brief 50's
account-derived one. What the flag buys is real and listed: masked, excluded from an
export by default (name kept so the recipient fills in their own), and never baked into
a saved request.

**The brief's item 2 was half wrong, and the half that was right hid a real bug.**
History *was* surfaced with a replay handler — but `HistoryEntry` stored only method,
url, status and ts, so replay set those two fields and left whatever headers and body
were already in the builder. Click a GET from history while a POST body and an
`Authorization` header are loaded, press Send, and you send a different request with
the previous request's credentials attached. Worse than no replay. History now carries
headers, body and elapsed time.

curl in and out is hand-written with 40 tests, and explicitly **not a shell**: `$(…)`
and backticks stay literal, because a pasted command is untrusted data. **The
round-trip test earned its keep immediately** — the tokenizer only handled a backslash
before a newline, so `shellQuote("it's")` (which emits `'it'\''s'`) came back with a
stray backslash. Import previews what it parsed before applying it and names anything
dropped, so a `-o out.json` cannot vanish silently.

Multipart and raw binary needed one backend change: `bodyBase64` on the proxy DTO. It
bypasses nothing — the scheme allowlist, size cap, timeout, redirect cap and header
sanitising are all upstream of the body — and the review re-checked that a
`bodyBase64` request to `file://` is still refused. The envelope is built client-side,
keeping the proxy a dumb relay whose guardrails are about *where* a request goes.

**Found in my own work:** the Bearer helper defaulted to the first variable, which in
a normal environment is `base` — producing `Authorization: Bearer {{base}}`, wrong in
a way that still looks plausible. It now prefers a secret-looking name. Also, every
`notify()` in this app was missing `appId`, so its toasts had no icon (§23).

The **SSRF stance is unchanged and was re-verified**: private ranges stay allowed here
because the owner types every URL, and `decisions.md` explicitly forbids "harmonising"
it with brief 50. The review also confirmed the pre-existing guarantees still hold: a
redirect that changes host drops `authorization` and `cookie` while an ordinary header
travels, and a 14 MB response is capped at 10 MB and flagged rather than hanging.

Tests: frontend vitest **916 → 1022** (106 new in a package that had zero), backend unit
**282 → 287**. e2e unchanged at 138. All 103 turbo tasks green. Zero new dependencies.

*(Housekeeping: brief 76's outcome recorded its frontend totals as "828 → 858". The
baseline was carried over from brief 74 rather than brief 75; the true figures are
886 → 916, corrected in place. The "30 new" count was right, and no other number in
that entry was affected.)*

## 2026-08-05 — Brief 78: Archive Manager stops being a progress bar

The most defensively written module in the repo got a new surface, and the whole job
was making sure the new surface routes *through* the existing guards rather than
around them. The shape is unchanged: same `execFile` with array args, same
`resolveSafe` jail, same temp-dir-then-realpath-walk, same ratio caps.

**The format question was checked, not guessed** — the brief said so explicitly,
because this is the class of assumption that broke `ps` and `git`. Docker pulls are
blocked here, so it was cleared the way brief 68 cleared `--no-same-owner`: busybox's
own source plus `aports@3.22-stable main/busybox/busyboxconfig`, cross-read on
`3.21-stable`. **The answer is asymmetric, which is exactly why a guess would have
been wrong.** Reading uses busybox's *built-in* decompressors, and
`CONFIG_FEATURE_SEAMLESS_GZ/_BZ2/_XZ/_LZMA` are all `=y` — so `.tar.xz` lists fine.
Creating is a different mechanism entirely: tar `vfork`s and `execlp`s a separate
compressor applet (`archival/tar.c:573-621`), and Alpine sets `CONFIG_GZIP=y`,
`CONFIG_BZIP2=y`, but **`# CONFIG_XZ is not set`**. A `tar -cJf` would have died at
exec time with a message about `xz` that says nothing about the real cause. So xz is
offered for extraction only. (The brief's item asking to "add `.tar` and `.tgz`" was
**half wrong** — `detectFormat` already had them.)

**Browse-inside is the headline.** `GET /archive/list` reads a zip's central directory
or runs `tar -tv`, and extracts nothing — proved by a test that snapshots the directory
before and after, not by reading the code and believing it. The load-bearing choice:
**a refused entry is reported, not hidden.** Every declared name goes through the same
`resolveEntry` a real extraction uses, and a failure lands in `refused` with its reason
rather than being quietly dropped. A listing that hid the dangerous entries would be a
listing that lies about the file; the UI turns it into a banner naming them, so the user
learns the archive is hostile *before* pressing anything.

**Selective extraction is a new road into the zip-slip machinery**, since a selection is
client input. Three guards, all tested. Each chosen name goes through the jail. A name
the archive does not declare is refused outright instead of being handed to tar and
hoped over. And **every** declared entry is still checked, not just the selected ones —
otherwise not-selecting the bad entry *is* the bypass. Verified: a zip holding one safe
file and one `../` entry is refused even when only the safe file is picked. Chosen tar
members go after `--`, tested with an archive containing a member literally named
`-rf.txt`.

Progress is a **polled job, not a new transport** — a WebSocket for one feature would be
a second realtime channel to secure, while an id plus a status endpoint reuses the guard
that already exists. The id is a CSPRNG UUID rather than a counter, because it is the
only thing naming a result; jobs are TTL-swept and capped. The failure path got as much
attention as the progress: a job that dies minutes in reports `state: 'failed'` carrying
the service's own sentence, instead of ending in silence.

Non-UTF8 names are decoded lossily and the row is flagged **repaired** — deliberately
not a CP437 guess, because the "names are UTF-8" flag is frequently wrong in the wild
and a mis-guessed codepage yields a *different* wrong name with no warning attached. A
replacement character is visibly wrong, which is the honest failure, and the repaired
text is slash- and NUL-free so it cannot become a traversal the raw bytes were not.
Encrypted zips are detected from the general-purpose bit and declined with the reason,
rather than failing cryptically part-way through.

Add-to-existing-archive was **dropped, with the reason recorded**: appending means either
re-packing (which is "compress" with extra steps) or mutating the file in place, and both
give up the property that a failed operation leaves the original untouched.

Verified against real fixtures — a 43-entry zip, a `.tar.gz`, a `.tar.bz2`, and an
`evil.zip` built with fflate containing `../../ESCAPED.txt` — through the production
bundle on the real backend: listing extracted nothing, the traversal entry was reported
then refused with nothing escaping anywhere, `../../etc/passwd` / `/etc/passwd` / an
invented name were each refused, 2 of 43 files extracted meant exactly 2 on disk, the
job reached 100% with its result, a failing job named its reason, an unknown id 404'd,
a created archive re-opened, and all three new routes 401 without a session.

Tests: backend unit **287 → 319**. Frontend vitest unchanged at 1022, e2e unchanged at
138. All 103 turbo tasks green. Zero new dependencies.

## 2026-08-06 — Brief 80: the OS learns to back itself up

The README's answer to "how do I back this up" was a host `docker run`, and its answer
to a forgotten password was "delete the volume". A product that tells you to delete
your data as a recovery step should be able to back it up first — and the shell command
is **impossible for two of its own audiences**: the kiosk ISO has no host shell, and
nobody handed a VPS instance has docker access. Settings → Backup replaces it.

**The archive never touches disk.** `tar -czf -` streams straight to the response.
Writing the tarball into the tree being archived is both a recursion trap and a
disk-space trap on a volume that may already be near full — and if tar fails after the
headers are out, the socket is destroyed, so the client gets a truncated gzip that
fails its own CRC. A partial backup can never look like a complete one.

**Brief 78's habit paid twice more, and both answers changed the design.** Reading
busybox's source rather than assuming GNU behaviour turned up that `-C` is
*single-valued* — it parses into one `base_dir` and calls `xchdir` once, after option
parsing — so the GNU idiom of several `-C` interleaved with paths would have produced a
differently-rooted archive on Alpine, discovered at the worst possible moment. The
manifest and the database snapshot therefore ride *inside* the tree being archived.
Then `--exclude` turned out to be unanchored in both tars, matching at every `/`
boundary: a bare `.imbatranim/db.sqlite` would also have silently eaten a user's own
`Documents/.imbatranim/db.sqlite`. Every pattern is `./`-prefixed, which anchors it
because member names keep their `./` — `strip_unsafe_prefix` strips a leading `/` and
`../` but deliberately not `./`. Measured on GNU tar 1.35, read out of busybox for
Alpine, and there is a test that plants exactly that file and asserts it survives.

**The database is snapshotted, not copied.** It lives inside the volume, in WAL mode;
tarring it hot gives a torn file *and* omits the `-wal`, so the archive would look fine
and restore to a database missing its most recent writes. `VACUUM INTO` — bound as a
parameter, never interpolated — builds a checkpointed single-file copy from a read
transaction. A test extracts it, opens it read-only, and reads back a row.

**Restore reuses the hardened extractor by splitting it, not by copying it.**
`extractTar` became `stageTarExtraction()` + `mergeTree()`; restore calls the staging
half and does its own swap. A second copy of a traversal check is a second place for it
to rot. One resource bound moves and is stated: the 512 MB zip-bomb cap is right for an
archive a user found somewhere and wrong for a home volume, so restore's cap comes from
actual free disk. Traversal, symlink, hardlink, entry-count and `--no-same-owner` are
unchanged, and the review confirmed it by throwing a crafted `../ESCAPED.txt` archive
and a symlink-to-`/etc` archive at the live server: both refused, nothing planted.

**The swap detail that matters:** the undo list records **one entry per completed
rename, not one per name**. A failure between parking the live entry and moving the new
one leaves that name missing from the home directory entirely, and a per-name record
would not know to put it back. Restore also replaces only what the backup declares and
deletes nothing else — making home exactly match the archive would mean deleting files
created since, which is a bigger blast radius than the word "restore" implies.

**Refusal happens before staging.** No manifest, a manifest naming another product, an
unparseable date, or a snapshot missing from the staged tree — all refused before
anything moves. That last one is not paranoia: discovering it after the swap would
leave a restored tree whose database is not at the path the process reopens, i.e. an OS
booting into its setup screen with the user's data present but unreachable. Free space
is checked against an exact figure from `tar -tzv` (parsed with brief 78's
`parseTarListLine`, reused), so the preview can say "this will not fit" before the user
commits rather than filling the volume and dying halfway.

Two access decisions, both written down. **No password re-prompt on the download**,
despite it being the most sensitive route in the OS: it grants nothing the session
lacks, because `db.sqlite` — password hash and TOTP secret included — is inside the
home volume and already readable through `/api/files`. A prompt would be theatre.
**A typed `RESTORE`, enforced with `@Equals` on the server** and not only in the UI,
because a stray POST to that route replaces a home directory. Afterwards every session
is revoked and the cookie cleared: the restored database carries the backup's password,
so whoever holds this session is no longer necessarily the owner of the machine.

Progress is the browser's own download UI, not a byte counter of ours — reading the
archive through `fetch` to draw one would mean holding the entire volume in the tab's
heap before a byte reached disk, which is exactly the failure the streaming backend
exists to avoid. What the panel adds is the number the browser cannot know: how big the
backup will be, and what is deliberately left out of it.

Verified end to end in a browser against the real backend: take a backup, delete a
file, restore, the file comes back byte for byte, the session is gone, `auth/status`
agrees, and signing in again works. Zero page errors, no scratch directories left
behind.

Tests: backend unit **319 → 356** (37 new). Frontend vitest unchanged at 1022, e2e
unchanged at 138. All 103 turbo tasks green. Zero new dependencies.

## 2026-08-06 — Brief 47: a faulty app can no longer take down the OS

Pulled forward out of order because brief 84 lists it as a prerequisite — a caught
app crash needs somewhere to land. It is small, grilled and standalone, so doing it
first was the cheap correct order rather than a detour.

Every windowed app renders into core's shared React tree, so one uncaught `throw`
unmounted **the whole desktop**. Apps here are first-party and built in, so the
threat is a buggy app rather than a malicious one, which a boundary addresses
completely at no API cost.

**Reload had to be a key change, not a state reset.** The obvious error boundary
exposes `reset()` — clear the error, render the children again. That ships a Reload
button that visibly does nothing: the same child re-renders in the same state that
just threw, throws again, and the panel comes straight back. Recovery therefore
belongs to the caller — `WindowSlot` owns a remount counter and Reload bumps the
boundary's `key`, so the app genuinely remounts. The prop is `fallback(error)`, with
no `reset` to misuse. That is also why the container's map became a component: a key
needs state, and a map callback cannot hold a hook.

**The boundary is inside the chrome, and that is load-bearing.** A crashed app keeps
a title bar that drags, a taskbar button that focuses it, and a close button that
works — wrapping the chrome would remove the exact controls needed to deal with the
crash. Verified by dragging a crashed window 137px. `Suspense` sits inside the
boundary too: a lazy chunk that fails to load throws, and that deserves the same
handling as any other crash.

Crash toasts are deduped per app, because a render loop turns the notification centre
into a denial of service against itself. The guard started as a module-scoped `Map`
inside the boundary file and **eslint's `react-refresh/only-export-components`
rejected it** — the same rule that caught a real defect in brief 83. Moving it to its
own module fixed fast refresh and made the policy testable without mounting anything,
which is the only reason the window-expiry case has a test.

**A DOM test, and still no new dependency.** `vitest.config.ts` had said component
tests "would need jsdom plus @testing-library/react; add those the day a brief
actually requires them". This brief required the DOM; jsdom was already there, so
`.test.tsx` is now included with a per-file `// @vitest-environment jsdom`. RTL was
**not** added — `react-dom/client` plus React 19's `act` covers the whole surface in
a dozen lines.

Two React 19 behaviours had to be understood rather than papered over, and both had
already made my first draft of the spec **pass vacuously**. Dev mode re-invokes a
component after it throws to build a better stack, so a "throw once" test app
succeeds on the retry and the boundary never latches; the broken state is now the
test's to control. And a *caught* error is re-reported to `window.onerror`, which
vitest counts as an unhandled failure — `onCaughtError` is the supported way to say
the boundary handled it. A third came from the spec itself: rendering two boundaries
one after another into the same root does not test per-app dedupe, because the same
element type in the same position means React reuses the instance, which is already
latched and never catches again.

Verified with a real deliberate crash — a temporary `throw` in Calculator, a
production build, the real backend — and the blast radius held: both windows alive,
the taskbar intact, the desktop root at 364 elements, one notification rather than a
storm, Reload recovering the app, and Close closing that window and no other. Two
compositor-internal test hooks fell out of writing the probe (`data-window-id` /
`data-app-id` on the window root, `data-testid` on the taskbar); every UI probe so
far has had to find a window by its text.

The documented limit stands and is not half-solved: this catches throws, not hangs.
An app in an infinite loop still freezes the tab. That needs brief 48's transport
swap, and a watchdog here would be a worse version of it.

Tests: frontend vitest **1022 → 1032** (10 new). Backend unchanged at 356 unit, 138
e2e. All 103 turbo tasks green. Zero new dependencies.

## 2026-08-06 — Brief 84: the machine gets a memory of itself

`/var/log` is empty and nothing runs there — `entrypoint.sh` execs node as PID 1, so
Nest's output goes to stdout where only `docker logs` sees it, which is to say nowhere
at all on the kiosk ISO. "Was anyone trying to log in as me last week?" was
unanswerable on a product whose README suggests exposing it to the internet.

**The brief's own argument overruled the brief's own proposal.** It asks for a Nest
logger transport writing JSONL. Two paragraphs earlier it says the thing that rules
that out: *"an audit trail assembled from incidental log lines is not a trail."* A
transport would pour every `RouterExplorer` mapping line into the file, pushing the
events that matter out of the 2 MB rotation window faster, and swapping the global
logger risks the stdout path the brief separately asks to preserve. So Nest's logging
is untouched and `record()` is called on purpose at each site that matters. Backend
errors come in through an exception filter that records **only 5xx** — a 404 is the
system working, and logging refusals buries real incidents within minutes — and it
extends `BaseExceptionFilter` and delegates, so no response changes. An audit trail
that alters behaviour is a liability, not a record.

**Never logging a secret is enforced, not promised.** Redaction lives inside
`record()`, not at the call sites: a rule applied in one place is a rule, and a rule
each caller has to remember is a leak waiting for the one caller who forgets. It
denies by key name and errs towards dropping, including **`hash`** — an argon2 hash is
not a password but it is the input to an offline cracking attempt, and a log file is a
far easier thing to end up in a bug report than a database is. The failed-login site
goes further and never hands the DTO to the logger at all. Verified against the
running server: three refused sign-ins are in the file and neither the attempted nor
the real password appears anywhere in it.

Writes are **fire and forget** through a serialising queue, so a full disk cannot fail
the request that triggered it — a login must not stop working because the audit log
cannot be written; that turns a disk problem into a lockout. Reads walk **backwards in
64 KB chunks**, filter the raw line before paying for a JSON parse, and stop the moment
`limit` matches are in hand: a size cap is pointless if reading it needs the whole file
in the heap. A line torn by a crash mid-append is skipped rather than poisoning the
rest. Both routes are authed, and that is not boilerplate — log content names the
addresses that tried to sign in and the files that were deleted, so an open read would
be a reconnaissance endpoint for the exact attacker the log exists to catch.

Brief 47's boundary makes **the browser a writer**, and it is handled as one: a DTO
with an app id and 300 characters and nothing else, because a client-controlled object
in a log file is log injection with no upside; a per-process budget so a render loop
cannot fill the volume; and `source: 'client'` on the entry so it can never be read as
something the server saw for itself. A request that also sent `source: 'server'` and
`event: 'auth.login.ok'` had both silently dropped by the whitelisting pipe.

**Two dependency bugs the tools caught, both real.** `@Global` on the logs module was
*not enough* — the e2e suites build partial module graphs, and a global module that was
never imported does not exist, so all twelve failed to boot. Modules whose providers
require the logger now import it explicitly; services that unit tests construct with
`new` take it `@Optional()` so rate limiting does not stop working because nothing is
listening. Then core's eslint refused `RecentSignIns` importing `toSignIns` from the
add-on — correctly: that inverts the dependency the composition root exists to keep
one-way. The log's *shape* is a backend contract, so it moved into core; the
presentation stayed in the app.

Ships the **System Log** app (virtualized rows, level chips, debounced text filter,
Follow, click-to-expand raw JSON, dotted events shown as English) with filtering done
**server-side** — pulling the whole log down to filter in the browser would undo the
point of a capped tail. And **Settings → Security → Recent sign-ins**, placed first in
that section because "has anyone been trying to get in?" is the question people open
Security to answer, with refusals shown beside successes.

Tests: backend unit **356 → 385**, frontend vitest **1032 → 1044** in a package that did
not exist this morning. e2e unchanged at 138. All 107 turbo tasks green. Zero new
dependencies.

## 2026-08-06 — Feature exploration: seven new ungrilled briefs (93-99)

Charter: "do code exploration and a deep research; write a brief for new features
or add-ons we should implement." A platform-capability map of the code plus an
external landscape pass (Puter, daedalOS, AnuraOS, CasaOS/Umbrel) went into
[wiki/feature-exploration-2026-08-06.md](wiki/feature-exploration-2026-08-06.md).

The sharp finding: **the OS keeps building capabilities and giving them exactly
one consumer** — the HTTP proxy (REST client only), content search (palette
only), the recents table (Notepad only, with git-gui growing a parallel one),
`desktopLayer` (sticky notes only), `commandSources` (2 of 23 apps). And Clock,
Calendar and Todo each apologise in their own UI for the same missing core
scheduler. So the sweep proposes mostly second consumers for existing seams,
plus the two missing app categories: an image editor and games.

New briefs, all ungrilled: **93** core reminder scheduler (desktop-lifetime; the
SW variant stays gated on brief 50), **94** OS-wide recent files (one service,
three consumers: Start menu / FilePicker / palette), **95** Paint (lift the
snipping tool's annotation layer), **96** desktop widgets (generalise
`desktopLayer`; clock / agenda / system sparkline), **97** auto-lock on idle
(the cheap VPS security win), **98** Minesweeper + Solitaire (the
identity-affirming tier every comparable ships; zero deps), **99** diff tool
(Monaco's DiffEditor is already in the bundle; second manifest in the
code-editor package).

Kept out of brief form, with reasons on the wiki page: a cheap-wins list (more
palette sources, find-in-files UI, hotkey-registry coverage), a grill-first tier
(RSS reader, PWA installability, sound recorder, hex viewer, image wallpaper +
custom accent as a decisions.md revisit, disk treemap, file share links vs
"auth everywhere"), and an explicit no-relitigation pass over
[wiki/real-os-gaps.md](wiki/real-os-gaps.md) — no emulators, no multi-user, no
i18n, no email/sync. The sweep endorses the two standing todos
(install-apps-from-github as the strategic add-on story, gated on 47→48 + a
kill-list revisit; TOTP recovery codes).

## 2026-08-06 — Briefs 93-99 BUILT: the exploration sweep shipped the same day

Full-auto run in the proposed order (97 → 93 → 94 → 99 → 98 → 95 → 96), one
commit per brief, every gate green at each commit. The desktop is **28 apps**
(Diff, Minesweeper, Solitaire, Paint joined; Settings counted as ever), the
eager bundle moved 121.5 → **122.1 KB gzip** (+0.6 for three background
services, the widget host and five manifest entries — the lazy discipline
held), backend tests 287 unit + **144 e2e** (3 new), frontend gained ~80
tests across six packages. Two new packages (`games`, `paint`), zero new
dependencies anywhere.

The run's architectural yield is two new platform seams, both born from
brief 93's implementation forcing a rethink. The brief proposed a backend
read-model; the code refused it — alarm times and calendar epoch-ms carry
**local wall-clock meaning and the container deliberately knows no timezone**
— so occurrence math stayed client-side and the seam became general:
`AppConfig.background`, a headless desktop-lifetime service the shell mounts
for every enabled add-on. Clock/Calendar/Todo moved their tested watchers in;
their three "only while this window is open" apologies are deleted. The
backend got the one thing tabs cannot decide alone: `POST /api/schedule/claim`,
an atomic INSERT-or-lose on (domain, item, occurrence) that fails open. The
clock's minute-equality due check would skip alarms in throttled hidden tabs
— found and replaced with a windowed `dueOccurrence` whose occurrence instant
doubles as the claim key. The second seam is `AppConfig.widgets` (brief 96):
hosted Win7-gadget-style widgets where core owns placement/drag/clamp/
persistence and apps own content — the desktop also grew its first context
menu to toggle them.

Brief 94 promoted recents to `/api/files/recent` and deleted the two-route
notes module (all it had left after brief 25). Brief 97's idle lock shipped
at 15 min with the media inhibitor. Brief 99 put Monaco's DiffEditor in a
window as a second manifest from the code-editor package — a pattern brief 98
then reused for one `games` package exporting two apps. Brief 95's Paint kept
the snipping tool separate on a real distinction (object-annotations vs
bitmap) and built the 'Edit in Paint' pipeline instead.

Found in my own work during the run, before commit: `useRegisteredHotkeys`
captures handlers once per key set, so closures over state go stale — F2 in
Solitaire would have dealt at the first render's difficulty forever; routed
through refs in 98 and the trap then avoided in 95/96. Also a
setState-inside-updater that would have double-pushed the undo stack under
StrictMode.

Deferred, recorded in the outcome notes: Solitaire free drag (click-to-place
is the accessible model), Diff↔Git-GUI integration (`git show` is a new
allowlist argument deserving brief-76-grade scrutiny), the missed-while-away
digest (contradicts the apps' grilled stale-toast refusal), and brief 96's
Settings duplicate list.

## 2026-08-06 — Brief 85: four virtual desktops, and two bugs that were already there

24 apps share one browser tab with no second monitor to escape to. The compositor
already owned z-order, focus and the window list, so this is mostly a filter over
state that exists — which is exactly why the interesting parts were the three places
the obvious implementation is wrong.

**Switching must hide windows, not unmount them.** Filtering the list in
`WindowContainer` looks identical and would tear down the Terminal's PTY socket,
discard an editor's unsaved buffer and restart every in-flight request, once per
switch. A window on an inactive workspace uses the same `display:none` a *minimised*
window already used. Verified rather than reasoned about: a digit typed into the
Calculator on workspace 2 is still on its display after switching to 1 and back.

**The brief was wrong about persistence, and wrong in the invisible direction.** It
calls workspace assignment "session state" and puts persistence out of scope — but
the window layout is *already* persisted to localStorage and restored on boot,
geometry and all. Omitting `workspaceId` would silently collapse four workspaces onto
one on every reload, destroying the arrangement the feature exists to create with no
error and nothing to undo. That is worse than either option the brief weighed. The
active workspace is persisted too: reloading a session whose windows all live on
workspace 3 and landing on an empty workspace 1 reads as "everything is gone".
`clampWorkspace` is where the hard invariant lives — a hand-edited `workspaceId: 47`
lands on 4, not nowhere.

**Focus follows the window**, which is where "reachable" actually is. One change to
`focusWindow`, at the single place the taskbar, Alt+Tab, `openApp` and notification
clicks all funnel through. Without it, clicking a toast raised by an app on another
desktop raises the z-index of a window you cannot see and appears to do nothing.

Then the probe found **two bugs that predate this brief entirely**.

`Ctrl+Alt+←` did not fire, and the cause was that **no `ctrl+…` binding had ever
worked off a mac**. The matcher computes `modPressed = mac ? metaKey : ctrlKey` and
then rejected any event with the mod key held when the binding did not say `mod` — so
on Linux and Windows an explicit `ctrl+` binding was refused by the very key it asked
for. Invisible for as long as it existed, because every binding in the OS used `mod`.
Fixed, with eight tests on the matcher itself.

And **desktop icons and the Start menu both bypassed the single-instance rule**. Each
had grown its own three-line "open an app" calling `openWindow` directly, skipping the
check `intents/openApp.ts` exists to enforce. Before workspaces that was untidy — two
Calculators stacked on one desktop. With them it is much worse: the duplicate opens on
whichever desktop you are on while the original sits invisible on another, so the app
looks lost and the pip counts lie. Both now call the shared `openApp`.

Smaller calls, all stated in the brief's outcome: all four window hotkeys are scoped to
the active workspace rather than just Alt+Tab (the same selector drives `Ctrl+W`, which
could otherwise close something you cannot see); focus is computed per-workspace;
moving a window un-minimises it on arrival; switching wraps in both directions; empty
pips stay visible with an occupancy dot; and the taskbar context menu stays local
rather than being promoted to core, since this is the second use and the rule is to
promote on the third.

Tests: frontend vitest **1044 → 1071** (19 on the store, 8 on the hotkey matcher).
Backend unchanged at 385 unit, 138 e2e. All 107 turbo tasks green. Zero new
dependencies.

## 2026-08-06 — Browser walkthrough of briefs 93-99: all verified live

Ran the production build for real (backend serving the built desktop on
:8080, scratch home volume) and drove it with headless Chromium. Verified
end-to-end, with screenshots: first-run wizard and lock screen; **an alarm
firing as a toast with the Clock app never opened** (claim `{claimed:true}`,
firedPatch and the schedule_fired row all stamped at the occurrence's exact
second); widgets added from the desktop context menu, dragged with a live
preview and the position persisted; Minesweeper's first click flooding 36
cells; Solitaire dealing and drawing; Paint drawing a stroke and saving a
real PNG into the home volume; that PNG then appearing in Start → Recent;
two files selected in the File Manager showing Compare and opening a
rendered Monaco diff with Save right armed; the Auto-lock control live in
Settings → Security.

Every failure the first pass reported turned out to be the test script, not
the OS (a `text=Start` selector for an icon-only button, ctrl+right-click
toggling the selection before the menu opened, a wrong localStorage key).
**One real, bounded caveat surfaced:** an alarm created from *outside* the
app — another device or raw API — for less than ~60s in the future can be
missed entirely: the background service's cache refetches every 60s, and a
one-shot occurrence more than 90s stale refuses to late-fire by design.
In-app creation invalidates the cache immediately, so normal use is
unaffected. Recorded here rather than fixed: tightening it means either a
faster poll (chatty) or server push (the killed daemon's shape).
## [2026-08-06] todo | Brief 100 — code-health sweep filed from a six-lane audit

Deep exploration at commit aaa128b: six parallel audit lanes (backend, core
shell, heavy add-ons, light add-ons, @pdfcore/engine, infra/build) with all
gates green at baseline. ~75 verified findings filed as
[brief 100](briefs/done/100-code-health-sweep-2026-08-06.md), ranked in tiers.
Headlines: the prod Docker image cannot build (packages/ never COPYed — proven
by npm-install simulation); pdf-lib's stale page cache makes delete→reorder
resurrect a deleted page (proven by executed repro); Sheets converts every
Excel date cell to ISO text on save; the backend's default 100 KB JSON body
cap silently breaks Notepad/REST-client/git-apply; norPDF never writes back to
the opened file and has no unsaved guard; calendar recurrence dies after 750
occurrences from series start and "does not repeat" doesn't (both proven by
repro tests); turbo can serve stale desktop bundles (core declares no add-on
deps — hash-proven). Audit lanes also recorded what came up clean so it is not
re-audited. All items are ungrilled proposals; grill before building.

## [2026-08-06] done | Brief 100 — code-health sweep implemented (10 commits, 75/75 gate)

Worked the full brief 100 backlog end to end on `claude/code-exploration-improvements-0epjig`.
Structure: a foundation commit (T3-1 turbo stale-cache fix via a core-scoped
`inputs` override — a topological `dependsOn` is impossible, core↔add-on is a
package cycle — plus the `useTopWindowKeydown`/`isTopWindow` seam), then six
package-disjoint lanes run as parallel subagents in two waves (wave 1: backend,
core, pdfcore-engine, infra — none read each other's source mid-edit; wave 2:
heavy + light add-ons, against the committed core), each verified per-package
and committed as a unit, then a final cross-cutting config pass.

Every Tier 0–2 finding shipped. **T2-10 (pdf.js dispose) was missed in the
initial dispatch and caught in a self-audit** — engine + norPDF now release
worker-side documents. **T3-7 (strict) was free**: strict across all add-ons +
core and backend `noImplicitAny` produced 0 errors (config lagged, not code).
**T3-8's backend TS6/eslint10 half is deferred** (a real migration; see
[decisions.md](wiki/decisions.md) 2026-08-06) — its dev-compose half shipped.

Verification: forced `turbo typecheck lint test` = **75/75** after each wave and
the final pass. New regression tests in every lane. Prod-image unbuildability
(T0-1) reproduced then fixed; Docker/ISO not built here (no daemon). Brief moved
to [done/](briefs/done/100-code-health-sweep-2026-08-06.md) with a full outcome
note; wiki folded below.

## 2026-08-06 — Brief 49: the session becomes per-tab, the config becomes an account

The grilled split from the layering session, finally built: **a session is per-tab
and dies with the tab; user config belongs to the account and follows you to any
browser.** Two of the brief's implementation instructions changed, both because the
brief's own reasoning points somewhere better once you read the code.

**`sessionStorage`, not "delete the persistence".** The brief says to hold each
session purely in memory. That ends the two-tab stomp, and it also throws away
reload survival for the overwhelmingly common single-tab case — refresh and your
whole arrangement is gone. Under the brief's own SSH analogy that is the wrong cut:
closing the tab is logging out, reloading is the terminal redrawing.
`sessionStorage` is exactly that boundary, meets every acceptance criterion the
brief lists, and needs no server state, no reattach and no GC because the browser
drops it. One word changed and the bug class went with it — `localStorage` is
shared by every tab of an origin, which is why two desktops fought over one key.
It also **preserves brief 85** instead of reverting it: workspace assignment rides
in the same per-tab store, which is simultaneously the answer to "a reload must not
collapse four workspaces onto one" and "two tabs must not fight over the active
one".

**Server as source of truth, localStorage as a first-paint cache.** The brief says
to replace each dotfile store's `persist(localStorage)` outright. For appearance
that is structurally impossible: `main.tsx` applies theme and accent synchronously
before React mounts, so the lock screen is branded — and that paint happens
*before* authentication, while `/api/prefs` is behind the session guard, as it must
be. There is no server to read at the moment the value is needed. So paint from the
mirror, hydrate once there is a session, re-apply, keep the mirror fresh. A browser
that has never seen this machine shows the default behind the lock and picks up the
real values on sign-in — correct, because your wallpaper lives behind your password.
The mirror is also why the adapter is synchronous: an async `StateStorage` makes
zustand hydrate a tick later, and every visual store would flash its default first.

**The step that was easy to miss, and it did not work without it.** `persist`
hydrates once, at store creation — at import, long before there is a session.
Filling the cache afterwards changes nothing on its own; the stores are still
sitting on what they read at import. `rehydrate()` on each dotfile store after the
fetch is what makes the server's copy take effect. Without it the feature *appeared*
to work in the tab that made the change and silently did nothing in a fresh browser
— the only case it exists for. The probe caught it; reasoning had not.

**And the bug the unit test could not see.** `PrefsService.put` handed the DTO
straight to better-sqlite3 and every real request 500'd with "Named parameters can
only be passed within plain objects", while the spec stayed green: the global
`ValidationPipe` runs with `transform: true`, so the controller receives a class
*instance*, and a spec naturally writes object literals — a shape production never
produces. Destructured, with a test that builds a real DTO instance.

Smaller calls: the stored value is **opaque to the server** (a backend that knew
each client store's schema would need changing every time one gained a field); the
migration *is* the hydrate, because "the server has not got it yet" and "this is a
legacy local value" are the same condition; writes are debounced, coalesced, and
flushed on `visibilitychange` and `beforeunload`; a non-dotfile key is refused at
the adapter so window layout can never reach the server by accident; and a failed
fetch keeps the desktop running on the mirror, because refusing to render over an
unreadable wallpaper would be the worse failure.

Verified with two real tabs: tab A keeps its two windows while tab B opens its own
and neither disturbs the other, a reload keeps each tab's own arrangement, a browser
that has never seen this machine gets the theme and accent but no windows, and no
prefs request is made while the lock screen is showing.

Tests: backend unit **385 → 408**, frontend vitest **1071 → 1147**. e2e unchanged at
141. All 115 turbo tasks green. Zero new dependencies. **Unblocks briefs 81 and 82.**

## 2026-08-06 — Brief 81: default apps, and the end of the dead double-click

Association moved out of a constant inside one add-on and into the manifests. Each
app declares `opens?: string[]`; core derives ext → candidates from `APP_REGISTRY`
and resolves **user override → declared candidate → text fallback → nothing**. The
100-line `EXTENSION_APP_MAP` is deleted, so adding an app no longer means editing a
different app — the coupling `manifest.ts` exists to avoid, and the reason brief 65's
PDF mismatch sat unnoticed.

`resolveOpener` returns *why* it chose, and that is what makes the UX honest.
Text-ish files open in Code Editor; an unknown binary opens the **Open with**
chooser with "No app claims this file type" at the top. The brief wanted a
Properties card there first — one extra click to reach the only action it offers, so
the chooser opens directly and Properties stays a right-click away.

Text-ishness is **derived from what the text apps claim**, not hand-listed. The
first cut listed extensions by hand, missed `.md`, and so reintroduced the exact
dead click this brief exists to remove the moment Markdown Editor was disabled.
`.pdf` needed pinning for the opposite reason: both PDF apps claim it and
`pdf-viewer` is registered first, so "first candidate wins" would have quietly
undone brief 65.

**The bug only a second browser could see.** The override was wired to brief 49's
`prefsStorage` and passed every same-tab check, reload included — while never
leaving localStorage, because `writePref` silently drops any key absent from
`DOTFILE_KEYS` and `imbatranimos:file-associations` was not in it.
`rehydrateDotfileStores` was missing the store as well, so even with the key
registered a fresh browser would have kept its import-time default. A same-tab
reload cannot distinguish "dotfile" from "localStorage", which is exactly why it
went unnoticed. Registering a store in `DOTFILE_KEYS` is load-bearing rather than
bookkeeping, now said so in the code and pinned two ways: a unit test on the key,
and a probe that sets the default in one browser profile and reads it in an empty
one.

Archives are the single **new** mapping, and it nearly shipped broken. Archive
Manager drains a typed intent and ignored the generic `{ openPath, root }` payload
every other opener gets, so a double-click launched it *idle and empty* — worse than
a dead click, because it looks like the app is broken rather than the association.
Fixed inside the app that owns the knowledge, mapping "open" onto brief 78's
list-and-wait browse. The general rule: **`opens` is a promise that the app can act
on the generic open payload**, and reading its intent handler is the check.

Not built as brief 48's `system.intents` — 48 has not landed — so it ships as a core
export shaped as free functions over a store, which 48 can re-export and delete
without touching callers. Recorded debt, not a resolution.

Also removed core's declared dependency on `@imbatranim/logs` (brief 84), the only
add-on it declared, which made turbo print a circular-dependency warning on every
build.

Verified with three Playwright probes on a production bundle behind the real
backend, 23 checks green: `.csv` → Sheets, `Dockerfile`/`nginx.conf` → Code Editor,
`firmware.bin` → the chooser; Open-with once vs "always", the choice appearing in
`/api/prefs` and surviving a reload; Settings listing the types, reporting
`Reset all (1)` and clearing the server copy; a second empty profile on the same
account opening `.md` in Code Editor; and a real `bundle.zip` double-click landing
in Archive Manager **already listing** its two files.

Frontend vitest **1147 → 1150**. Backend unit 408 and e2e 141 unchanged. All 115
turbo tasks green. Zero new dependencies.

## 2026-08-06 — Brief 82: startup apps, and a brief whose premise had expired

An ordered list of apps that open when you sign in, stored as a brief-49 dotfile.
Cheap feature; the interesting part is that **the brief was wrong about the code it
was written against**, and following it literally would have shipped a bug on every
reload.

Brief 82 says brief 49 "deliberately deletes" the layout restore, so every load
lands on a bare desktop and startup apps are the honest replacement. 49 did not
delete it — it moved the layout to `sessionStorage`. A reload of the same tab still
comes back with its windows; only a *new tab* starts bare. "Open the set once per
session, after authentication" would therefore have re-opened everything **on top
of** the restored windows: a second Notepad, a second Code Editor, and focus yanked
to the end of the list every time anyone pressed F5.

The corrected rule: never when a layout was restored, because those windows *are*
this session's arrangement; and never twice in one tab even when the desktop is
empty, because otherwise an app on the startup list can never be got rid of. The
marker lives in `sessionStorage` so it shares its lifetime with the layout it
guards, and a duplicated tab — which copies `sessionStorage` — inherits both
together. That is 49's own session/dotfile split applied one level further in than
82 could see. A consequence worth writing down: **a reload is not a test of this
feature.** Every meaningful probe check opens a fresh browser context.

`imbatranimos:startup` was registered in **both** `DOTFILE_KEYS` and
`rehydrateDotfileStores` — the pairing brief 81 learned the hard way, where a store
had the first without the second and the setting silently never left the browser.

`startupCandidates()` skips ids the registry no longer has and apps disabled in
brief 46, and Settings shows that same function's result — so the "2 apps will open
at startup" line cannot drift from what boot does. A disabled entry stays in the
list, struck through, saying it will be skipped: silently dropping it would lose the
setting, and re-enabling the app should bring its entry back.

Three judgement calls against the brief's letter. **No hand-rolled cascade**: the
brief asks that several startup windows respect brief 52's clamp, which `openWindow`
already does, and it also scatters new windows ±100px around centre — a wider spread
than any stagger worth writing, so `runStartupApps` calls plain `openApp` with no
placement argument. **Buttons, not drag, for reordering**: for a two-to-four item
list, move-earlier/later is keyboard-accessible, screen-reader-legible, needs no
gesture library and cannot half-complete. **Two lists rather than one checkbox
list**: order is the only reason this is a list rather than a set — the last app
opened is the one in front — and an alphabetical checkbox list would hide exactly
that. "Use my current windows" takes **z-order**, so the arrangement you are looking
at is the one you get back.

Verified with one probe, 19 checks green: a new session opens exactly the two
configured apps and nothing else; a reload leaves two windows and not four; closing
them and reloading leaves the desktop empty; the snapshot button rewrites the list
and the next session honours it; a disabled app is skipped while its entry is kept;
and two tabs of one account each open their own set, keep their own layout, and
closing everything in one leaves the other untouched across a reload — brief 49's
model intact.

Frontend vitest **1272 → 1286**. Backend unit 423 and e2e 141 unchanged. All 115
turbo tasks green. Zero new dependencies.

## 2026-08-06 — Brief 48: the protocol seam is live

The largest brief in the backlog, closed. Apps import **nothing** from the OS
any more: the UI kit and pure helpers come from the new `@imbatranim/ui` SDK
package, and every runtime ability arrives through one injected `system` handle
whose TypeScript interface — `packages/ui/src/system.ts` — is the versioned
protocol spec. Core's public barrel shrank to the add-on contract's types, and
eslint in every add-on now rejects a value import from core (planted one to
watch it fail; type-only passes). Swap the in-process transport for a sandboxed
iframe someday and no app changes — which is the entire point.

Departures from the brief, each recorded in the outcome: the spec lives in the
SDK rather than core (both sides must resolve the same context, and it makes
the eslint rule absolute); the file dialog became a **portal capability**
(`system.fs.pick*` — the OS renders its one dialog, apps await pure data, and
seventeen apps' copy-pasted `{fileDialog}` render line is gone); and three
namespaces the 2026-07-19 grilling did not foresee were added as API decisions
(`shortcuts`, `appearance`, `schedule`), plus a `ctx` parameter on
`CommandSource.search` because palette sources run with no mount.

Scoping is the security model, and it caught a real design flaw: `notify` has
no appId field — the handle stamps it — which forced File Manager's habit of
recording OS recents *attributed to the app it launches* into the right place.
Core's `openApp` now records "file X opened with app Y" at the one choke point
every launcher shares.

Mechanically: seven commits, gates green at each. Package split with core-side
re-export shims (core's ~200 internal `cn` imports never moved); protocol +
per-window injection + ten scoping tests; sticky-notes proof (including the
windowless desktop-layer path); file-manager stress test (the brief-81 probes
pass through the handle unchanged); then the remaining **24 apps in a parallel
agent fan-out** — one agent per app on a shared recipe, structured results,
interrupted once by the session usage cap and resumed with the finished half
replayed from cache; then the flip. The shrink exposed one genuine latent bug:
pdfcore-engine's `isNodeEnvironment()` only ever type-checked through an
accidental import-graph leak into `@types/node`.

Verified: 119/119 turbo tasks (the ui package adds four), backend unit 423 and
e2e 141, frontend vitest **1286 → 1292**. Boot bundle **byte-identical** across
the flip (36,476 KB dist, 396 KB entry chunk) — the brief's no-growth bar met
exactly. In the browser, production build: all 29 apps open clean from search
with zero page errors, and the four regression probes (brief 81 ×2, the
sticky-notes seam probe, brief 82's startup probe) all pass.

## 2026-08-06 — Brief 51: the contained dev pipeline, and a broken image build caught statically

`npm run dev` is now `docker compose --profile dev watch`: source syncs from
`apps/` AND `packages/` into the container's own filesystem, dependency changes
rebuild the image, and the hand-list of per-add-on anonymous volumes is gone.
It had rotted **twice** — 7/24 covered when the brief was grilled, then a
23-entry rewrite that was already missing `games`/`logs`/`paint` and never
covered `packages/*` at all, which since brief 48 means host edits to the
`@imbatranim/ui` SDK silently did nothing in the dev container. The dev image
also never copied `packages/` — `turbo dev` inside it has been unbootable since
the SDK split. Lists that cannot glob rot; compose `watch` enumerates nothing.

The grill found a worse bug than the brief asked about: **the prod image build
has been silently broken since the documentation site landed.** `apps/docs`
joined the workspaces, the deps stage copies no manifest for it (tolerated —
`npm ci` skips an absent dir), but the builder's `COPY apps ./apps` brings the
site in afterwards and `turbo build` then runs `@imbatranim/docs-site#build`
with its Astro deps never installed. Proven by simulating a fresh-clone
install from exactly the Dockerfile's manifest set. Fixed in `.dockerignore`:
the documentation site is not product runtime, so it never enters the build
context.

`install:tooling` (`npm install --ignore-scripts`) verified in a scratch clone:
no native compile, no C toolchain, and `tsc --noEmit` on a real app — which
transitively typechecks the whole manifest graph — passes against that install.

The container-run half of the verify bar is **environment-gated**: this
sandbox's egress policy denies Docker Hub's blob CDN, so the images cannot be
built here. The exact commands, and why `games` + `packages/ui` are the right
HMR probes (both dead under the old list), are in the outcome note.

All 119 turbo tasks and backend e2e 141 green; the prod runtime path is
untouched by design.
