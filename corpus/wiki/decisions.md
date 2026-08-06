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

## Web-OS era + Office/post-v1 decisions (2026-07-16 / 07-17)

Moved to [decisions-pivot-era.md](decisions-pivot-era.md) on 2026-08-05 when this
page passed its 200-line cap. Those calls are **still locked** — the split is
housekeeping, not a revisit. They are the foundational pivot-era set: the
single-container shape, the add-on contract, the locked identity, the app roster,
and the Office-suite scope.

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

## 2026-08-05 — Git: what the allowlist may grow into (brief 76)

The git backend has one `execa` seam, array args, no shell, a `--` pathspec guard
and a jailed cwd, and it was adversarially security-reviewed. Brief 76 extended the
**subcommand allowlist** — the first extension since that review — so the rules it
adds are locked here rather than re-derived per brief.

- **A ref is not a pathspec, and `--` cannot protect it.** `--` separates options
  from *pathspecs*; there is no equivalent for `git switch <name>`, so a branch name
  beginning with `-` would be read as a flag. Every ref-shaped input therefore goes
  through `assertRefName` (git's own `check-ref-format` rules, enforced in-process)
  and is **refused before it becomes an argument**. Reusing the pathspec guard would
  be wrong: that one permits `-` and `..` on purpose.
- **A ref is never composed from client text.** `stash@{n}` is built from a
  validated integer. If a future brief needs `HEAD~n` or a tag, it builds it the same
  way — the client names an item, never a revision expression.
- **Per-hunk staging is `git apply --cached` with the patch on stdin**, and the
  safety is git's default path handling, **measured** on git 2.43: a patch naming
  `../outside` is refused with "does not exist in index", one naming `../../etc/x`
  with "invalid path". Therefore **`--unsafe-paths` must never be passed**, and a
  test asserts its absence in the arg array. `--cached` also means a bad patch can
  only reach the index, never a file the user has open.
- **Stdin is now part of the seam** (`exec(cwd, args, input?)`), and is the only
  channel for large client-supplied text. A patch must never become an argument or a
  temp file.
- **No server-side dirty-tree block on a branch switch.** Considered and rejected as
  a departure from brief 76's wording: git already refuses a switch that would
  overwrite local changes, and deliberately allows one that carries clean changes
  across — a normal, safe, very common workflow. Blocking it would make the app worse
  than the Terminal it exists to save you from. The **warning** lives in the UI; git's
  refusal is surfaced verbatim.
- **Discard is tracked files only** (`restore --worktree`). Discarding an untracked
  file means *deleting* it, which is `git clean` — a different and more dangerous
  verb, deliberately not in the allowlist. The user is told that plainly instead of
  getting a silent no-op.
- **Push / pull / fetch stay out, and this is a decision, not a gap.** They need a
  credential living in the container and an outbound path — where the secret lives,
  how it is encrypted, and what an XSS in another app could reach. That deserves its
  own grilled brief alongside brief 50's SSRF stance. The Terminal is a real shell for
  anyone who needs to push today.
- **Rejected here, unchanged:** merge-conflict resolution UI (large, subtle; Terminal
  + Code Editor covers it) and a history graph with topology (substantial work for a
  single-user local browser).

## 2026-08-06 — code-health sweep (brief 93)

- **Frontend `strict` is ON and stays on.** All 23 add-ons (`apps/add-ons/tsconfig.base.json`)
  and core (`tsconfig.app.json`) now compile under `strict`; the backend runs
  `noImplicitAny`. Enabling them was a zero-error no-op — the code was already
  compliant. Do not weaken these back; a green typecheck is now a real signal.
- **Backend stays on TS 5.7 / eslint 9 for now (T3-8 deferred, not rejected).** A
  bump to TS 6 / eslint 10 is a genuine migration (strictPropertyInitialization,
  jest global resolution, ts-jest `rootDir`), not a version change — it earns its
  own brief. The frontend was already unified on TS 6 / eslint 10.
- **turbo: core consumes add-on sources via `inputs`, not `dependsOn`.** core's
  manifest imports every add-on while add-ons import core — a package cycle a
  topological `^` cannot sort. A core-scoped `apps/core/turbo.json` lists
  `../add-ons/*/src/**` + `../../packages/*/src/**` as build/typecheck/test inputs
  so core's hash tracks add-on edits (was silently stale). Don't add core→add-on
  package deps to "fix" this — it recreates the cycle.
- **Fonts are self-hosted; the CSP is `'self'`-only for font/style.** Space Grotesk +
  Inter are vendored (latin variable woff2 in `apps/core/src/assets/fonts`); the
  Google Fonts `@import` and its `fonts.googleapis.com`/`gstatic.com` CSP entries
  are gone. Don't re-add a font CDN — it breaks the offline kiosk and leaks visitor IPs.
