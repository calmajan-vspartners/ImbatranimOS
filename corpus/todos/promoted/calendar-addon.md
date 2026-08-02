---
title: Calendar add-on
created: 2026-07-17
status: promoted
tags: [add-on, normal-user]
---

# Calendar add-on

A calendar app: month/week views, create/edit events, reminders. Can tie into
the existing Todo app (due dates → calendar) rather than being a silo.

## Context

Normal-user daily-driver staple. Event storage in the home FS (or the app's own
store), owned by `imbatranim`.

**Constraints to respect when this is grilled into a brief:**
- Decide the Todo integration at grill time — shared store vs. read-only view
  of todo due dates.
- Reminders share the same "only while the tab is open" limitation as the clock
  alarms; hook the future notification center.

From the 2026-07-17 daily-driver research pass.
