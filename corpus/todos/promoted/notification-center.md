---
title: Notification center
created: 2026-07-17
status: promoted
tags: [core, platform, ux]
---

<!-- Promoted → brief 34 (2026-07-18); shipped. -->


# Notification center

A cross-cutting platform capability: transient toasts + a persistent history
panel (tray-anchored) + do-not-disturb. Any app can raise a notification;
users can review past ones.

## Context

Not an add-on — this is core shell surface (like Settings), so apps get a shared
notification API from `@imbatranim/core`. Clock alarms, calendar reminders, and
long-running ops (archive extract, large file save) are natural first callers.

**Constraints to respect when this is grilled into a brief:**
- Define the public API in core's `src/index.ts` so add-ons can call it within
  the enforced boundary.
- Fits the Win7-classic tray identity — anchor it there; don't relitigate the
  layout.
- In-session only unless/until a background service story exists.

From the 2026-07-17 daily-driver research pass.
