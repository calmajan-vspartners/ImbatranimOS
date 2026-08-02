---
title: Markdown editor with live preview
created: 2026-07-17
status: promoted
tags: [add-on, developer, editor]
---

# Markdown editor with live preview

A markdown editor with a side-by-side (or toggle) live preview: edit on the
left, rendered HTML on the right. For READMEs, notes, and docs.

## Context

Web devs write a lot of markdown; Notepad is plaintext. Could stand alone or be
a "preview mode" of the Code Editor
([code-editor-monaco](code-editor-monaco.md)) — decide at grill time whether to
fold it in rather than ship two editors.

**Constraints to respect when this is grilled into a brief:**
- A markdown/rehype rendering path already exists in the bundle
  (`rehype-parse` appears in the build) — reuse it, don't add a second renderer.
- Sanitize rendered HTML (no raw-HTML injection from file contents).
- Reuse the shared add-on kit (open intent, save hotkey, unsaved guard).

From the 2026-07-17 daily-driver research pass.
