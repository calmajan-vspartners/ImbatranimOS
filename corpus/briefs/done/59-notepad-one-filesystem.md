
---

## Outcome — 2026-08-04

Done, and the brief was **wrong about its own biggest item** in a way that inverted
the work.

### The brief called autosave "rejected". Notepad WAS the autosaving app.

Under *Proposed decisions* the brief says "Rejected — autosave. The explicit-save
spine with a dirty marker and a close guard (brief 23) is consistent across every
editor in the OS", and under *Must preserve* it lists "the save spine:
`useOpenIntent`, `useSaveHotkey`, `useUnsavedGuard`, the dirty `•` … and the close
guard".

**None of that was in Notepad.** `NoteEditor.handleChange` fired a 1-second debounced
write after every keystroke, and the app used *none* of those hooks — no dirty marker,
no Ctrl+S, no close prompt. So the brief's non-change was in fact its largest change:
converting Notepad *to* the spine the brief believed it already had.

Done, and it is the right way round. There is no version history and no undo across a
reload, so a debounce meant a stray keystroke reached disk within a second with
nothing to recover from. Now: `useUnsavedGuard` for the `•` and the close prompt,
`useSaveHotkey` for Ctrl+S, and a Save button that disables when clean.

The reload path is careful about one thing the old code could not be: when the file
changes on disk **and** the user has unsaved edits, the new content is deliberately
*not* adopted. Silently replacing what someone is typing is the worst available
resolution.

### `.txt` in your home directory opened nothing at all

The root fix has a second half the brief does not mention. `openWith.ts` carried
`NOTEPAD_ONLY_NOTES = { appId: 'notepad', onlyRoots: ['notes'] }`, so double-clicking a
`.txt` or `.log` under `home` resolved to **null** — no app claimed it and the click
was silently swallowed. The brief lists "`.txt`/`.log` continue to route here from
`openWith`" under must-preserve, which was only true from one root.

A test already recorded this, left by brief 65 with a note calling it "a dead end …
brief 59 has a test to flip". Flipped: the gate is gone, and `home/notes.txt` now
resolves to `notepad`.

### The root migration

Default to `home`; keep `notes` reachable. The decision is made per install rather
than stored: `notes` while it still has files in it, `home` otherwise. Silently
switching would show a returning user an empty home directory and read as "my notes
are gone" — worse than the inconsistency being fixed. A one-time read, not a migration
flag, so there is nothing to get out of sync and it self-corrects when the notes root
empties.

`{ root, path }` replaced the bare path in the store and in every query key. A path
alone became ambiguous the moment Notepad stopped being hardwired: `Documents/todo.txt`
exists in both roots, and a window remembering only the path would read one and save to
the other. The root is also shown as a badge in the toolbar — you can see which
filesystem you are editing.

### The rest

- **Find and replace** over the plain textarea, no engine. `lib/findReplace.ts` is
  pure and tested, because each function has a silent failure waiting in it: an empty
  query must not report a match at every position; `aa` in `aaaa` is two matches not
  three; and **replace-all scans the original and assembles a new string** rather than
  replacing in place, because in-place replacement re-searches text that already
  contains the replacement, so `a` → `aa` never terminates. The query is literal, not
  regex — typing `(` into a find box must not throw.
- **Status bar**: 1-based Ln/Col (what compilers say), line/word/char counts, and a
  wrap toggle with `aria-pressed`. Emoji count as one character.
- **Size guard**: >1 MiB is refused and **handed to Code Editor**, not just blocked —
  "no" with nowhere to go is not help. The size comes from the directory listing, since
  downloading a 200 MB log to discover it is too big to open is the problem the guard
  exists to avoid. An unknown size opens rather than blocking the user out of a file.
- **`components/FileBrowser.tsx` deleted** (183 lines) in favour of core's
  `useFileDialog`. One picker in the OS. It already has the Home/Notes switcher, so
  Notepad needs one Open button rather than one per root.

### Verified

**36 unit tests** for the pure logic. In the shipped bundle (`uitest/note59.mjs`):

- Double-clicking `note59.txt` in **home** opens Notepad — the dead end is gone — and
  the toolbar badge reads `home`.
- Ln/Col tracks the caret (`Ln 1, Col 1` → `Ln 3, Col 1` after two ArrowDowns), word
  count renders, the wrap toggle flips its `aria-pressed`.
- Find reports `1 of 8`; a miss says **"No results"** in words rather than by colour
  alone; replace-all rewrites every occurrence.
- The dirty `•` appears (this app had no dirty state at all before), **the file on disk
  is still unchanged at that point** — proving autosave is genuinely gone — Ctrl+S
  writes the new content, and the marker clears.
- A 1 MiB `.log` is refused with an explanation and Code Editor opens it (one Monaco
  instance appears).
- The migration hint points at the Notes location while legacy notes exist.
- No page errors.

A probe lesson worth keeping: a **>1 MiB JSON `PUT` to `/files/content` silently
413s**, so the first version of this test was exercising a file that had never been
created. The big fixture goes through multipart `/files/upload` instead.

### Out of scope, unchanged

Syntax highlighting, tabs, version history, encoding selection and print all stay out.
The markdown preview mode already in the app was left alone — `.md` routes to Markdown
Editor, so it is vestigial here, but removing a working feature is not this brief's job.
