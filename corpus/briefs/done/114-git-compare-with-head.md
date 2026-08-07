# Brief 114 — Git GUI: Compare with HEAD, in the real diff editor

> **Outcome (2026-08-07): DONE.** `show` joined the allowlist as one more
> literal at one more call site — still no generic "run git" route. The
> revision is the hardcoded `HEAD`, never a parameter: the feature is "compare
> with what is committed", and a `rev` would widen the surface to every object
> in the repository for nothing the UI asks for. `assertRepoRelPath` sits on
> top of `assertPathspec` for the one place a path becomes part of a *revision*
> argument (`HEAD:<file>`) rather than a pathspec after `--`: no leading `-`,
> never absolute, no `..` segment. A file with no blob at HEAD returns
> `{ content: '', exists: false }` — newly added is a state, not an error.
>
> Six new cases against **real git**: the committed text comes back while the
> working tree is untouched, a subdirectory path resolves, a staged-but-never-
> committed file reports `exists: false`, `../outside.txt` and
> `src/../../outside.txt` are both refused, an absolute path and a leading `--`
> are refused, and a filename full of shell metacharacters stays literal (the
> brief-76 habit — the touch never happens).
>
> The Diff tool's intent grew `leftText` + `leftLabel`. Git GUI already talks
> to the git API, so it fetches the blob and hands the text over rather than
> the editor package learning about git; the existing `leftRoot`/`leftPath`
> path is untouched and still what the file manager's two-file Compare uses.
> The right side stays the working-tree file with the full save spine, which is
> the point — see the diff and fix it in place.
>
> **A bug found only by closing the window.** With models loaded,
> `keepCurrentOriginalModel: false` lets @monaco-editor/react dispose both text
> models while the widget still points at them, and Monaco logs "TextModel got
> disposed before DiffEditorWidget model got reset". The Diff tool now detaches
> with `setModel(null)` in its own unmount cleanup, which React runs before the
> child's on a deletion. Reproduced in this brief's flow and not in the
> brief-99 two-file flow, so it was latent rather than universal — either way it
> is gone, and §14's clean-console bar is what surfaced it.
>
> One correction the probe forced: the Diff tool's app id is `diff`, not
> `diff-tool` (`code-editor/src/index.ts:54`) — the intent went nowhere until
> that was fixed, silently, which is the argument for probing rather than
> reading.
>
> Verified: turbo 120/120, backend 457 unit (+6) + 141 e2e, and a 9-check
> browser probe on the production bundle against a real repository — the button
> hidden until a file is selected, the committed text on the left under a
> `tracked.txt @ HEAD` label with the working copy on the right, a
> staged-but-uncommitted file compared against an empty left side labelled
> `HEAD (new file)`, and a clean console.

Status: **done** · From the 2026-08-07 research sweep.
MEDIUM · backend (`git show` joins the allowlist) + `git-gui` + a small
additive field on the Diff tool's intent. No protocol change —
`packages/ui/src/system.ts` untouched. The brief-99 deferral, whose own text
named this as the follow-up.

## Problem

Git GUI shows a *unified text diff* (`components/DiffView.tsx`, over
`GET /api/git/diff`). Brief 99 gave the OS a real side-by-side Monaco diff
editor with an editable right pane — and Git GUI, the one app whose entire
job is comparing versions of a file, cannot open it. The only door into the
Diff tool today is the file manager's two-selection Compare, which needs
**two files on disk**; "this file, versus what is committed" has no second
file to point at.

Two facts the design has to respect, verified in the code:

1. **The exec allowlist has no `show`.** Every subcommand is a literal at a
   call site inside `GitService` (`git.service.ts`), built through
   `this.git(...)` with `--no-pager`, `color.ui=never`, `shell: false` and an
   array argv. There is deliberately no generic "run git" route
   (`git.controller.ts:31`), so reading a blob at HEAD needs a new, narrow
   method — not a parameterised one.
