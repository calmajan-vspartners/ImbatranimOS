---
title: Add-on manager (enable/disable add-ons)
created: 2026-07-17
status: promoted
tags: [core, platform, add-on]
---

# Add-on manager (enable/disable add-ons)

A UI to enable/disable which add-ons appear in the desktop (Start menu, command
palette, ext→app map) — a per-user "installed apps" panel, likely under
Settings.

## Context

Today the app roster is fixed at build time in `manifest.ts` (the composition
root: one import + one array entry per app). This todo adds a **runtime** on/off
toggle per app, persisted per user — a lighter cousin of the harder, still-open
"install new packages without sudo" question in `wiki/open-questions.md`. This
one only toggles already-bundled add-ons; it does NOT install new ones.

**Constraints to respect when this is grilled into a brief:**
- Persist enabled/disabled state per user (home FS / settings store).
- Filter `APP_REGISTRY` through that state everywhere the roster is consumed
  (Start menu, palette, openWith map) from one place — don't scatter the check.
- Pairs well with lazy-loaded app shells
  ([eager-bundle-lazy-load](eager-bundle-lazy-load.md)): a disabled app then
  costs nothing at load.
- Some apps are effectively core (Settings, Files, Terminal) — decide whether
  those are non-disable-able.

From the 2026-07-17 daily-driver research pass.
