---
title: Code editor add-on (Monaco / VS Code-style)
created: 2026-07-17
status: promoted
tags: [add-on, developer, editor]
---

# Code editor add-on (Monaco / VS Code-style)

A real code editor add-on built on Monaco (the editor core of VS Code):
syntax highlighting, multi-tab, multi-file, find/replace, minimap. Opens files
from the real home FS and pairs with the real shell — a genuine mini-IDE, not a
toy, because the container behind the desktop is a real Alpine userland.

## Context

The biggest gap for the programmer audience (web + low-level). Notepad is
plaintext only; this is the daily-driver editor. Lives under `apps/add-ons/`,
imports from `@imbatranim/core` only (FS `api`, stores). Serves both audiences.

**Constraints to respect when this is grilled into a brief:**
- Monaco is heavy — it MUST be a lazy chunk (dynamic import behind window-open),
  like the office engines already are, so it never enters the eager login
  bundle (see [eager-bundle-lazy-load](eager-bundle-lazy-load.md)).
- Reuse the shared add-on kit (`useOpenIntent`/`useSaveHotkey`/`useUnsavedGuard`,
  dirty flag, close guard) rather than reinventing the editor spine.
- LSP / IntelliSense is a stretch goal, not v1 — start with highlighting + edit +
  save against the real FS.

From the 2026-07-17 "what to build next for a daily driver" research pass.
