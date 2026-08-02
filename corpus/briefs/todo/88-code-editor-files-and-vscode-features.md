# Brief 88 — Code Editor: create files and folders, and use more of Monaco

Status: **todo (user-requested 2026-08-02)** · MEDIUM ·
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
