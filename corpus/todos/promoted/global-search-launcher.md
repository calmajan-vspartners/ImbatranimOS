---
title: Global search launcher (Win-style, near Start)
created: 2026-07-17
status: promoted
tags: [core, platform, search, ux]
---

# Global search launcher (Win-style, near Start)

A launcher that "zooms" open near the Start button (Windows-style) and searches
across apps, files, and file contents from one box — a step beyond today's
command palette, which covers apps + commands but not files/content.

## Context

Core shell surface, not an add-on. The command palette + its
`CommandSourcesRegistry` are the foundation to build on rather than replace.

**Constraints to respect when this is grilled into a brief:**
- File/content search needs a backend endpoint over the home FS (jailed, authed)
  — decide live grep vs. a lightweight index at grill time; keep it cheap so it
  doesn't fight the "lightweight" identity.
- Reuse the existing palette's command sources; don't fork a second search stack.
- Anchor the UI to the Start button per the Win7-classic layout.

From the 2026-07-17 daily-driver research pass.
