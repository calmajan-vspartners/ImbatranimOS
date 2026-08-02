---
title: Archive manager add-on (zip + tar.gz)
created: 2026-07-17
status: promoted
tags: [add-on, files, normal-user]
---

# Archive manager add-on (zip + tar.gz)

Create and extract archives from the Files experience: extract a `.zip` or
`.tar.gz` to a folder, and compress a selection into one. Explicit scope for
now: **zip and tar.gz**.

## Context

Very "daily driver," serves everyone. The container has real `tar`/`gzip`/
`unzip`, and the codebase already uses `fflate` (docx off-thread work) — either
the real binaries via backend or `fflate` in a worker are viable; decide at
grill time.

**Constraints to respect when this is grilled into a brief:**
- Operate only inside the home FS jail the Files API already enforces.
- Prefer wiring into the file-manager context menu (extract here / compress
  selection) over a standalone window, or do both.
- Do heavy zip/unzip off the main thread (worker or backend) — don't block the
  UI (same lesson as `office-parsing-blocks-ui-thread`).

From the 2026-07-17 daily-driver research pass.
