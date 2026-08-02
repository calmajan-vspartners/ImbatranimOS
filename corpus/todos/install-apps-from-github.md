---
title: Install apps from a GitHub URL (third-party app package manager)
created: 2026-07-20
status: captured
tags: [core, platform, add-on, backend, security]
---

# Install apps from a GitHub URL (third-party app package manager)

Paste a GitHub repo URL, press **Install**, and the OS `git clone`s it into the
home FS, builds it, and adds it to the desktop as a runnable app — no rebuild of
ImbatranimOS itself. The motivating use case is installing **games built with
the custom game-engine** (`~/projects/game-engine` — Farm Valley, Citadel,
Hollow), but the format is open: any repo that "respects our format" installs
the same way. This is the "sandboxed native/third-party app store" that
[decisions.md](../wiki/decisions.md) named as a *possible future brief, out of
v1 scope* — this todo is that brief's seed.

## Why this is hard (the core tension)

Today an app is a **build-time** workspace package: TS/React under
`apps/add-ons/<name>`, imported once in `apps/core/src/manifest.ts`, compiled
into the desktop bundle. A GitHub-installed app **cannot** be compiled into an
already-built, already-running bundle. So runtime install is only possible over
the **iframe / postMessage transport** the OS already committed to in
[os-layering.md](../wiki/os-layering.md): the installed app is a *self-contained
web bundle* loaded in a sandboxed `<iframe>`, talking to the OS through the
injected `system` (`SystemHandle`) capability handle over postMessage — it
imports nothing from core. **This todo is the concrete thing that "gates" the
hard-sandbox transport swap** the layering design was built to enable
(briefs 47–49). It is not a new architecture; it is the payoff of the existing
one.

## Prior art (2026-07-20 research pass)

- **daedalOS** — third-party apps via a controlled iframe + postMessage/
  BroadcastChannel API, with worker / QuickJS sandbox runtimes. Confirms the
  iframe+postMessage direction we already locked.
- **Puter** — a self-hostable web OS with a publish-to-App-Store model. Confirms
  the demand but is heavier than our slim-container identity wants; we stay
  build-from-source, no registry.

Neither ships "install straight from a GitHub URL" as a first-class flow — so
that framing (URL in, cloned + built + registered) is ours to define.

## Sketch of the flow

1. User pastes a repo URL in an installer UI (Settings pane or a dedicated
   "App Store" app), presses Install.
2. Backend reads a **repo-root manifest** (e.g. `imbatranim-app.json`) to learn
   id / name / icon / type / build — the "our format" contract below.
3. Backend `git clone`s into an apps store dir under `$HOME` so it survives on
   the named volume (`~/.imbatranim/apps/<id>` app-managed, **or** an os-fs
   `Projects/` subdir if we want it user-visible — open question).
4. Build step produces a static `dist/` (see the prebuilt-vs-build fork below),
   run through the existing unprivileged exec plumbing — `imbatranim`, no sudo,
   Node/npm already in the image.
5. Backend serves that `dist/` on a per-app static route (session-authed like
   everything else); the app is written to a persisted **installed-apps
   registry**.
6. The desktop registers each installed app as an `AppConfig` whose component is
   an **iframe-host wrapper** bound to the served URL, and opens it in a window.

## The manifest format ("our format")

A declarative repo-root file — the thing a repo owner adds to be installable:

- `schemaVersion`, `id`, `name`, `description`, `meta[]` (search keywords).
- `type`: `static` (client-only bundle) **vs** `service` (needs a long-lived
  backend process) — see archetypes below.
- `build`: `{ command, outputDir }` — or omit if shipping a prebuilt `dist/`.
- `window`: `defaultSize` / `minSize` (mirrors `AddonManifest`).
- `capabilities[]`: which `SystemHandle` surfaces it may use (`fs`, `http`,
  none) — feeds the per-app capability restriction os-layering anticipated.
