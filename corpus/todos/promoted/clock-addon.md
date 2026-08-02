---
title: Clock add-on
created: 2026-07-17
status: promoted
tags: [add-on, normal-user]
---

# Clock add-on

A clock app: current time, and natural extensions — world clocks, a stopwatch,
and a timer/alarm. The taskbar tray already shows the time; this is the full
app behind it.

## Context

Small normal-user staple. Pure client-side, no backend. Consider whether the
tray clock should launch this on click.

**Constraints to respect when this is grilled into a brief:**
- Alarms/timers only fire while the desktop tab is open (no background daemon
  without a real service story) — set expectations accordingly, and this could
  hook the future notification center for alerts.

From the 2026-07-17 daily-driver research pass.
