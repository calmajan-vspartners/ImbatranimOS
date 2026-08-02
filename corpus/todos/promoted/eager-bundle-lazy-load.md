---
title: Lazy-load built-in app shells + build/architecture review
created: 2026-07-17
status: promoted
tags: [perf, core, tooling, architecture]
---

<!-- Promoted → brief 33 (2026-07-17); trigger (Monaco landing) met. Eager gzip 399.6 → 121.5 KB. -->


# Lazy-load built-in app shells (PERF) + build/architecture review

Split each built-in app into its own chunk loaded on window-open, so the eager
login bundle carries only the shell + whatever's actually on screen — the same
treatment the office document *engines* already get.

## Decision (2026-07-17, grilled) — HOLD, do not promote yet

Kept as a captured todo, **not** a brief. At 397 KB gzip with a 1.42 s cold
start, splitting is premature — it doesn't pay its complexity yet. **Trigger to
promote:** when a heavy app actually lands in the eager bundle (the Monaco
[code editor](code-editor-monaco.md) is the likely one), or when login/first-
paint becomes a *felt* problem. **No hard size target** when it does land —
measure and record before/after in the outcome note; any material drop passes.

## Context — measured 2026-07-17

From a test-run + bundle inspection on `main` @ brief 30:

- The eager login bundle is one monolithic chunk: `index-*.js` =
  **1.30 MB raw / 397 KB gzip**, plus ~62 KB CSS. Every login pays it.
- Root cause confirmed: **there are zero `React.lazy` boundaries.** Every
  add-on's `manifest.component` is a *static* import in
  `apps/core/src/manifest.ts`, so all 13 app component trees are pulled into the
  eager chunk. Only the heavy office *engines* (superdoc 5.4 MB, exceljs 930 KB,
  pptx 1.3 MB, pdf 425 KB) are lazy — because they're dynamically imported
  *inside* the add-on code paths, not because the app shells split.
- This directly conflicts with the "lightweight is identity" invariant (41 MiB
  idle, 1.42 s cold start) as more apps land — every new app added to the daily
  driver grows the eager bundle unless this is fixed first.

## Proposed direction (decide details at grill time)

- Make `manifest.component` a `React.lazy` boundary (or a `() => import(...)`
  loader in the manifest) so each app's shell becomes its own on-open chunk.
  Keep the icon/metadata eager (needed for Start menu/palette) — only the
  component lazy.
- A `<Suspense>` fallback in the window frame (fast, since only shells split).
- Re-measure the eager gzip size after; this is the acceptance signal.
- While here, a light **tooling/architecture review**: is `manualChunks` / the
  rolldown/Vite splitting config doing the right thing, are the i18n locale
  chunks (many large per-locale files in `dist`) loaded on demand, and is there
  any shared-vendor duplication across chunks.

Doing this early makes every subsequent app add-on (code editor, git GUI, etc.)
effectively free at login. Enables the runtime
[addon-manager](addon-manager.md) to cost nothing for disabled apps.

From the 2026-07-17 daily-driver research pass.