- `icon`: **must be declarative** — a bundled image / data URL / named lucide
  icon. The current `AddonManifest.icon` is a React `ComponentType`, which
  **cannot cross the postMessage boundary**; third-party manifests can't ship a
  React component, so the installed-app record needs a different icon shape than
  the build-time contract. (Same for `component`: there is no component to
  import — it's "load this URL in an iframe.")
- `minSystemVersion`: the `SystemHandle` protocol version it targets.

## Two app archetypes (from the real game-engine)

- **Static / client-only** (e.g. **Hollow** — `client` + `sim-core`, sim runs
  in-browser, `vite build` → static `dist/`). Easy: serve `dist/`, host in
  iframe. **Start here.**
- **Client + server** (e.g. **Farm Valley**, **Citadel** — a Node sim server
  streaming snapshots over a WebSocket on its own port). Needs the OS to
  **spawn and supervise a long-lived per-app process**, allocate a port,
  restart on crash, bound resources, and **proxy its WebSocket behind session
  auth** (the `http-proxy` module + PTY are the raw materials; there is
  deliberately no session-manager daemon today — kill-list). Much bigger lift;
  **defer to a second phase.**

## Constraints to respect when this is grilled into a brief

- **Reopens a locked kill-list item.** decisions.md lists *"runtime package
  manager (`manifest.ts` is it) — NOT built."* This todo reverses that. Per
  corpus rules a locked decision is never quietly flipped: needs an explicit
  `decisions.md` revisit + a `log.md` entry before any brief ships.
- **This is the threat-model flip.** os-layering's isolation stance is
  *"first-party = buggy, not malicious."* Installing arbitrary GitHub repos
  makes apps **potentially malicious** — the exact condition it said hard
  sandboxing was "gated on." Non-negotiables: strict `<iframe sandbox>`, no core
  imports, all OS access via capability-restricted `SystemHandle` postMessage.
- **Building a repo = executing untrusted code** in the container as
  `imbatranim`. Unprivileged, but still arbitrary code exec. Decide the trust
  gate: explicit consent + clear warning for a first cut; curated allowlist /
  "tap" later. **Strong recommendation:** favor **prebuilt-`dist`-only** for v1
  (repo ships the built bundle; OS runs *no* build script) — it removes
  build-time code exec entirely and keeps the image slim. Building-on-install is
  the heavier, riskier path.
- **No sudo, no new Linux packages** (project invariant). npm build only; a repo
  needing native/system deps fails — and that's correctly on-identity.
- **Auth everywhere** (project invariant): served bundles and any proxied WS sit
  behind session validation; no unauthenticated app routes.
- **CSP interaction**: per-app served origins + per-app WS proxying touch the
  already-flagged [csp-connect-src-ws-wildcard](csp-connect-src-ws-wildcard.md)
  work — tighten together, don't widen the wildcard further.
- **Persistence**: installed-apps registry in the SQLite DB or a `$HOME` dotfile
  so it survives container recreation on the volume. Uninstall = stop process +
  rm clone + deregister; update = `git pull` + rebuild.
- **Pairs with** [addon-manager](promoted/addon-manager.md): that todo adds a per-user
  enable/disable filter over the roster; installed apps flow through the same
  filtered registry rather than a parallel one.
- **Reinforces** build-from-source identity (clone + build, no registry) even as
  it reopens the package-manager kill-list.

## Open questions (for the grilling)

- Clone location: hidden `~/.imbatranim/apps/` (app-managed) vs user-visible
  os-fs `Projects/`?
- Phase 1 scope: static/client-only iframe apps only (Hollow-style), deferring
  the service-process supervisor for Farm/Citadel to phase 2? (Recommended.)
- Prebuilt-`dist` contract vs build-on-install? (Recommended: prebuilt for v1.)
- Trust model: open install of any URL + consent gate, vs a curated allowlist?
- Manifest discovery: raw file on the default branch vs a release/tag asset?

Motivated by the user wanting to install their own game-engine games onto the
desktop from GitHub, 2026-07-20.
