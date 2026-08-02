# Brief 54 — A shared Open dialog, so viewers stop being dead ends

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
MEDIUM · CORE (new export from `apps/core/src/index.ts`) + a one-line adoption in
each consuming add-on. Standalone, but land brief 52 first so the dialog is never
clipped. Briefs 55–78 consume this rather than each app building its own opener.

## Problem

Eight apps open to an empty state that tells the user to go somewhere else, with
no Open button, no picker, no drag-and-drop and no "New":

- `code-editor/src/CodeEditor.tsx:386` — "Open a code file from Files"
- `docs/src/Docs.tsx:147`, `sheets/src/Sheets.tsx:108`,
  `slides/src/Slides.tsx:97` — "Open a file from Files"
- `image-viewer/src/ImageViewer.tsx:231`, `media-player/src/MediaPlayer.tsx:84`,
  `pdf-viewer/src/PdfViewer.tsx:169` — "Open a file from Files"
- `markdown-editor/src/MarkdownEditor.tsx:104` — "Open a .md file from Files"

So launching Sheets from the Start menu and wanting to edit a spreadsheet means:
close Sheets, open File Manager, navigate, double-click. No desktop OS behaves
that way, and the 2026-07-19 walkthrough already called it "a UX gap bordering on
a bug". Every one of these apps has a complete *save* spine (brief 23) and no
*open* spine.

The primitive already exists but is private: `notepad/src/components/FileBrowser.tsx`
(183 lines) is an in-app file browser with `onOpenFile(path)`, built from the core
kit and used by Notepad today. Nothing else can reach it — add-ons may only import
`@imbatranim/core` — so seven other apps went without rather than copying it.

## Proposed decisions (ungrilled)

- **Promote, don't invent.** Lift Notepad's `FileBrowser` into core as the body of
  the dialog. It is proven, already on-style, and already talks to the jailed
  `files` API. Notepad then consumes the shared one and drops its copy.
- **Imperative hook, matching the house pattern.** `useConfirm`/`usePrompt`
  already establish it, so:
  ```ts
  const { openFile, fileDialog } = useFileDialog()
  const picked = await openFile({ extensions: ['xlsx', 'csv'], title: 'Open spreadsheet' })
  // -> { root, path } | null
  ```
  and the caller renders `{fileDialog}`. Returning `{ root, path }` matches what
  `useOpenIntent` already yields, so an app's existing load path is reused
  verbatim — adoption per app is a button and an await, not a refactor.
- **Filtering is a hint, not a jail.** Default to the app's own extensions with a
  visible "All files" escape. Never hide a file the user can see in File Manager.
- **A save-as counterpart in the same hook** (`saveFile({ suggestedName })` →
  `{ root, path } | null`), because Sheets/Docs/Markdown/Code Editor cannot
  currently create a file at a chosen location either — the same dead end from
  the other side.
- **Drag-and-drop onto a window is IN scope** and is the other half of the fix:
  core handles the drop, resolves it to `{ root, path }` when the drag came from
  File Manager, and hands the app the same shape. Dropping a file from the *host*
  machine is a different problem (an upload) and is out of scope.
- **"New / blank document" stays with each app**, not here — only Sheets, Docs,
  Markdown Editor and Code Editor have a meaningful blank state, and each defines
  its own. Their briefs own it; this brief only guarantees they can then choose
  where to save.
- **Rejected — the browser's native `<input type="file">`.** It reads the *host*
  filesystem, not the container's. "The computer is the container": an Open
  dialog that browses the laptop instead of the OS's own home directory would be
  actively wrong here.
- **Rejected — teaching each app to render its own browser.** That is the
  duplication brief 23 was written to eliminate.

## Fix

1. Move `FileBrowser` to `apps/core/src/shared/components/files/FileBrowser.tsx`,
   parameterised by `root`, an optional extension filter, and a
   `mode: 'open' | 'save'` (save adds a filename field, reusing `PromptDialog`'s
   input conventions).
2. New `apps/core/src/shared/hooks/useFileDialog.tsx` exposing
   `{ openFile, saveFile, fileDialog }`, built on core `Dialog` so it inherits the
   focus trap and Escape (`ui-conventions.md` §40). Export both from
   `src/index.ts`.
3. Root handling: default to `home`; keep `notes` reachable so Notepad's current
   behaviour is unchanged.
4. Wire the eight apps: replace each dead-end empty state with the house empty
   state plus a primary **Open…** button (`ui-conventions.md` §25), and add an
   Open entry to whatever toolbar the app already has.
5. Drop `notepad/src/components/FileBrowser.tsx` and point Notepad at the core
   hook.
6. Add a window-level drop target in the window renderer that resolves a
   File-Manager drag to `{ root, path }` and dispatches it through the existing
   open-intent channel, so apps need no new code path to accept a drop.

## Must preserve (regression surface)

- `useOpenIntent` / `openApp(appId, { openPath, root })` keep working unchanged —
  this adds a second way in, it does not replace the File Manager handoff.
- Notepad's behaviour is identical after losing its private copy, including the
  `notes` root.
- The dialog cannot escape the FS jail: it only ever renders what the authed
  `files` API returns, and never accepts a typed absolute path that bypasses
  `resolveSafe`.
- Save-as must not silently overwrite: an existing filename prompts to confirm.

## Verify bar

`turbo typecheck`, lint + format green for core and every touched add-on,
`turbo build` ok. An RTL test that the hook resolves to `{ root, path }` on pick
and `null` on cancel.

**Verified in a browser**: from a bare desktop, open Sheets → Open… → pick a
`.csv` → it loads, with no File Manager involved. Repeat for the other seven.
Drag a file from File Manager onto an open Image Viewer and confirm it opens.
Cancel the dialog and confirm the app is unchanged. Check the dialog at 1280×577
(brief 52) — it must be fully usable.

## Out of scope

Recent-files lists, favourites/bookmarked folders, a tree sidebar in the dialog,
thumbnail previews, multi-select open, uploading from the host machine, and the
user-editable default-apps registry (its own brief).
