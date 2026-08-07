# Brief 115 — Terminal: the grid agrees with the font about how wide a character is

> **Outcome (2026-08-07): DONE.** xterm ships a **Unicode 6** cell-width table
> by default — a table that predates emoji being double-width and gets a lot of
> CJK wrong. `@xterm/addon-unicode11` (the same sanctioned `@xterm/addon-*`
> family as fit, search and web-links, which this app already loads) plus
> `term.unicode.activeVersion = '11'` swaps it. One catch the code found: xterm
> gates `term.unicode` behind `allowProposedApi`, so without that flag the addon
> **throws on activate** and the whole terminal lands in the error boundary —
> the one proposed API this app touches, enabled deliberately and commented as
> such.
>
> Measured rather than asserted. Print two rows, `🎉X` and `AAX`; both are three
> cells wide if the emoji is measured correctly. Before: **15.7px vs 23.5px** —
> the emoji counted as one cell, so everything after it on the row sits a column
> off. After: **23.5px vs 23.5px**, to within a rounding pixel. Both numbers
> came from the production bundle in a real terminal against the real PTY.
>
> Verified: turbo 120/120, and a 6-check browser probe — the terminal alive
> (not the error boundary, which is how the missing flag announced itself), the
> two rows measured, an emoji filename and a CJK filename round-tripping through
> `printf '%s\n' <dir>/*`, console clean.

Status: **done** · From the 2026-08-07 research sweep. EASY ·
`repl-interpreter` only, one new `@xterm/addon-*` dependency.

## Problem

Emoji and CJK filenames corrupt the terminal grid. The symptom is not "the
emoji looks odd": xterm lays the grid out from its own width table, and if it
believes a character is one column wide while the font draws two, every cell
after it on that row is displaced. The shell's cursor arithmetic assumes the
terminal agrees with it, so editing a command line that contains such a
character eats and duplicates characters.

`@xterm/xterm`'s built-in table is Unicode 6. Three addons from the same
family are already loaded (`addon-fit`, `addon-search`, `addon-web-links`),
so the fourth is not a new kind of dependency.

## Fix

1. `@xterm/addon-unicode11` in `repl-interpreter`'s dependencies.
2. `instance.loadAddon(new Unicode11Addon())` beside the other three, then
   `instance.unicode.activeVersion = '11'` — loading alone does nothing; the
   version switch is what swaps the table.
3. `allowProposedApi: true` in the `XTerm` constructor options, because
   `term.unicode` is a proposed API and the getter throws without it.

## Must preserve

- Reconnect, paste, search, the theme tokens and the font-size control from
  brief 56, all untouched.
- No backend change; no protocol change.

## Verify bar

`turbo typecheck`, lint + format, `turbo test`, `turbo build` green.

**Verified in a browser** (production bundle + real backend): `🎉X` and `AAX`
render the same pixel width; an emoji filename and a CJK filename list
correctly; the terminal is not in the error boundary. Console clean (§14).

## Out of scope

Grapheme clustering beyond what the addon provides (ZWJ sequences and skin-tone
modifiers still count per code point), a font that actually has glyphs for
every script, and the `addon-ligatures` / `addon-webgl` pair.
