---
summary: Dated snapshot — web-OS era; briefs 08–14 + 16–46 DONE. The 2026-07-18 full-auto daily-driver backlog (34–46) is COMPLETE: CORE notification center (34), Wave C's six light apps (35–40), Wave D's four heavy/backend apps (41–44: Monaco code-editor + git-gui + REST client + archive-manager, the backend three authed+jailed, adversarially security-reviewed + hardened), and Wave E's two CORE platform surfaces (45 global search launcher, 46 add-on manager). Desktop = 23 apps; 135 backend tests. Only human-gated items remain before v1.0: SEC-9 CSP + SEC-10 kiosk sandbox (browser/ISO-gated), brief 15's v1-release remainder, and per-brief human walkthroughs.
updated: 2026-08-06
---

> **2026-07-19 — first human walkthrough.** Fixed from real QA: Media Player
> seek (backend HTTP Range support, +3 e2e), global-search scroll-reset and
> Git GUI Select crash (both core), SEC-9 CSP tightened to `'self'`. Decided:
> crimson accent confirmed (presets stay), VPS deploy + git tag dropped from
> the v1 bar (version lives in package.json, already 1.0.0), kiosk ISO +
> code-editor File menu deferred post-1.0. Open: Clock timer off-by-one fix is
> written but BLOCKED on read-only `apps/add-ons/*/src` perms (patch in
> scratchpad); 6 non-exploitable moderate `uuid` audit findings await a
> decision (npm `overrides` is ignored in this workspace). Full detail in
> [../log.md](../log.md) 2026-07-19 + [decisions.md](decisions.md) 2026-07-19.

> **2026-08-06:** code-health sweep [brief 100](../briefs/done/100-code-health-sweep-2026-08-06.md) **DONE** — all ~75 findings shipped bar one deferral (backend TS6/eslint10, see decisions), across 10 commits, gate **75/75** with strict mode now on. Fixed the unbuildable prod image, the @pdfcore page-delete corruption + pdf.js worker leak, Sheets date corruption, the 100 KB body cap, norPDF write-back, calendar recurrence, missed clock alarms, and much more. Ship-blockers gone.

# Status — 2026-07-17

**Phase: building.** The project is a web-OS: real Alpine container, React
desktop as its screen (see [decisions.md](decisions.md)). Briefs 08 + 09
landed — the fork is imported/pruned and the dual-mode container image
builds and runs (desktop + API on one port, unprivileged imbatranim user,
volume-persisted home). Committed to `main` (local-only, no PR/CI).

## Metrics (recorded)

- Prod image size: **385 MB** (2026-07-17, post-brief-16 workspace build —
  was 382 at brief 15, 364 before auth/argon2 + system apps; target ≤~400
  ✓). See [decisions.md](decisions.md).
- Cold start: **1.42 s** (container start → first HTTP 200 on /health,
  fresh volume incl. migration). Idle RAM: **41.3 MiB** (docker stats
  after 60 s). The "lightweight" receipts, 2026-07-17.
- **Kiosk ISO (brief 18, post-v1):** `imbatranimos-1.0.0-x86_64.iso` =
  **580 MiB** (hybrid BIOS+UEFI, diskless). RAM floor **2 GB** (measured:
  2 GB boots fully to the kiosk login; 1 GB reaches OpenRC but the diskless
  tmpfs can't hold the ~1 GB run-from-RAM install, so the stack never comes
  up — 4 GB comfortable). Boot-to-login **under ~2 min** under KVM emulation
  (each boot re-installs ~250 pkgs into tmpfs). Built unprivileged in Docker
  on WSL2 (fakeroot). 2026-07-17.

## Briefs

