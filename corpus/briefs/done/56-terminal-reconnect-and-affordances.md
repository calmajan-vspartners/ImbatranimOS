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

---

## Outcome — 2026-08-04

Done, and the headline is **verified against a real process kill** rather than a
mocked socket close: `uitest/restart-backend.sh` `kill -9`s the backend and restarts
it while a Terminal window is open.

### The reconnect is a decision table, not a retry loop

"Just retry on close" would have been wrong. Several of the ways this socket closes
are the user or the server saying *stop*, so `lib/closeReason.ts` classifies the
close first, reading the codes off `pty.gateway.ts`/`pty-session.ts` rather than
guessing:

| code | reason | meaning | retry? |
|---|---|---|---|
| 1000 | `pty-exit` | the user typed `exit` | **no** — never override that |
| 1000 | `closed` | normal closure per RFC 6455 | no — manual Reconnect |
| 1001 | `shutdown` | backend restarting | **yes** — the dev case |
| 1011 | `spawn-failed` | shell would not start | no — a loop fails just as fast |
| 4401 | `session-revoked` | logged out / expired | no, **and no button** |
| 1006 | — | blip, dead backend, **or** a refused handshake | bounded |

**The 1006 ambiguity is the interesting part.** An unauthorized upgrade is refused
with a raw 401 and `socket.destroy()`, which the browser never surfaces to script —
a rejected handshake and a yanked cable both arrive as 1006 with no reason. So the
brief's "must not retry forever against a 401" *cannot* be satisfied by reading the
close code. Two things cover it instead: an `everOpened` flag (a socket that never
opened was refused at the handshake, which is the case worth suspecting auth for),
and a bounded budget so even a misdiagnosed 401 stops. After giving up, the hook
asks `/auth/status` and reports the real cause — measured output:

```
Disconnected… reconnecting in 1s…
Could not reach the shell… reconnecting in 2s…      (4s, then 8s, 8s)
Could not reach the shell… Giving up after 5 attempts.
The backend is not reachable.
```

`allowManualRetry` is false **only** for a revoked session: a Reconnect button that
can only 401 again is worse than no button.

### Two of the brief's premises did not survive measurement

- **"No paste... pasting is not possible at all."** Wrong on this platform, and my
  first implementation proved it the hard way. A Ctrl+Shift+V produces one keydown
  **and** one native `paste` event on xterm's helper textarea, and xterm already
  writes that event to the pty — so adding a keydown handler made every paste arrive
  **twice** (`echo PASTED_OKecho PASTED_OK`). Returning `false` from
  `attachCustomKeyEventHandler` does not help; the paste event is not xterm's key
  processing. Keyboard paste is now left to the browser, which is also strictly
  better: it works for whatever gesture the platform maps to paste (Cmd+V on macOS)
  and needs no `clipboard-read` permission. **Middle-click and right-click** have no
  native path into the pty, so those go through `readText()` with a `notify()` on
  rejection — which is the part that was genuinely missing.
- **Flipping the background to a token is not enough.** xterm's default ANSI 16 are
  tuned for a dark background; on the light surface (`#f3f3f1`) bright yellow, cyan
  and white are effectively invisible, so every `ls --color` and `git status` would
  have unreadable words in it — a worse bug than the one being fixed. `xtermTheme.ts`
  therefore carries a palette **per mode**, with tests asserting every entry clears
  3:1 against its own surface. On light, "bright" means *more saturated* rather than
  closer to white, and `brightWhite` maps to near-black.

### What shipped

- `lib/closeReason.ts` — the table above, plus capped backoff (1s, 2s, 4s, 8s).
- `hooks/usePtyConnection.ts` — the whole socket lifecycle in **one effect** with
  plain local closures. An earlier draft spread it across `useCallback`s with mirror
  refs; that needed a self-referencing callback for the retry and React's lint rules
  rejected it twice (a `useCallback` may not name itself; a hook-produced value may
  not be copied into a ref). A recursive local function inside an effect is the shape
  this actually is.
- `lib/xtermTheme.ts` — theme from `--k-surface` / `--k-on-surface` / `--accent`,
  re-applied on change, with the two ANSI palettes. `cursorAccent` is the *background*
  rather than a fixed near-black, or the glyph under the cursor vanishes on light.
- `lib/fontSize.ts` — Ctrl+`=`/`-`/`0`, clamped 8–28, persisted. Junk in storage
  returns the default rather than the clamp floor, so a corrupt value cannot leave
  the user with an 8px terminal forever.
- Search (`@xterm/addon-search`) on Ctrl+Shift+F with a small overlay bar, and
  clickable URLs (`@xterm/addon-web-links`) opened with explicit
  `noopener,noreferrer` — terminal output can contain any URL a remote command
  printed.
- `useAppearanceStore` is now exported from core, which is what makes the live
  restyle possible; the accent used to be read once at mount.
- The xterm instance moved from `useState` into a **ref built by a ref callback**,
  because xterm's API is mutation (`term.options.theme = …`) and React's immutability
  rule rightly refuses to let you mutate a value that came out of `useState`.
- 25 unit tests.

### Verified in the shipped bundle

`uitest/term56.mjs`, `term56b.mjs`, `termtheme.mjs`:

- **Backend killed and restarted for real** → reconnects on its own, **prior
  scrollback intact**, usable again, and `stty size` still `28 86` — SIGWINCH
  survives the reconnect.
- Backend killed and **left down** → gives up after exactly 5 attempts, names the
  cause, keeps the scrollback, offers Reconnect.
- Theme measured in **pixels**, not computed styles: `[13,13,14]` (exactly
  `--k-surface`) → `[230,233,236]`, switched **live** through the real Settings UI
  with the Terminal already open. Computed styles cannot answer this — xterm's DOM
  renderer leaves `.xterm-viewport` at xterm.css's own `#000` whatever the theme says,
  which is what made an earlier version of the probe report black in both themes.
- Paste once (not twice), search selects the match, Ctrl+= 13px→15px and Ctrl+0
  resets, and four open/close cycles leave **zero** xterm nodes behind.
- No page errors in any run.

### Rejected / deferred, unchanged from the brief

WebGL renderer, tabs or splits inside the window, and session reattach all stay
rejected for the reasons the brief gives. **Not done:** the unicode-width addon for
CJK/emoji alignment (item 7's second half) — it is a third dependency for a
narrower problem than the rest of this brief, and worth its own decision.
