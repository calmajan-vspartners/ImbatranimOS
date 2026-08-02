# Brief 61 — Code Editor: use the editor we already paid for

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
MEDIUM · add-on `apps/add-ons/code-editor` (392 LOC). Depends on brief 54 for
Open/New and brief 52 for the window clamp. Consumes the existing
`code-editor-file-menu` todo rather than duplicating it.

## Problem

Monaco is the heaviest dependency in the repo, self-hosted with real workers and
fully lazy (brief 41) — the expensive part is done and the eager bundle is
unaffected. But the app uses a fraction of it, and has three concrete defects:

1. **Native `window.confirm` at `CodeEditor.tsx:250`.** The one dialog this app
   shows is the OS's only unthemed dialog, alongside `useUnsavedGuard`'s own
   native confirm (`ui-conventions.md` §43). It breaks the illusion harder than
   anything else in the app, because a browser-chrome dialog is unmistakably
   *not* the OS.
2. **`defaultSize.height` is 680**, which cannot fit a 577px-tall viewport;
   `ui-conventions.md` §20 names this app specifically. Brief 52 clamps it, but
   the declared default should also be honest.
3. **Minimap is on by default** (`:92`) in windows that are frequently narrow,
   where it costs a meaningful slice of a small editor for little value, and
   there is no toggle.

Beyond the defects, the capabilities Monaco gives away that are not wired:
format-on-save, a diff view, go-to-line/symbol UI, a proper find-in-files across
the workspace, per-language tab/indent settings, bracket-pair colourisation,
tab session restore (close the window and every open tab is gone), and a
minimap/word-wrap/font-size control surface. There is also no File menu — an
already-captured, deliberately deferred todo (`corpus/todos/code-editor-file-menu.md`).

## Proposed decisions (ungrilled)

- **Kill the native dialogs here.** Replace `:250` with `useConfirm`. The
  `useUnsavedGuard` native confirm is core's and is fixed in its own change;
  this brief must not add a third dialect.
- **Adopt the deferred File menu** as part of this work rather than as a
  separate change: New / Open… / Save / Save As… / Close tab, built on brief
  54's `useFileDialog`. That is what makes the app usable without File Manager,
  and it is the todo's whole content — mark that todo consumed.
- **Format-on-save, opt-in, off by default.** Monaco's formatters for JSON/CSS/
  HTML/TS are built in; a formatter silently rewriting a file the user did not
  ask to reformat is worse than no formatter, so it is a toggle.
- **Restore open tabs per window on reopen**, keyed to the window's session.
  Note this interacts with brief 49 (ephemeral per-tab sessions vs durable
  dotfiles): open tabs are *session* state, so they should follow 49's session
  rule, not become a dotfile. Sequence after 49 or implement so 49 does not have
  to redo it.
- **Minimap off by default, with a toggle**; word wrap and font size beside it.
- **Diff view against the file on disk** ("show unsaved changes") using Monaco's
  `DiffEditor`, already in the bundle. Cheap, and genuinely useful next to Git.
- **Rejected — a language server / IntelliSense beyond Monaco's built-ins.** An
  LSP means a server process per language in the image; that is a different
  product and violates the slim-image identity. Monaco's built-in TS/JSON/CSS
  intelligence is the ceiling here, and it is already there.
- **Rejected — extensions/plugins.** The kill-list forbids a runtime package
  system; `manifest.ts` is the package system.
- **Deferred — find-in-files across the workspace.** The backend already has a
  bounded content grep (`/api/files/search?content=1`, brief 45). Wiring it into
  the editor is worthwhile but is a second surface; do it after the File menu.

## Fix

1. Replace the native confirm at `:250` with `useConfirm({ destructive: true })`.
2. Lower `defaultSize.height` in the manifest to something that fits a short
   viewport (≤620 per `ui-conventions.md` §20), and set an honest `minSize`
   measured at the point every control is still reachable.
3. File menu component driving `useFileDialog` for Open/Save As and the existing
   save path for Save; New creates an untitled model with a language picked on
   first save.
4. Editor options surface (minimap, wrap, font size), persisted; default minimap
   off.
5. Format-on-save toggle wired to `editor.getAction('editor.action.formatDocument')`
   before the existing write.
6. Diff view toggle comparing the in-memory model against a fresh
   `fetchFileBytes` of the same path.
7. Confirm the Monaco workers really are active (`?worker` imports from brief
   41) rather than silently falling back to the no-worker path — if they are
   not, syntax services run on the main thread and the app is slow for a reason
   nobody has looked for. Verify and record the answer.

## Must preserve (regression surface)

- Monaco stays **self-hosted and fully lazy** — no CDN, and the eager bundle
  measured at brief 33 (121.5 KB gzip) must not grow.
- Multi-tab behaviour, per-tab dirty state, and the real-FS save path.
- `languageForPath` routing and the `openWith` mapping (code extensions here,
  `.txt`/`.log` to Notepad).
- The theme follows the OS light/dark and accent, not a hardcoded Monaco theme.
- Existing find/replace (Monaco's own) keeps working; the File menu must not
  shadow its keybindings.

## Verify bar

`turbo typecheck`, add-on lint + format green, `turbo build` ok, and a build-size
check that the eager chunk is unchanged.

**Verified in a browser**: File → New → type → Save As into a real directory and
see it in File Manager; open a second file into a second tab and switch; edit
and use the diff view to see unsaved changes; toggle minimap and wrap; confirm
the close-with-unsaved dialog is the themed one, not the browser's; open at
1280×577 and confirm every control is reachable.

## Out of scope

Language servers, extensions, workspace-wide find-in-files (deferred), remote
editing, notebooks, and any change to the Monaco bundling strategy.

## Outcome — 2026-08-02 (superseded)

Superseded by [brief 88](../todo/88-code-editor-files-and-vscode-features.md),
written when the user asked directly for file/folder creation and more VS Code
features. 88 carries this brief's content forward — the native-confirm defect,
the 680px `defaultSize`, the minimap default, the deferred File-menu todo, and
the language-server rejection — plus the creation flows. Nothing here is lost;
this file is closed to avoid two briefs owning one app.
