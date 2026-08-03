# Brief 88 — Code Editor: create files and folders, and use more of Monaco

Status: **done 2026-08-02** · MEDIUM ·
add-on `apps/add-ons/code-editor`. Depends on brief 54 (shipped —
`useFileDialog`). Supersedes brief 61, which covered the same ground before the
user asked directly; **61 is closed as superseded** rather than duplicated.

## Problem

Monaco is the heaviest dependency in the repo and the app uses a fraction of it.
The user asked to create files with extensions, create directories, and have
more of what VS Code offers. Today the app can only open what File Manager hands
it: there is no New, no Save As, no way to make a folder, and three concrete
defects — a native `window.confirm` (`CodeEditor.tsx:250`), a
`defaultSize.height` of 680 that cannot fit a short viewport, and the minimap on
by default in windows that are often narrow.

## Decisions

- **A File menu**: New File, New Folder, Open…, Save, Save As…, Close Tab. Open
  and Save As go through brief 54's `useFileDialog`; New Folder uses the same
  picker in a directory-choosing mode plus `usePrompt` for the name.
- **New File asks for a filename with its extension**, and the extension picks
  the Monaco language — the same rule brief 87 uses in the file manager, so the
  two agree.
- **Replace the native confirm** with `useConfirm`. It is the OS's only
  browser-chrome dialog and it breaks the illusion harder than anything else in
  the app.
- **The VS Code features worth having, in order**: format-on-save (opt-in, off by
  default — a formatter silently rewriting a file nobody asked it to is worse
  than none), go-to-line (`Ctrl+G`), a minimap/word-wrap/font-size control
  surface with **minimap off by default**, bracket-pair colourisation, and
  restoring open tabs per window.
- **Rejected — a language server.** An LSP means a server process per language
  in the image; that is a different product and it violates the slim-image
  identity. Monaco's built-in TS/JSON/CSS/HTML intelligence is the ceiling, and
  it is already bundled.
- **Rejected — extensions/plugins.** The kill-list forbids a runtime package
  system; `manifest.ts` is the package system.
- **Deferred — workspace-wide find-in-files.** The bounded content grep already
  exists (`/api/files/search?content=1`, brief 45); wiring it into the editor is
  a second surface and should follow the File menu.

## Fix

1. `FileMenu.tsx` driving `useFileDialog` + `usePrompt`; New Folder posts to the
   existing `POST /api/files/directory`.
2. Replace `window.confirm` at `:250` with `useConfirm({ destructive: true })`.
3. Manifest: honest `minSize`, and `defaultSize.height` ≤620 so it fits a 720px
   viewport minus the taskbar.
4. Editor options surface (minimap/wrap/font size), persisted; minimap default
   off; bracket-pair colourisation on.
5. Format-on-save toggle calling `editor.action.formatDocument` before the write.
6. `Ctrl+G` go-to-line, registered in the brief-86 shortcut registry.
7. Restore open tabs per window; note this is *session* state under brief 49, not
   a durable dotfile.
8. **Confirm the Monaco workers are actually active** rather than silently
   falling back to the main thread, and record the answer — if they are not, the
   app is slow for a reason nobody has looked for.

## Must preserve (regression surface)

- Monaco stays self-hosted and fully lazy; the eager bundle measured at brief 33
  (121.5 KB gzip) must not grow.
- Multi-tab behaviour, per-tab dirty state, and the real-FS save path.
- `languageForPath` routing and the `openWith` map (code here, `.txt`/`.log` to
  Notepad).
- The theme follows the OS light/dark and accent.
- Monaco's own find/replace keeps its keybindings; the File menu must not shadow
  them.

## Verify bar

`turbo typecheck`, lint + format green, `turbo build` ok, plus a check that the
eager chunk is unchanged.

**Verified in a browser**: File → New File → `demo.ts` → Monaco highlights it as
TypeScript → Save As into a real folder → it appears in File Manager; New Folder
creates a real directory; close with unsaved changes shows the *themed* dialog;
toggle minimap and wrap; `Ctrl+G` jumps; open at 1280×577 with every control
reachable.