2. **The Diff tool reads both sides from the filesystem**
   (`DiffTool.tsx:76-110`, `system.fs.read(root, path)`). A blob at HEAD is
   not a file on disk, so the intent has to be able to carry text.

## Decisions

- **The revision is fixed to `HEAD`, never client-supplied.** The feature is
  "compare with HEAD"; a `rev` parameter would widen the surface to every
  object in the repo for no gain the UI asks for. The single argv element is
  built as `` `HEAD:${file}` `` — it cannot begin with `-`, so it can never
  be read as a flag even before `--`. Rejected: a general
  `GET /git/show?rev=` (a bigger allowlist entry than the feature needs).
- **Pathspec scrutiny at brief-76 grade.** `file` must be non-empty, contain
  no NUL, not start with `-`, not be absolute, and contain no `..` segment.
  The jail still comes from `resolveRepo` — this is defence in depth against
  the argv, not the filesystem.
- **A missing HEAD version is a normal answer, not an error.** A newly added
  or untracked file has no blob at HEAD; the route returns
  `{ content: '', exists: false }` so the UI can diff against empty and say
  "new file" rather than showing a failure for a file that is simply new.
  Rejected: 404 — the caller would have to treat a routine state as an error.
- **The Diff tool's intent gains `leftText` + `leftLabel`.** The Git GUI
  already talks to the git API; it fetches HEAD and hands the text over,
  rather than the Diff tool learning about git. Additive: the existing
  `leftRoot`/`leftPath` path is untouched, and `leftText` wins only when
  present. Rejected: writing HEAD to a temp file (a file the user never
  asked for, in a jail that is theirs); rejected: teaching DiffTool to call
  `/api/git/show` (couples the editor package to the git module).
- **The right side stays the working-tree file**, editable with the full
  save spine — which is the point: see the diff against HEAD and fix it in
  place. The left side is read-only, as it already is.
- **Entry point: the file row's context menu and a toolbar button**, beside
  the existing Stage/Unstage/Discard verbs, enabled only for a file that
  exists in the work tree.

## Fix

1. `git.service.ts`: `showAtHead(root, path, file)` → `{ content, exists }`,
   built on `this.git('show', \`HEAD:${file}\`)`, with the stricter
   `assertRepoRelPath` guard. A non-zero exit whose stderr names a missing
   path returns `exists: false`; anything else throws as today.
2. `git.controller.ts` + a DTO: `GET /api/git/show?root=&path=&file=`. No
   `@Public()`; the global guard applies as everywhere else.
3. `git-gui/src/api/gitApi.ts`: `fetchHeadContent`.
4. `GitGui.tsx`: a "Compare with HEAD" action that fetches the blob, reads
   the working-tree file, and opens `diff-tool` with
   `{ leftText, leftLabel, rightRoot, rightPath }`.
5. `DiffTool.tsx`: `leftText`/`leftLabel` on the intent; a literal-text side.
6. Backend spec cases + a frontend unit test for the guard.

## Must preserve (regression surface)

- No generic git route; `show` is one more literal at one more call site.
- `resolveRepo`'s jail, the top-level containment check, the timeout, the
  output cap and `shell: false` all unchanged.
- The file manager's two-file Compare works exactly as before (the intent
  change is additive).
- Git GUI's unified `DiffView` stays — this is a second way to look, not a
  replacement.
- No `@Public()`; no new dependency; `system.ts` untouched.

## Verify bar

`turbo typecheck`, lint + format, `turbo test`, `turbo build` green; backend
unit tests for the new method named in the outcome.

**Verified in a browser** (production bundle + real backend): in a repo with
a modified tracked file, Compare with HEAD opens the Diff tool with the
committed text on the left and the working copy on the right; editing the
right side and saving writes the working file; a newly added file compares
against an empty left side labelled as new; a path with `..` is refused by
the backend. Console clean (§14).

## Out of scope

Comparing arbitrary revisions or two commits, blame, staged-vs-HEAD as a
third mode, and anything to do with remotes (brief 136).
