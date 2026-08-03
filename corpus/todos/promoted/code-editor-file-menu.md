---
title: Code editor — VS-Code-style File menu (open / open-recent)
created: 2026-07-19
status: promoted
target: v1.* (post-1.0)
tags: [add-on, code-editor, ux]
---

# Monaco code editor needs a File menu bar

From the first human walkthrough (2026-07-19). The Monaco code-editor add-on
(brief 41) opens files via double-click / openWith from the file manager, but
has no in-app **File** menu the way VS Code does. Wanted:

- A top **File** menu with at least **Open…** (pick a file from the home FS)
  and **Open Recent** (a short MRU list).
- Fits the existing multi-tab + real-FS-save model; no backend change needed
  for Open (reuse the files API + a picker), MRU can persist client-side like
  other add-on stores.

Explicitly scoped to **v1.\*** (post-1.0) by the user — not a 1.0 blocker.
Note: `apps/add-ons/code-editor/src` is currently read-only to the working
user (same perms issue as the clock fix) — unlock before implementing.

## Resolved — 2026-08-02

Shipped by [brief 88](../../briefs/done/88-code-editor-files-and-vscode-features.md),
which the user asked for directly and which supersedes brief 61. The File menu
exists with Open… (through brief 54's shared picker) plus New File, New Folder,
Save, Save As and Close Tab.

**Open Recent was not built.** The session tab record reopens what was actually
open before a reload, which is the need behind an MRU without a second list to
maintain; a true cross-session MRU belongs with brief 49's durable prefs rather
than a third client-side store. The read-only `src` permissions noted here were
no longer in force.

Kept for history.
