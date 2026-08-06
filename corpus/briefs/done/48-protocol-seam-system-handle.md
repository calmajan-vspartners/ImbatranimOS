# Brief 48 — The protocol seam: `@imbatranim/ui` split + injected `system` handle

Status: **todo** · From the 2026-07-19 OS-layering grilling
(the (b)/(c)/(d) drivers). CORE + all add-ons, frontend. **≥3 independent chunks
→ `plan-split-dispatch` candidate.** Depends on nothing, but ship **brief 47
first** (error boundaries are the cheap (c) win). Design:
[wiki/os-layering.md](../../wiki/os-layering.md#the-seam--an-injected-system-capability-handle).

## Problem

Apps weld themselves to core's in-process internals via `import { … } from
'@imbatranim/core'` (109 import sites). This is a compile-time binding: there is
no seam, so the (d) "feels like one React app" reality holds and the (c)/future
isolation path is blocked — you can't `import` a function across an iframe
boundary. The grilled fix: define the app↔OS **protocol** now as an **injected
`system` capability handle**, backed by the cheap in-process transport today, so
the transport can later swap to sandboxed-iframe postMessage **without rewriting
apps**.

## Decisions (grilled 2026-07-19)

- **Mechanism = injected handle (B), not narrowed imports.** The compositor
  passes each app a `system` object at mount; apps import **nothing** from core.
  The `SystemHandle` TS interface **is** the versioned protocol spec.
- **Barrel bisection by "can it cross postMessage?"**
  - **Library (`@imbatranim/ui`, build-time import, NOT a capability):**
    `Button, Input, Checkbox, Dialog, Select, ScrollArea, Tooltip, ConfirmDialog,
    PromptDialog, cn` + pure-client hooks `useVirtualList, useSaveHotkey,
    useUnsavedGuard, createOpenedFileStore`.
  - **Capabilities (on `system`):** `system.fs`
    (`read/write/upload/download/fileName` — the file-bytes group), `system.http`
    (authed backend client `api`, **escape hatch** — an app's own routes, behind
    `SessionAuthGuard`, per-app restrictable later), `system.window` (app-facing
    `windowStore` subset: set title, request close, resize, focus, mark-dirty),
    `system.intents` (`openApp` + open-with + `useOpenIntent`), `system.notify`,
    `system.on(event)` for compositor→app events `focus/blur/visibilitychange/
    close-request`.
- **Migrate incrementally behind a compat shim** — no big-bang. Un-migrated apps
  keep working while the barrel still re-exports capability shims that delegate to
  the handle impl.
- **Prove on one app first:** sticky-notes (small, representative), then
  file-manager (heaviest: fs + intents + window) as the stress test. If the
  protocol survives file-manager, it survives everything.
- **Enforce with eslint at the end:** forbid capability imports from
  `@imbatranim/core`; only `@imbatranim/ui` + the injected `system` allowed.
- **Not in scope:** iframe/worker transport (gated on third-party apps), the
  raw-surface/WebGPU primitive (parked), a package/manifest install lifecycle
  (`manifest.ts` stays the registration point), any backend change (the syscall
  API is unchanged — `system.fs`/`system.http` wrap the *existing* endpoints).

## Fix (chunks — independently dispatchable)

1. **Extract `@imbatranim/ui`.** New workspace package; move the ~70
   component/hook exports out of core's barrel into it; core re-exports from
   `@imbatranim/ui` temporarily (compat) or apps re-point directly. Mechanical,
   no behavior change. Verify build/typecheck green before proceeding.
2. **Define `SystemHandle`.** New `apps/core/src/system/SystemHandle.ts` — the
   versioned interface (`fs`, `http`, `window`, `intents`, `notify`, `on`) with a
   `PROTOCOL_VERSION`. This file is the protocol spec; treat additions as API
   decisions.
3. **In-process implementation + `SystemProvider`.** Implement the handle over
   the existing stores/libs (`fileBytes`, `windowStore`, `intentStore`,
   `notificationStore`, `axios` `api`); wire a per-app instance (scoped to the
   window id, so `system.window.*` targets the app's own window) and inject it at
   the app mount point in the window renderer via a React context +
   `useSystem()` hook.
4. **Compat shim.** Keep the old capability exports on `@imbatranim/core`
   delegating to the handle impl, so un-migrated apps build and run unchanged.
5. **Migrate sticky-notes** to `useSystem()` — remove its capability imports;
   validate the full surface it touches. Then **migrate file-manager** (fs +
   intents + window stress test); fix any protocol gaps found *in the interface*,
   not with per-app escape hatches.
6. **Migrate the remaining apps** one at a time (each is small); drop capability
   imports as each is done.
7. **Flip eslint + remove the shim.** `no-restricted-imports`: capabilities from
   `@imbatranim/core` are forbidden in add-ons (only `@imbatranim/ui` + injected
   `system`); delete the compat shim once all apps are migrated.

## Must preserve (regression surface)

- Every app behaves identically after migration — same FS ops, same window
  behavior, same intents/open-with, same notifications.
- `system.window.*` acts on the **calling app's own window** (per-window scoping),
  never a global stomp.
- `manifest.ts` stays the only add-on import site in core; the add-on↔backend seam
  is still the HTTP API (no backend change).
- Error boundaries (brief 47) remain intact around each migrated app.
- The barrel split doesn't grow the desktop boot bundle (UI kit was already
  imported; lazy-load boundaries from brief 33 preserved).

## Verify bar

Per chunk: `turbo typecheck`, lint + format, `turbo build` green. After the two
proof apps: they run with **zero** `@imbatranim/core` capability imports. Final:
eslint rule active, compat shim deleted, all 23 apps migrated, full suite green.
**Human-gated:** open each app from Start, exercise its core action (edit a
sticky, browse + open a file, etc.), confirm no regression; confirm two tabs no
longer stomp each other's window layout (the (b) fix — note: the ephemeral-session
half is its own follow-up if not folded in here).

## Outcome — done 2026-08-06

Shipped in full: the `@imbatranim/ui` split, the versioned `SystemHandle`
protocol, per-window injection, **all 26 apps migrated**, the eslint flip, and
the compat surface deleted. Core's public barrel is now the add-on contract's
**types and nothing else** — a value export there is a hole in the seam, and
eslint in every add-on rejects one (verified by planting a value import and
watching it fail; type-only passes).

### The shape, where it differs from the brief, and why

**The protocol lives in the SDK, not in core.** The brief puts the spec at
`apps/core/src/system/SystemHandle.ts`. It lives in `packages/ui/src/system.ts`
instead, because both sides must resolve the *same* React context: the
compositor provides into it, apps and SDK hooks read from it, and neither may
import the other. The SDK owning the protocol also makes the eslint rule
absolute — "no value imports from core, full stop" — instead of "except the
context hook".

**The file dialog became a portal capability.** The brief's ui-library list
includes the dialog hooks; they are capability-consuming (the old
`useFileDialog` reached the FS through core), so they could not move as pure
library. Rather than dragging FilePicker + react-query + lucide into the SDK,
`system.fs` grew `pickOpen/pickSave/pickDirectory` — the xdg-desktop-portal
analogue: the OS renders its one dialog at the desktop root, the app awaits pure
data. Seventeen apps used to each carry a `{fileDialog}` JSX line whose absence
silently broke the dialog; that failure mode is deleted. The SDK's
`useFileDialog` keeps the old call shape on top of the portal, and pickers that
must NOT latch a document (markdown-editor's asset insert, norpdf's merge
source) call `pickOpen` directly.

**Three namespaces the brief did not list, added as API decisions:**
`system.shortcuts` (register = bind + document in one call; the registry is
compositor state), `system.appearance` + an `appearance-changed` event (the
Terminal and Monaco drive non-DOM surfaces from the theme), and
`system.schedule` (brief 93's cross-tab occurrence claim). Two smaller
additions came out of the migration itself: `data` on the http request config
(git-gui's DELETE carries a body) and `ctx: CommandSourceContext` on
`CommandSource.search` (palette sources are registered statically from the
manifest and run with no mount — the palette hands them capabilities, because
they can never call `useSystem()`).

**Scope is the security model, and it found real design flaws.** `notify` has
no appId field any more — the handle stamps the app it was minted for, so an
app cannot toast in another's name (the old free import happily allowed it).
That immediately surfaced a legitimate cross-app case: File Manager recorded
OS recents *attributed to the app it launches* (open a `.md` → recent for
markdown-editor), which self-stamping rightly forbids. Moved into core's
`openApp`: the shell records "file X opened with app Y" at the one choke point
every launcher shares, and the app-side calls are deleted.

**Windowless handles.** Background services, desktop layers and widgets get a
handle with `windowId: null` and a null-object window (reads inert, writes
dev-warn) — notifications carry the right appId and `schedule`/`http` work,
while nothing can crash a service by touching window state it does not have.

### How it went in

Seven commits, gates green at every step: the package split (core keeps
one-line re-export shims so its ~200 internal `cn` imports never moved), the
protocol + injection + 10 scoping tests, sticky-notes as proof (including the
windowless desktop-notes path, verified in the browser), file-manager as the
stress test (the brief-81 probes pass through the handle unchanged), then the
remaining 24 apps **via a parallel agent fan-out** — one agent per app,
disjoint directories, a shared recipe distilled from the two proof apps, every
result returned as structured data. The fan-out hit the session's usage cap
13 apps in; after the quota reset, the workflow resumed with the finished 11
replayed from cache. Every agent's per-app gates were then re-verified
centrally, twice (all 119 turbo tasks).

### What the flip exposed

pdfcore-engine's `isNodeEnvironment()` referenced the bare `process` global and
had only ever type-checked through an incidental import-graph leak into
`@types/node`; the barrel shrink closed the leak and tsc told the truth. Now
reads via `globalThis` with a local type — also the honest runtime shape.

### Verified

119/119 turbo tasks; backend unit 423, e2e 141; frontend vitest 1292 (protocol
scoping, SDK failure-text + report with a fake handle, windowStore cleanup
retargeted to what the compositor still owns). **Boot bundle byte-identical
before and after the flip** — 36,476 KB dist, 396 KB entry chunk — which is the
brief's no-growth bar met exactly.

In the browser, production bundle behind the real backend: **all 29 apps open
clean from search with zero page errors** (the single "failure" was the palette
ranking a live bookmark link above the Bookmarks app entry — those live results
are themselves the migrated command source working through `ctx.http`), plus
the four regression probes: both brief-81 default-apps probes, the sticky-notes
seam probe, and brief 82's startup probe. 

### Deferred / recorded

- The iframe/postMessage transport stays gated on third-party apps, as designed.
  `window.onCloseRequest`'s synchronous veto is the one protocol member that
  transport must renegotiate; the spec file says so at the member.
- The SDK's opened-file latch is private to it, so `closeWindow` no longer
  clears it: a closed window's record is a few orphaned bytes keyed by a uuid
  that never recurs. Documented at the site, accepted.
- rest-api-client persists its collections JSON via raw `/files/content` over
  `system.http`; migrating that onto `system.fs` (bytes-shaped) is a follow-up
  if the raw route is ever closed off.
- `@imbatranim/!(core)` in the add-on eslint configs does not actually match
  scoped siblings in practice (pre-existing); the seam rule that matters is the
  new type-only restriction, which is verified to fire.
