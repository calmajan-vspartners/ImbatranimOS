# Brief 47 — Per-window error boundaries (a faulty app can't take down the OS)

Status: **done 2026-08-06** · From the 2026-07-19 OS-layering grilling
(the (c) isolation driver). CORE, frontend-only. Standalone — **no dependency on
the protocol seam (brief 48)**; ship it first. Design:
[wiki/os-layering.md](../../wiki/os-layering.md#app-isolation--threat-model-and-what-it-justifies).

## Problem

Every windowed app renders directly into core's shared React tree. A single
uncaught `throw` in one app's render/effect currently unmounts the whole desktop
(only React's default behavior stands between a buggy app and a blank screen).
The grilled (c) requirement is explicit: **a faulty app must not take down the
OS.** Apps are first-party (build-time), so the threat is a *buggy* app, not a
*malicious* one — which an error boundary fully addresses, at near-zero cost and
with no API change.

## Decisions (grilled 2026-07-19)

- **Per-window boundary, not per-desktop.** Wrap each window's app content
  (inside the window chrome) in its own React error boundary. A crash collapses
  **that window** into an in-chrome error state; the taskbar, other windows, and
  the shell keep running.
- **Error state = recoverable, in-chrome.** Show a compact "This app crashed"
  panel *inside the window* with a **Reload** (remount the app, fresh key) and a
  **Close window** action. The window chrome (title bar, close button, drag,
  z-order) is owned by the compositor and stays functional — it is *outside* the
  boundary.
- **Boundary wraps app content only**, never the chrome — so a crashed app can
  always still be closed/moved/focused.
- **Report to the notification center.** On catch, emit one `notify(...)`
  (error level: "<App> crashed") so the failure is visible even if the window is
  behind others. Deduplicate rapid re-throws (don't spam on a render loop).
- **Main-thread hygiene note (not a hard gate this brief):** an infinite loop
  still freezes the tab — error boundaries catch throws, not hangs. True
  hang-isolation is the future iframe/worker transport swap (brief 48's seam
  makes it possible), explicitly out of scope here. Document the limit; don't
  attempt a watchdog.
- **This is not the seam.** No `system` handle, no barrel split — purely a
  containment wrapper. Apps are untouched.

## Fix

1. New `apps/core/src/shared/components/AppErrorBoundary.tsx` — a class error
   boundary (React requires a class): `componentDidCatch` → `notify` (deduped) +
   set error state; renders children normally, or the error panel on catch.
   Props: `appId`, `appName`, `onReload` (remount via key bump), `onClose`.
2. New `apps/core/src/shared/components/AppErrorFallback.tsx` — the in-chrome
   panel (uses `@imbatranim/core` UI kit: a heading, the error message, Reload +
   Close buttons). Keep it tiny; no stack dump in the default view (optional
   "details" disclosure for the raw message).
3. Window renderer (the `WindowContainer` / per-window render point identified in
   `windowStore` consumers) — wrap the app component in `<AppErrorBoundary>`.
   **Reload** = bump a per-window remount key (regenerate the child key so the
   app re-mounts clean); **Close** = existing `windowStore` close action.
4. Boundary key resets on successful remount so a fixed/reloaded app clears the
   error state.

## Must preserve (regression surface)

- Window chrome (drag, resize, focus, close, z-order, taskbar button) works for a
  crashed window — the boundary is *inside* the chrome, not around it.
- A crash in one window leaves every other window + the shell fully interactive.
- No change to how apps are declared or to any app's code; `manifest.ts`
  untouched. This is a pure wrapper at the render point.
- Notification center still behaves (one deduped error toast per crash, not a
  storm on a render loop).

## Verify bar

`turbo typecheck`, core lint + format green, `turbo build` ok. A unit/RTL test
that a child throwing renders the fallback (not a thrown-through unmount) and
that Reload remounts. **Human-gated:** deliberately break one app (temporary
`throw` in an add-on's render), confirm only its window shows the error panel,
Reload recovers it, and the rest of the desktop stayed live.

## Outcome — done 2026-08-06

Shipped as specified, with two decisions sharpened while building and one lint
rule catching a real defect.

### Reload is a key change, not a state reset

The obvious shape for an error boundary is `reset()` — clear `this.state.error`
and render the children again. **That would have shipped a Reload button that
visibly does nothing.** Clearing the error in place re-renders the same child in
the same state that just threw, so it throws again immediately and the panel
comes straight back. Recovery therefore belongs to the caller: `WindowSlot` owns a
remount counter, and Reload bumps the boundary's `key`. The boundary's prop is
`fallback(error)`, with no `reset` to misuse.

That is also why `WindowContainer`'s map became a `WindowSlot` component — the key
needs state, and a map callback cannot hold a hook.

### The boundary is inside the chrome, and that is load-bearing

`Window` renders the frame and takes the app as children, so the boundary wraps
only the content. A crashed app therefore still has a title bar that drags, a
taskbar button that focuses it, and a close button that works. Wrapping the chrome
instead would take away the exact controls the user needs to deal with the crash —
verified by dragging a crashed window 137px in the browser.

`Suspense` is **inside** the boundary, not outside: a lazy chunk that fails to load
throws, and that is a crash the user should see handled like any other.

### Dedupe per app, in its own module

A render loop can throw dozens of times a second, which turns the notification
centre into a denial of service against itself. One toast per app per 5s, keyed
per app so a *second* app crashing is still reported — that is new information.

The guard started as a module-scoped `Map` inside `AppErrorBoundary.tsx` and
**eslint's `react-refresh/only-export-components` rejected it** — the same rule
that caught a real defect in brief 83. Moving it to `crashToastGuard.ts` fixed
fast refresh and made the policy testable without mounting anything, which is how
the window-expiry case got a test at all.

### A DOM test, and still no new dependency

`vitest.config.ts` said component tests "would need jsdom plus
@testing-library/react; add those the day a brief actually requires them". This
brief required the DOM — jsdom was already a devDependency, so `.test.tsx` files
are now included and opt in per file with `// @vitest-environment jsdom`.
**@testing-library/react was not added**: `react-dom/client` plus React 19's `act`
covers "does it catch, does Reload remount" in about a dozen lines. The day
component tests outgrow that is the day to reconsider.

Two React 19 behaviours had to be understood rather than worked around:

- **Dev mode re-invokes a component after it throws** to build a better stack. A
  "throw once" test app therefore *succeeds* on the retry and the boundary never
  latches — the first draft of the spec passed vacuously in two places. The broken
  state is now the test's to control, not the component's.
- **A caught error is re-reported to `window.onerror`**, which vitest counts as an
  unhandled failure. `createRoot(container, { onCaughtError: () => {} })` is the
  supported way to say the boundary handled it; the assertions still read the DOM.

One more found writing the spec: rendering two boundaries one after another into
the same root does **not** test per-app dedupe. Same element type in the same
position means React reuses the instance, which is already latched and never
catches again. They have to be mounted side by side, as two windows would be.

### Verified in a browser, with an app deliberately broken

A temporary `throw` in Calculator's render, a production build, the real backend:

```
PASS a healthy Clock window is open first, so there is something to survive
PASS BOTH windows still exist after the crash (2 windows)
PASS the crashed window shows "Calculator stopped working" in-chrome
PASS the panel does not dump the raw message (it is behind Show details)
PASS the taskbar is still there; the desktop root did not unmount (364 elements)
PASS the crashed window's Close button exists — the chrome is OUTSIDE the boundary
PASS a crashed window can still be DRAGGED (moved 137,109)
PASS exactly one crash notification, not a storm
PASS Show details reveals the real message for whoever wants it
PASS Reload remounts the app and the real Calculator renders
PASS Close window from the panel closes that window and no other
uncaught page errors reaching the window: 0
```

Two test hooks were added while the probe was being written, both compositor-
internal and neither part of any app's API: `data-window-id` / `data-app-id` on
the window root, and `data-testid="taskbar"`. Every UI probe so far has had to
find a window by its text.

Tests: frontend vitest **1022 → 1032** (10 new). Backend unchanged at 356 unit and
138 e2e. All 103 turbo tasks green. Zero new dependencies.

**The documented limit stands**: this catches throws, not hangs. An app in an
infinite loop still freezes the tab, because every app shares the main thread.
Real hang isolation is the iframe/worker transport swap brief 48's seam makes
possible — a watchdog here would be a worse version of it.