## Out of scope

Language servers, extensions, workspace find-in-files (deferred), notebooks,
remote editing, and a diff view.

## Outcome — 2026-08-02 (done)

Shipped: a **File / Edit / View** menu bar (`MenuButton`, local to the app —
the file manager's `ContextMenu` is cursor-anchored and one component doing
both would be worse than two doing one), New File, New Folder, Open…, Save,
Save As…, Close Tab, plus go-to-line, find, format-document, and a persisted
minimap / word-wrap / font-size / format-on-save surface.

**New File** prompts for a name with its extension and the extension picks the
Monaco language, matching brief 87's rule in the file manager. The tab is
*untitled* — a real buffer with no home — and Save falls through to Save As
until it has one. Save As retargets the tab: a Monaco model URI is immutable,
so the buffer moves to a new model, and the view state moves with it. Saving
onto a path another tab already owns is refused rather than silently taking
over that tab's model, which would take its unsaved edits with it.

**New Folder** needed a directory picker, so `FilePicker` gained a
`directory` mode and `useFileDialog` a `pickDirectory` — files still render,
greyed out, because "is it already in here?" is what the user is checking.
That is core, so every app gets it.

**`window.confirm` is gone** (`CodeEditor.tsx:250`) — the last browser-chrome
dialog in the app — replaced by `useConfirm({ destructive: true })`.

**Manifest**: `defaultSize.height` 680 → 620 so it fits a 720px viewport with
the taskbar; `minSize` 520×360 → 560×320, an honest floor for the menu bar.

**Tab restore is narrower than the brief asked, deliberately.**
`PersistedWindow` stores no window id, so ids are re-minted on every reload and
a per-window record could never be matched back to its window. What ships is
one session record (`sessionStorage`, session state per brief 49 — not a
durable dotfile) claimed by the first editor window that opens; later windows
get nothing, so a second window is never a duplicate of the first. Untitled
tabs are never recorded — their contents are not on disk, and "restoring" one
would restore an empty buffer wearing the name of work that is gone. 8 unit
tests cover the record and the claim, including a corrupt payload and a
storage that refuses writes.

**Fix step 8 — are the Monaco workers actually running? Yes.** Two real Web
Workers spawn: `vs/editor/editor.worker.js` and
`vs/language/typescript/ts.worker.js`. Confirmed behaviourally, not just by
their presence: typing `const answer: number = 'not a number'` into a `.ts`
tab produces a `squiggly-error` from the TypeScript worker, which proves both
that the extension routed the language and that type-checking runs off the
main thread. No fallback, nothing to fix.

The lint rule against synchronous `setState` in an effect caught the file-open
path (the fifth time this session a lint rule pointed at something real). Rather
than suppress it, all three load sources — launch intent, Open dialog, session
restore — were merged into one effect whose every state update happens inside
the async body. That also removed a StrictMode defect the split version had:
cancel-on-cleanup would have thrown away the restored tabs, because
`claimTabSession` only answers once and the second mount run would no longer ask
for them.

**Verified in a browser** at 1280×577 (window renders 533px tall, taskbar
clear): File→New File→`demo.ts` → TS squiggle → Save As → `demo.ts` on the real
FS with the dirty marker cleared; New Folder → `brief88/` created in `home`;
minimap 0px by default and 107px after toggling; word wrap turns a 400-char
line from 1 rendered line into 5; font size 13 → 16; `Ctrl+G` opens Monaco's
go-to-line widget; closing a dirty tab shows the *themed* dialog with a
Discard button and **no** native `confirm`; format-on-save rewrote
`const   a=1;   const  b   =2` to `const a = 1; const b = 2` on disk; reload
reopened `fmt.ts` and a second editor window came up empty. No page errors.

Eager chunk gzip **125.71 → 125.77 KB** (+60 bytes, from the shortcut row and
the picker's directory mode). Monaco stayed lazy. Note the brief's 121.5 KB
figure was already stale at HEAD — it is brief 33's measurement, and briefs
52-89 have added to it since.

**Not done**: workspace find-in-files, which the brief already deferred.
