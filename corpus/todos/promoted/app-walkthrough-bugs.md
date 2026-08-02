---
title: App walkthrough bugs (2026-07-19 browser pass)
created: 2026-07-19
status: open
tags: [bug, ui, apps, qa]
---

# App walkthrough bugs (2026-07-19 browser pass)

Findings from opening and eyeballing every desktop app in a headless Chrome
(dev servers: backend on :3001, core Vite on :5173), viewport 1280×577. Good
news first: **all 23 apps mounted without throwing** — no error boundaries, no
blank crash panels. The three backend apps work end-to-end (Terminal = real
PTY, File Manager = real FS listing of the home dir, System Monitor = live
CPU/RAM/disk). Git shows a proper root+path form. The bugs below are the real
ones worth fixing.

## Bugs found

1. **File Manager renders a `<button>` nested inside a `<button>`.** The only
   console errors in the whole session were React's *"In HTML, `<button>`
   cannot be a descendant of `<button>` … this will cause a hydration error"*,
   traced to the FileManager subtree. Invalid HTML — hurts accessibility and
   can swallow/duplicate clicks on the inner control. Fix: make the outer or
   inner element a non-button (`div`/`span` with role, or restructure the row).
   See [apps/add-ons/file-manager/](../../../apps/add-ons/file-manager/).

2. **Window default size spills under the taskbar → hidden controls.** Several
   apps open at a default size/position whose bottom is clipped by the 44px
   taskbar on shorter viewports. Concretely: the **Calculator's bottom row
   (`0 . =`) is fully hidden under the taskbar** — the `=` button is
   unreachable at this height. Sheets and Calendar likewise have their bottom
   row clipped. Root: default window sizes aren't clamped to
   `viewportHeight − TASKBAR_HEIGHT`, and cascade jitter can push them further
   off. This is the window-side sibling of the icon overflow in
   [desktop-icon-layout-resolution-bugs](desktop-icon-layout-resolution-bugs.md)
   — likely a shared "clamp to desktop bounds" fix. Window model lives in
   [windowStore.ts](../../../apps/core/src/shared/store/windowStore.ts) /
   [Window.tsx](../../../apps/core/src/shared/components/window/Window.tsx).

3. **Viewer/editor apps have no in-app way to open or create content.** Image
   Viewer, Media Player, PDF Viewer, Sheets, Slides, Markdown Editor, and Code
   Editor all show the same empty state — *"Open a file from Files"* — with no
   Open button, no file picker, no drag-and-drop, and no "New". The only way to
   get content into them is to launch File Manager separately and open from
   there. For a desktop that wants to feel real this is a UX gap bordering on a
   bug; at minimum an in-app open dialog (reusing the Files browser as a
   picker) and drag-a-file-onto-the-window would close it. Decide per app
   whether "New / blank document" also makes sense (Sheets, Slides, Markdown,
   Code Editor).

## Context

Method: opened each app via its real double-click handler, waited, screenshotted,
and collected `window.onerror` + `console.error` across the session. Coverage
was breadth-first (does it mount, does it render, obvious layout breakage) — not
a deep functional test of each app's features. A follow-up pass should exercise
actual workflows (create a sticky note and reload; add a todo; type in Notepad
and save; run a git status; send a REST request; extract an archive).

Not bugs, just noted: the dev instance runs the backend as the host user, so the
Terminal prompt and File Manager show the *host* home dir rather than the
container's `imbatranim` home — an artifact of running outside Docker, not a
product defect.

From the 2026-07-19 headless-browser walkthrough.

> **RESOLVED 2026-07-31.** All three findings are fixed:
> 1. the nested `<button>` was core's `Tooltip`, not FileManager — fixed at the
>    root, covering all 33 call sites;
> 2. window default sizes are now clamped to the desktop ([brief 52](../../briefs/done/52-window-default-size-clamp.md));
> 3. the eight viewer/editor dead ends now have an Open dialog
>    ([brief 54](../../briefs/done/54-shared-file-open-dialog.md)).
> Kept for history.