| # | Brief | State | One-liner |
|---|---|---|---|
| 01–07 | ISO era | superseded | Full installable-distro path; record in briefs/superseded/ + log |
| 08 | [fork-bootstrap](../briefs/done/08-fork-bootstrap.md) | **done** | Imported + pruned minimal-web-desktop; dev loop verified |
| 09 | [container-image](../briefs/done/09-container-image.md) | **done** | Dual-mode Dockerfile; one port, imbatranim user, volume home verified; image 364MB (over target — revisit flagged) |
| 10 | [auth](../briefs/done/10-auth.md) | **done** | Sessions (argon2id + httpOnly cookie), first-run wizard, optional TOTP, login throttle, global guard + WS validator; HTTPS = Caddy reverse proxy (decided) |
| 11 | [terminal-app](../briefs/done/11-terminal-app.md) | **done** | Real WS PTY at /api/pty (auth on upgrade, backpressure, revocation sweep); old repl module deleted; multi-instance Terminal app |
| 12 | [files-app](../briefs/done/12-files-app.md) | **done** | Home-root FS API (traversal/symlink jail, tested) + explorer UI with tree/context menu/upload/download |
| 13 | [system-monitor](../briefs/done/13-system-monitor.md) | **done** | Live CPU/RAM/disk/processes + About; uid-scoped kill; app-install stance recorded |
| 14 | [imbatranim-reskin](../briefs/done/14-imbatranim-reskin.md) | **done** | Win7-classic taskbar/start/tray/icons, B&W tokens, dark default, hourglass logo; accent = 4 presets, crimson provisional (user pick pending) |
| 15 | [v1-release](../briefs/todo/15-v1-release.md) | in progress | Engineering DONE (security pass, 413/headers/repl_configs fixes, README, 1.0.0 stamp, container verified + numbers); human-gated remainder: friend QA, VPS deploy, accent pick, dep bumps, tag |
| 16 | [turborepo](../briefs/done/16-turborepo.md) | **done** | npm workspaces + turbo 2.10.5, single root lockfile, phantom tailwind deps rehomed; envMode loose + prettier pin 3.8.3 (see log); image 385MB, FULL TURBO ✓ |
| 17 | [os-restructure](../briefs/done/17-os-restructure.md) | **done** | apps/{backend,core,add-ons/*}; 7 add-on packages, manifest.ts composition root, eslint-enforced boundary; browser-verified (found+fixed Tray stats crash); backend lint debt remains |
| 18 | [alpine-kiosk-iso](../briefs/done/18-alpine-kiosk-iso.md) | **done** (QEMU-verified) | Post-v1 kiosk ISO: `./build iso` (nob.h build.c → Docker → mkimage, unprivileged/fakeroot) makes a 580 MiB hybrid BIOS+UEFI diskless ISO. App ships as a signed custom `.apk` (musl-compiled native addons); greetd autologin → cage + chromium --kiosk → the web UI off the local backend. **KVM-booted into the fullscreen first-run login, no console/shell** (screenshot-verified); RAM floor 2 GB. Human-gated: UEFI live boot + VirtualBox/Hyper-V + real HW + interactive terminal/files walkthrough |
| 19 | [office-viewers](../briefs/done/19-office-viewers.md) | **done** | PDF Viewer (pdfjs-dist) + Slides (pptx-preview — spike passed on a real 11-slide deck); file-manager ext→app map (lib/openWith.ts) drives double-click/Enter/context menu; engines lazy chunks |
| 20 | [office-editors](../briefs/done/20-office-editors.md) | **done** | Sheets (Univer + ExcelJS bridge — SheetJS CE failed the styling spike, user-approved engine revisit) + Docs (SuperDoc + docx normalizer fixing a silent-save-loss defect); AGPL-3.0 relicense landed; explicit Save, dirty •, close guard, New→Spreadsheet/Document |
| 21 | [snipping-tool](../briefs/done/21-snipping-tool.md) | **done** | Flameshot-style capture via html-to-image (spike passed incl. xterm content), dim+crosshair region/Enter/Esc flow, 5 annotation tools + undo, Save to ~/Pictures/Screenshots / Copy / Download; rasterizer lazy |
| 22 | [file-preview-pane](../briefs/done/22-file-preview-pane.md) | **done** | Explorer-style toggleable preview pane in file-manager: text/images/AV native, metadata-card fallback, 1 MB text cap, persisted width/toggle, auto-collapse; zero new deps |
| 23 | [shared-addon-kit](../briefs/done/23-shared-addon-kit.md) | **done** | Deduped the office/add-on spine into `@imbatranim/core` (fileBytes/downloadUrl/fileName, `createOpenedFileStore`, `useOpenIntent`/`useSaveHotkey`/`useUnsavedGuard`, `ConfirmDialog`/`useConfirm`); 4 doc add-ons dropped local fileBytes+openedFileStore copies, native `confirm()` gone from add-ons; net −333 LOC, all gates green + 2-finder review. Human-gated: in-browser walkthrough |
| 24 | [window-render-perf](../briefs/done/24-window-render-perf.md) | **done** | PERF-1: memoized `Window` + per-window store selector + `useShallow` container list + `ResizeHandle` reads `getState()`; only the moving window re-renders during a drag (no app subtree reconciles). Gates green. Human-gated: in-browser drag feel |
| 25 | [notes-filesservice-dedup](../briefs/done/25-notes-filesservice-dedup.md) | **done** | CS-7: backend `notes` collapsed to `/notes/recent`; Notepad now uses `/files?root=notes`; 3 duplicate DTOs + FilesService delegation removed. `createFile` now upsert. 80 unit + 29 e2e green. Human-gated: Notepad walkthrough |
| 26 | [filemanager-split](../briefs/done/26-filemanager-split.md) | **done** | CS-3: FileManager 752→531 lines; extracted useFileSelection/useFileClipboard/useDeleteFlow (delete states → one union, CS-4 preserved)/usePaneResize/useListKeyboardNav + buildMenuItems. Behavior review clean. Human-gated: walkthrough |
| 27 | [docx-offthread-unzip](../briefs/done/27-docx-offthread-unzip.md) | **done** | PERF-6 (docx slice): docxNormalize uses fflate async `unzip`/`zip` (off-thread), identical output. Xlsx/ExcelJS worker slice still open in the todo. Human-gated: large-docx open feel |
| 28 | [first-run-setup-token](../briefs/done/28-first-run-setup-token.md) | **done** | SEC-2: opt-in `SETUP_TOKEN` (default-off no-op) gates first-run claim with a constant-time compare; `/auth/status` advertises it, wizard asks when required. 80 unit + 34 e2e. Human-gated: token deploy |
| 29 | [backend-lint-typing](../briefs/done/29-backend-lint-typing.md) | **done** | Paid the backend `no-unsafe-*` lint debt (typed sqlite rows + pty/main/test typing). **`backend#lint` + root `npm run lint` now green (0/0)** — the last standing lint red is gone |
| 30 | [addon-polish](../briefs/done/30-addon-polish.md) | **done** | Notepad StrictMode-safe intent drain; new core `PromptDialog`/`usePrompt` replaces native `prompt()`; dropped 4 dead `zustand` deps (+ lockfile). Human-gated: notepad walkthrough |
| 31 | [virtualize-long-lists](../briefs/done/31-virtualize-long-lists.md) | **done** | PERF: virtualized ProcessTable (re-renders every 1.5s) + FileList (large dirs) with `@tanstack/react-virtual`, centralized in core via a `useVirtualList` helper + `ScrollArea` `viewportRef`; keyboard nav `scrollToIndex`, scroll stable across refetch. Human-gated: kiosk feel-check |
| 32 | [xlsx-offthread-worker](../briefs/done/32-xlsx-offthread-worker.md) | **done** | PERF-6 (xlsx tail): whole ExcelJS round-trip moved into a lazy Vite module worker (`sheets/src/engine/xlsxWorker.ts`), request-id correlation + transferable buffers; bridge signatures unchanged so `Sheets.tsx` untouched; exceljs now off the main thread's module graph. Human-gated: large-xlsx responsiveness |
| 33 | [eager-bundle-lazy-load](../briefs/done/33-eager-bundle-lazy-load.md) | **done** | PERF: every app shell + Settings now a `React.lazy` boundary, `<Suspense>` in WindowContainer, contract widened; eager `index-*.js` gzip **399.6 KB → 121.5 KB (−69.6%)**, app code emits as per-app chunks. Trigger for Monaco. Human-gated: open-flash/first-paint |
| 34 | [notification-center](../briefs/done/34-notification-center.md) | **done** | CORE platform surface: persist-backed notification store + public `notify()` on `@imbatranim/core`, bottom-right auto-dismiss toasts (errors sticky), tray bell + unread badge + history popover (mark-all-read / clear-all / DnD). Session-only toasts, history bounded 100, no new deps. First callers = clock alarms (36) + calendar reminders (40). Human-gated: walkthrough |
| 35 | [calculator](../briefs/done/35-calculator.md) | **done** | Wave C. Basic (shunting-yard, no `eval`) + Programmer mode (BigInt 64-bit, HEX/DEC/OCT/BIN + bitwise/shift). Keyboard, window-scoped. Own lazy chunk. No new deps. Human-gated: feel-check |
| 36 | [clock](../briefs/done/36-clock.md) | **done** | Wave C. World clocks (Intl), stopwatch, timer, alarms; timestamp-driven (no drift), persisted. Alarm/timer → `notify()` (first notification caller), "only while open" note. No new deps. Human-gated: accuracy/fire |
| 37 | [image-viewer](../briefs/done/37-image-viewer.md) | **done** | Wave C. Root-aware `<img>` via `downloadUrl`, zoom/fit/rotate, folder prev/next (own `listDir`), keyboard. Registered png/jpg/jpeg/gif/webp/bmp/svg/avif/ico → openWith. No new deps. Human-gated: open/next/zoom |
| 38 | [media-player](../briefs/done/38-media-player.md) | **done** | Wave C. Native `<audio>`/`<video>` range-streamed via `downloadUrl` (no buffering), custom transport, folder queue + auto-advance, remount-per-track (no leaks). Registered 8 audio + 6 video exts. No new deps. Human-gated: playback/seek/queue |
| 39 | [markdown-editor](../briefs/done/39-markdown-previewer.md) | **done** | Wave C. Split-view md editor (react-markdown + remark-gfm, **no rehype-raw** = XSS-safe), full save flow (open intent / save hotkey / unsaved guard). `md`+`markdown` reroute from notepad (any root). No new deps. Human-gated: open/edit/save |
| 40 | [calendar](../briefs/done/40-calendar.md) | **done** | Wave C. Month + week views, persisted events (own store, no backend), reminders → `notify()` (second caller), "only while open" note. Todo coupling deferred. No new deps. Human-gated: CRUD/nav/reminder |
| 41 | [code-editor](../briefs/done/41-code-editor-monaco.md) | **done** | Wave D. Monaco, self-hosted (no CDN, workers via Vite `?worker`), fully lazy — eager bundle unchanged; multi-tab, find/replace, real-FS save. Code exts reroute here (notepad keeps txt/log). Deps: monaco-editor + @monaco-editor/react (lazy). Human-gated: open/tabs/save |
| 42 | [git-gui](../briefs/done/42-git-gui.md) | **done** | Wave D. Backend git module: execa array-args (no shell, `--` guard, LITERAL_PATHSPECS, jailed cwd, work-tree + top-level-in-jail check), status/stage/commit/diff/log; authed. 20 tests. **Security-reviewed** (no exploit; LOW ancestor-.git closed). No new dep. Human-gated: real repo ops |
| 43 | [rest-api-client](../briefs/done/43-rest-api-client.md) | **done** | Wave D. Owner-authed backend HTTP proxy — scheme allowlist per redirect hop, size/timeout/redirect caps, cookie/auth never leaked (+cross-host strip). Collections in home FS. 13 tests. **Security-reviewed** (safe as-is). SSRF stance in decisions.md. No new dep. Human-gated: send/persist |
| 44 | [archive-manager](../briefs/done/44-archive-manager.md) | **done** | Wave D. zip (fflate) + tar.gz (tar/execFile) extract/compress, every entry re-validated via `resolveSafe` (zip-slip-proof), temp+realpath walk, ratio-bounded caps (amplification-DoS fix) + hardlink guard; file-manager context menu. 13 tests. **Security-reviewed** (Medium+Low fixed). No new dep. Human-gated: extract/compress |
| 45 | [global-search-launcher](../briefs/done/45-global-search-launcher.md) | **done** | Wave E. CORE. Jailed+bounded backend FS search (`/api/files/search`, no symlink follow, caps + truncated, content grep opt-in), 9 tests; palette "Files" source + Taskbar Search button (palette store) + file-manager navigate-intent. Extends the palette, no fork. No new dep. Human-gated: search/reveal |
| 46 | [addon-manager](../briefs/done/46-addon-manager.md) | **done** | Wave E. CORE. Persisted per-user disabled-set + single `enabledApps` filter (Start/palette/Desktop), `openApp` guard, Settings "Apps" section; runtime keeps full registry; Settings/Files/Terminal non-disableable. No new dep. Human-gated: disable/enable/reload |

Dependency order: 08 ✓ → 09 ✓ → 10 ✓ → {11 ✓, 12 ✓, 13 ✓} → 14 ✓ → 15
(human-gated remainder). Restructure chain: 16 ✓ → 17 ✓. The post-v1
backlog (18 kiosk ISO, 19 → 20 office suite, 21 snipping tool, 22
preview pane) all landed 2026-07-17 in one orchestrated run — waves
{21 ‖ 22 ‖ 18-long-lane} → 19 → 20, one commit per brief, plus a
3-finder review pass whose confirmed findings were fixed and committed.
Captures in todos/: lint debt, office shared-helpers reuse debt,
notepad StrictMode intent bug.

## Where things stand

Engineering for v1.0 is COMPLETE: auth (10), terminal (11), files (12),
monitor (13), reskin (14), and brief 15's hardening slice — 73 unit + 29
e2e backend tests green, prod container verified for real (argon2-on-
Alpine confirmed, full auth flow over curl, 382 MB / 1.42 s / 41 MiB).
Remaining before the v1.0 tag, all human-gated: friend-run QA on a clean
machine, one VPS+HTTPS deploy per the Caddy recipe, the accent final pick
(crimson is provisional), and the recommended dep bumps
(@nestjs/platform-express for multer, axios) — though the brief-16
lockfile regeneration (2026-07-17) already audits clean (0 vulns).
Briefs 16 + 17 landed 2026-07-17: npm workspaces + turbo (one root
install, image 385 MB), then the core/add-ons restructure (7 add-on
packages, inverted registry, eslint-enforced boundary). Brief 17's
browser verification caught and fixed a shipping bug: the taskbar Tray
mis-typed /api/system/stats and white-screened the desktop after login —
a browser-level check is now part of the verify bar. Formatting debt is
paid (format:check 9/9 green); backend type-safety lint debt remains
(todos/lint-format-debt.md) and keeps root `npm run lint` red on
backend#lint only.

The 2026-07-17 backlog run landed the whole post-v1 slate in one
orchestrated session: preview pane (22), Snipping Tool (21), kiosk ISO
(18, KVM-boot-verified), office viewers (19), and office editors (20)
— the last after two mid-flight re-decisions: the Sheets engine moved
to an ExcelJS bridge when SheetJS CE failed the styling spike, and a
SuperDoc export defect (silent original-bytes save on docx missing
optional OOXML parts) was root-caused and fixed with an open-time
normalizer. The repo is now AGPL-3.0-only (SuperDoc). A three-finder
review pass over the cumulative diff confirmed and fixed a
shared-formula corruption in the xlsx bridge, a dirty-flag race in
both editors, a Slides stale-render interleave, a screenshot filename
collision, and an ISO post-install passwd comment/behavior mismatch.
The desktop now has 13 apps; the boot bundle is unchanged (all five
document engines are lazy chunks).

**2026-07-17 review + brief 23.** A 3-reviewer + verifier pass (security /
perf / code-smell) over the whole codebase produced 30 verified findings:
the safe subset — the dangerous security fixes (auto-Secure cookie, TOTP
step-up, WS Origin check, PTY session cap, throttle backstop, file-content
memory cap) plus perf/code-quality wins — was applied and committed
(backend 80 unit + 29 e2e green); the larger refactors were captured as
todos. The first of those, **brief 23 (shared-addon-kit)**, then shipped:
the office/add-on duplication (CS-1/2/8) and inconsistent confirm UX (CS-12)
are gone, deduped into `@imbatranim/core`. Still open as todos:
window-drag render perf (PERF-1), office parsing off-thread (PERF-6),
FileManager split (CS-3), notes/FilesService dedup (CS-7), first-run setup
hardening (SEC-2), CSP ws scoping (SEC-9), kiosk `--no-sandbox` (SEC-10),
the notepad StrictMode intent bug, lint debt, and add-on cleanup nits.

## 2026-07-17 — Daily-driver expansion backlog

A test-run + research pass ("what to build next for a daily driver — normal
users + web/low-level programmers, no gaming") captured a batch of app/platform
todos in `todos/`. All gates were green at the time (80 unit tests, typecheck
13/13, lint 0/0, clean build 9.1 s).

- **Shipped this run:** virtualize-long-lists → **brief 31**; the xlsx slice of
  office-parsing-blocks-ui-thread (PERF-6) → **brief 32**; and — its trigger met
  by Monaco landing this run — the held eager-bundle-lazy-load → **brief 33**
  (eager gzip 399.6 → 121.5 KB). All three committed, gates green.
- **Full-auto daily-driver backlog (briefs 34–46): COMPLETE (2026-07-18).**
  34 notification-center (CORE); Wave C light apps 35–40 (6-agent batch,
  `a7632ab`); Wave D heavy/backend 41–44 (4-agent opus batch + 3 adversarial
  security reviews + 4 hardening fixes, `4be1777`); Wave E platform 45–46
  (2-agent batch, `3e72333`). Desktop is **23 apps** (Wave E added CORE surfaces
  — a palette search source + a Settings "Apps" section — not new app windows);
  backend gained git / http-proxy / archive / files-search surface (all authed +
  jailed, **135 backend tests**). Every gate green at each commit; one commit per wave + a
  `docs(corpus)` per wave. The entire "everything actionable" scope the run was
  chartered with is now shipped.
- **Remaining = the human-gated exclusions only** (never in the auto-run's
  scope): SEC-9 `csp-connect-src-ws-wildcard`, SEC-10 `kiosk-no-sandbox`
  (browser/ISO-gated), and brief 15's v1-release remainder (friend QA, VPS
  deploy, accent pick, dep bumps, tag). Plus the per-brief human walkthroughs
  noted in each row above. These stay **human-gated — do NOT build
  autonomously.**

## 2026-07-31 — Improvement sweep: 3 production bugs fixed, briefs 52-86 written

Ran the OS locally + a scripted walkthrough of all 23 desktop icons. **Three
bugs live in the shipped artifacts**, all invisible in development — which is
why they survived review — fixed and merged: System Monitor's process table was
empty in every image (procps `ps` vs busybox → now a `/proc` walk); the Git app
was dead in container and ISO (`git` installed in neither); core's `Tooltip`
emitted nested `<button>`s across 33 sites. Also: the repo could not
`npm install` under its own declared npm 11, and `format:check` was red twice.
Backend 135→147. **Briefs 52-86 (35, ungrilled)** — 52-54 platform, 55-78 one per
app (all 24), 79-86 parity — are listed with their dependency order in
[backlog-2026-07-31.md](backlog-2026-07-31.md), rejections in
[real-os-gaps.md](real-os-gaps.md), house style in
[ui-conventions.md](ui-conventions.md).

## 2026-07-19 — Web browser + containerized dev pipeline (grilled)

Two briefs from a research+grill session ("add a web navigator"). Both **todo**.

- **Brief 50 — web browser (proxied-interactive): todo.** HARD. Tier-2 proxy
  via **Scramjet** (prebuilt dist, AGPL, no Rust); OS-capability housing
  (backend Wisp module + core SW/`<ProxyView>` + thin add-on); **auth-gate +
  SSRF filter** (blocks private ranges — the stricter opposite of brief 43);
  OS-level encrypted profile sync; thin MVP (Google + YouTube, reuse Bookmarks);
  DRM out. Scoped CSP additions (SEC-9). Depends on 51. Security-review gated.
- **Brief 51 — containerized dev pipeline + Dockerfile de-stale: todo.** MEDIUM.
  `npm run dev` → `docker compose --profile dev watch` (sync `apps/**`, ignore
  node_modules); de-stale the `deps`/`proddeps` manifest lists (7-of-24 rot —
  the real "contained" blocker); host tooling = Node/npm via `npm install
  --ignore-scripts`. Prod path unchanged. Unblocks brief 50.
