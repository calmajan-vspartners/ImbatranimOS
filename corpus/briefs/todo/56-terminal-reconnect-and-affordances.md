# Brief 56 — Terminal: survive a dropped socket, and behave like a terminal

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
MEDIUM · add-on `apps/add-ons/repl-interpreter` (package name is historical; the
app is Terminal). Standalone. Backend unchanged.

## Problem

The Terminal is the app the whole "the OS is real, not simulated" claim rests
on, and its plumbing is genuinely good: a real PTY over an authed WebSocket,
keystrokes buffered until the socket opens, `ResizeObserver` → `fit()` → a
`resize` frame so the pty gets a real SIGWINCH, scrollback capped at 5000, and
a clean teardown that reaps the pty (`Terminal.tsx:55-110`). At 163 lines it is
also the thinnest app in the OS, and what is missing is what you notice hourly.

1. **A dropped socket kills the window permanently.** `ws.onclose` writes
   `[disconnected]` and stops (`Terminal.tsx:80-83`). There is no retry and no
   Reconnect control, so a backend restart, a sleeping laptop, or any blip
   leaves a dead black rectangle. The only recovery is closing the window,
   which also throws away the scrollback. `npm run dev` restarts Nest on every
   backend edit, so a developer hits this constantly.
2. **No paste.** xterm does not wire the clipboard for you. There is no
   Ctrl+Shift+V, no middle-click, no right-click paste and no context menu, so
   pasting a command into the OS's terminal is not possible at all. Copy relies
   on the browser's native selection over the xterm DOM, which is inconsistent.
3. **No search** over 5000 lines of scrollback (`@xterm/addon-search`).
4. **URLs in output are not clickable** (`@xterm/addon-web-links`). Both addons
   were dependencies of the pre-restructure frontend and were dropped in the
   move to add-on packages, not deliberately rejected.
5. **Hardcoded colours.** `bg-[#0d0d0e]` and `#f2f2ef` (`Terminal.tsx:36-40,117`)
   are literals, so the Terminal is the one surface that ignores the theme —
   flagged as a violation in `wiki/ui-conventions.md` §8/§46. In light mode
   every other app flips and the Terminal stays black.
6. **The accent is read once at mount** (`Terminal.tsx:26-28`), so changing the
   accent in Settings does not restyle an open Terminal.
7. **No font-size control**, and no unicode-width addon, so CJK and emoji
   misalign in a way that looks like a rendering bug.

## Proposed decisions (ungrilled)

- **Reconnect is the headline.** On close, show an in-terminal line plus a
  Reconnect affordance, and auto-retry with backoff (say 1s, 2s, 4s, capped,
  a handful of attempts) before giving up and waiting for a manual retry.
  Reconnecting opens a **new shell** — this is not session reattach, which
  `wiki/os-layering.md` explicitly parks. Say so in the UI ("reconnected — new
  shell") so nobody mistakes it for tmux. **Keep the existing scrollback** on
  reconnect: it is the user's history and losing it is the current pain.
- **Paste via `Ctrl+Shift+V` and a right-click context menu**, using
  `navigator.clipboard.readText()`. Copy on `Ctrl+Shift+C` from the xterm
  selection. Ctrl+C/Ctrl+V stay untouched — they must keep meaning SIGINT and
  literal input, which is exactly why the Shift variants are the convention.
- **Adopt `@xterm/addon-search` and `@xterm/addon-web-links`.** Two small,
  first-party xterm addons, both previously in this repo's dependency graph.
  Lazy with the app chunk. Search UI is a small overlay bar on `Ctrl+Shift+F`.
- **Tokens, not literals.** Drive the xterm theme from the CSS custom
  properties already on `<html>` and re-apply on theme/accent change rather than
  only at mount.
- **Rejected — a WebGL/canvas renderer addon.** Real speed win, but it is
  another dependency and a class of GPU/blank-canvas bugs, for an app whose
  output volume is small. Revisit if flooding output is ever a complaint.
- **Rejected — tabs or split panes inside the app.** The OS already has windows,
  and Terminal is `multiInstance`. Splitting inside a window duplicates the
  compositor's job.
- **Rejected — session reattach / tmux-style detach.** Parked by
  `wiki/os-layering.md`; it needs server-side session state, which is the shape
  of the daemon the kill-list refuses.

## Fix

1. Extract the socket lifecycle out of the mount effect into a small
   `usePtyConnection(term, windowId)` hook owning connect / retry / teardown,
   so reconnect logic is testable and the effect stops doing five jobs.
2. Status line in the terminal on disconnect + a Reconnect button in a thin
   toolbar (or an in-terminal keybinding) — the window chrome stays untouched.
3. Clipboard: keydown handlers for Ctrl+Shift+C/V plus a right-click context
   menu built the house way (`ui-conventions.md` §27). Handle the
   clipboard-permission rejection with a `notify()` rather than silence.
4. Load the search + web-links addons alongside `FitAddon`; add the search
   overlay.
5. Replace the literal theme with values read from the computed CSS variables,
   recomputed when the appearance store changes.
6. Font size: Ctrl+`+`/`-`/`0`, persisted, re-`fit()` after each change.

## Must preserve (regression surface)

- One window = one shell = one socket; closing the window still reaps the pty.
- Resize still reaches the pty (SIGWINCH) — verify `stty size` inside the shell
  after a resize *and* after a reconnect.
- Keystrokes typed before the socket opens are still buffered and flushed.
- The PTY WebSocket stays authenticated on upgrade; reconnect must go through
  the same authed URL builder (`ptyUrl.ts`) and must not retry forever against
  a 401 — an auth failure stops the loop and says so.
- Scrollback stays capped; reconnect must not multiply listeners or leak an
  xterm instance (mount/unmount repeatedly and watch for growth).

## Verify bar

`turbo typecheck`, add-on lint + format green, `turbo build` ok.

**Verified in a browser** (the OS runs locally): open Terminal, run `ls` in the
real home; restart the backend and confirm it reconnects on its own and stays
usable, with prior scrollback intact; paste a command with Ctrl+Shift+V; search
the scrollback; click a URL in output; switch to light theme and confirm the
Terminal follows; change the accent and confirm the cursor updates live; resize
the window and confirm `stty size` matches.

## Out of scope

Session reattach, tabs/splits, a WebGL renderer, shell configuration UI, an SSH
client, and any change to the backend PTY module.
