---
summary: The OS-as-layers design (2026-07-19 grilling) — three layers (kernel/userland ↔ compositor/display ↔ apps), an injected `system` capability handle as the app↔OS protocol seam, the `@imbatranim/ui`-library vs capabilities bisection, and the kill-list of real-Linux daemons we deliberately do NOT build. BUILT 2026-08-06 (brief 48) — the seam is live in all 26 apps and eslint-enforced.
updated: 2026-08-06
---

# OS layering — the compositor seam

Outcome of the 2026-07-19 architecture-direction grilling (promotes the
`os-architecture-layering-research` todo). This page is the design; the locked
calls are in [decisions.md](decisions.md#2026-07-19--os-layering--the-compositor-seam),
the specs are briefs 47–48.

**Headline:** this design reopens **zero** locked decisions — it *reinforces*
them. The client-rendered desktop is confirmed and strengthened (the compositor
is client-side by physical necessity); single-container, build-from-source,
no-sudo, and first-party apps are all untouched. The only genuinely new choice
is the session/dotfile split, which *fixes* a bug rather than reversing a lock.

## Why (the real drivers, grilled)

Not functional pain in the app layer — v1 works (23 apps, 135 backend tests).
The drivers are:

- **(b) SSH-session feel** — "each browser tab = a new session." Today all tabs
  share one origin `localStorage`, so two tabs **stomp each other's** window
  layout. That is the opposite of SSH.
- **(c) App isolation** — a faulty app must not take down the whole OS.
- **(d) Soul** — it should *feel* like an OS, not one React app doing
  everything. This is an identity driver, and it's legitimate for this project
  ("the OS is real, not simulated"), but it must stay minimal and pure, not
  heavy machinery.

## The three layers

| Layer | What it is | Where it runs | Status |
|---|---|---|---|
| **1. Kernel + userland** | The container's real Linux kernel + Alpine userland (bash, coreutils via PTY). NestJS backend = the **syscall bridge / init** — the only path to touch the real system (FS, PTY, `/proc`, HTTP proxy). | Server | Already exists; we just name it honestly |
| **2. Compositor + display** | The browser tab is the **physical display** (pixels, GPU, input). Core's window manager is the **compositor** — window chrome, z-order, focus, input routing, taskbar. | Client | Exists as `windowStore` + window-manager; we formalize it |
| **3. Apps** | Clients. Each speaks **two** protocols: the **compositor protocol** (client, in-process now → iframe/worker later) for windows/input/focus, and the **syscall API** (HTTP/WS) for FS/PTY/system. | Client (+ backend routes) | Migrating off direct core imports |

The compositor is client-side **by necessity**: rendering happens in the
browser. A server-side compositor means VNC/pixel-streaming, which violates the
slim-image + real-DOM soul. The authoritative server streams **data** (PTY
bytes, FS, `/proc`), never pixels.

## The seam — an injected `system` capability handle

**DONE 2026-08-06** — [brief 48](../briefs/done/48-protocol-seam-system-handle.md),
whose outcome note carries the full detail. The load-bearing refinements: the
protocol spec lives in the **SDK** (`packages/ui/src/system.ts`, so both sides
resolve one context and the eslint rule is absolute — zero value imports from
core, type-only allowed); the file dialog became a **portal capability**
(`system.fs.pick*`, xdg-desktop-portal style — 17 apps' `{fileDialog}` render
line deleted); three namespaces were added as API decisions (`shortcuts`,
`appearance`, `schedule`) plus `ctx` on `CommandSource.search`; `notify` lost
its appId field (the handle stamps it), which pushed recents-recording for
launched files into core's `openApp`; and windowless handles serve background
services, layers and widgets. Boot bundle byte-identical across the flip; all
29 apps verified opening clean in a production build.

The mechanism (grilled option **B**, not "narrowed imports"): the compositor
hands each app a **`system` handle** at mount. The app **imports nothing from
core** — it only receives this handle (its "connection to the compositor," like
a Wayland client connection or VS Code's `ExtensionContext`). Because it's an
*object passed in*, the same app code works whether the handle is backed by
**direct calls** (now) or **postMessage to a sandboxed iframe** (later). Swap
the transport, the app never changes. That is the foundation this whole todo
exists to buy.

The `SystemHandle` TypeScript interface **is** the protocol spec — one versioned
document of exactly what an app may do (which also serves the (c) capability
story).

### The bisection rule

Today's monolithic `@imbatranim/core` barrel splits in two by an objective rule:
**can it travel over postMessage?**

- **No (a component or render hook) → it's a library.** `@imbatranim/ui`:
  `Button, Input, Checkbox, Dialog, Select, ScrollArea, Tooltip, ConfirmDialog,
  PromptDialog, cn` + pure-client hooks (`useVirtualList, useSaveHotkey,
  useUnsavedGuard, createOpenedFileStore`). Build-time import, **not** a
  capability, never crosses the seam. Like linking GTK/libc. In the future
  iframe world each sandboxed app bundles it (or shares a chunk).
- **Yes (a data call or an effect) → it's a capability on the handle.**

### The `system` handle surface

| Namespace | Contents | Maps to |
|---|---|---|
| `system.fs` | `read / write / upload / download / fileName` (the file-bytes group) | kernel syscalls |
| `system.http` | authed backend client (`api`) for the app's **own** backend routes | kernel syscall channel — **escape hatch** (see below) |
| `system.window` | app-facing subset of `windowStore`: set title, request close, resize, focus, mark-dirty | compositor protocol |
| `system.intents` | `openApp` + open-with + *receiving* open intents (`useOpenIntent`) | shell / compositor |
| `system.notify` | notifications | compositor |
| `system.on(event, …)` | compositor→app events: `focus`, `blur`, `visibilitychange`, `close-request` | compositor events |

`system.http` is the one **escape-hatch** capability: prefer typed capabilities
(`system.fs`, …); `system.http` covers an app calling its own backend module
(still behind `SessionAuthGuard`, fine because all apps are first-party). It is
deliberately designed to be **restrictable** — the day third-party apps arrive,
it becomes the per-app permission you gate in the manifest.

## Sessions vs dotfiles (the one new decision) — brief 49

**DONE 2026-08-06** — [brief](../briefs/done/49-ephemeral-session-durable-dotfiles.md).
One refinement to the decision below, made while building and recorded here
because the wiki is where the design lives: the session is **per-tab
`sessionStorage`, not in-memory**. Same boundary, one more property. Under this
page's own SSH analogy, closing the tab is logging out and reloading is the
terminal redrawing — so a refresh should not lose the arrangement, and
`sessionStorage` is exactly that line. It is still per-tab, still fresh on a new
tab, still gone with the tab, and still needs no server state, no reattach and no
GC. "In-memory" would have cost the single-tab user their whole layout on every
refresh to fix a two-tab problem.

The dotfile half gained one too: the server is the source of truth, with
`localStorage` kept as a **first-paint cache**. `main.tsx` brands the very first
paint — the lock screen — synchronously, and that happens *before* authentication,
so there is no server to read at the moment the value is needed.

- **Session = ephemeral, per-tab window layout.** Pure-SSH: new tab =
  fresh desktop; close tab = its windows are gone; no server-side session
  persistence, no reattach/GC. This kills the shared-`localStorage` bug — each
  tab holds its own session, nothing shared. (tmux-style
  detach/reattach is explicitly a *possible future* brief, not v1.)
- **User config = durable dotfiles.** Wallpaper, accent, desktop icon positions,
  pinned taskbar items are **not** session state — they're `$HOME` dotfiles:
  persisted server-side (SQLite in the home volume, which auth already owns) and
  shared across all sessions, exactly like `.bashrc` across SSH logins.

## The kill-list — real-Linux concepts we deliberately do NOT build

Borrowing from Linux is half insight, half cargo-cult. We refuse:

- **No runtime package manager** (apt/apk for desktop apps). Single user,
  build-from-source; `manifest.ts` **is** the package system. A package
  format / install lifecycle / registry only earns its cost when apps come from
  *outside* the repo — see [decisions.md app-install stance].
- **No separate session-manager daemon** (systemd-logind / SDDM analog). The
  auth module + the per-tab ephemeral session **is** the session manager. Don't
  build a second thing.
- **No app-to-app IPC bus** (D-Bus analog). Star topology: apps talk to the
  compositor and the kernel, never to each other. Coordination goes through the
  kernel (shared files) or the compositor (intents).

## App isolation — threat model, and what it justifies

Apps are **first-party for the foreseeable future** (in-repo, build-time,
`manifest.ts`-composed). So the threat is a *buggy* app (a `throw`, an infinite
loop), **not** a *malicious* one. That is cheaply contained with **per-window
React error boundaries + main-thread hygiene** — brief 47. No iframes today.

**Brief 47 is DONE (2026-08-06)** —
[brief](../briefs/done/47-per-window-error-boundaries.md). The boundary sits
*inside* the window frame, so a crashed app keeps a title bar that drags and a
close button that works; Reload is a **key change**, not a state reset, because
clearing the error in place re-renders the state that just threw. Crash toasts
are deduped per app so a render loop cannot bury the one message that matters.
The half it explicitly does **not** solve is unchanged and still true: an
error boundary catches throws, not hangs, and a spinning app still freezes the
tab. That needs the transport swap below, not a watchdog.

Hard sandboxing (sandboxed iframes / workers, real crash + security isolation)
is the **transport swap** of the `system` handle, and is **gated on third-party
apps actually arriving** — not built speculatively. The seam is designed so that
swap needs no app rewrites.

## Deferred (parked, not rejected)

- **DOM vs canvas/WebGPU substrate.** DOM stays the substrate (text/a11y/IME +
  the DOM-hosted app libraries — Monaco, xterm, pdfjs, Univer, SuperDoc — settle
  it; the browser is already a GPU compositor). Revisit later:
  (1) a **raw-surface primitive** in the compositor protocol for canvas-native
  apps (a game, a 3D viewer, or Farm Valley-as-an-app) — Wayland's "attach a
  buffer"; (2) an optional **WebGPU effects overlay** (blur/CRT/transitions), the
  same pattern as the game-engine's `tint`/`overlay-2d` passes — garnish on top,
  never the substrate. **Constraint kept now:** the protocol must not foreclose a
  raw-surface primitive.

## Migration sequence (briefs 47–48)

1. ~~**Error boundaries first** (brief 47, standalone) — banks the (c) win at
   near-zero cost, no API change, independent of the seam.~~ **Done 2026-08-06.**
2. **Extract `@imbatranim/ui`** — mechanical move of the ~70 component/hook
   exports; apps re-point imports.
3. **`SystemHandle` + in-process impl + `SystemProvider`** at each app mount +
   a **compat shim** so un-migrated apps keep working.
4. **Migrate one app first** — sticky-notes (small, representative) to prove the
   mechanism, then file-manager (heaviest capability user: fs + intents +
   window) as the stress test.
5. **Flip eslint** — forbid capability imports from core; only `@imbatranim/ui`
   + the injected `system` allowed. Enforces the seam so it can't rot.

Steps 2–5 are brief 48.
