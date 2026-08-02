---
title: Virtualize long lists (TanStack Virtual)
created: 2026-07-17
status: promoted
tags: [perf, add-on, core]
---

# Virtualize long lists (TanStack Virtual)

The process table (re-renders every 1.5 s poll) and the file-manager directory
list render every row with no virtualization. Add `@tanstack/react-virtual` so
only visible rows mount.

## Context

From the 2026-07-17 "should we use TanStack to optimize the UI" discussion:
TanStack **Query is already the data layer and well configured** — nothing to
add there. The real gap is virtualization. This is a *runtime rendering* win,
separate from the *bundle-size* axis (that's the held
[eager-bundle-lazy-load](eager-bundle-lazy-load.md) todo).

**Promoted 2026-07-17** after grilling →
[brief 31 (virtualize-long-lists)](../../briefs/done/31-virtualize-long-lists.md).
Decisions captured there: scope = ProcessTable + FileList; dep centralized in
`@imbatranim/core` via a `useVirtualList` helper; always-virtualize.
