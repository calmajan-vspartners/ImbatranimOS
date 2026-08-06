# Brief 76 — Git GUI: branches, discard, and per-hunk staging

Status: **done 2026-08-05** · From the 2026-07-31 app+OS improvement sweep.
MEDIUM · add-on `apps/add-ons/git-gui` (656 LOC) + backend
`apps/backend/src/modules/git/`. Standalone. Every backend addition stays behind
the existing session guard and the `resolveSafe` path jail, and reuses the
hardened `exec` seam — **no new spawn site**.

## Problem

The backend is a genuinely careful piece of work: one `exec` seam
(`git.service.ts:116`), array args only, never a shell, `--` pathspec guard,
`GIT_LITERAL_PATHSPECS=1`, `GIT_TERMINAL_PROMPT=0`, a jailed cwd, a
work-tree-inside-the-jail check, bounded time and output, and 20 tests. It was
adversarially security-reviewed. Nothing here should weaken any of that.

But the allowlist of subcommands is small — `rev-parse`, `status`, `log`,
`diff`, `add`, `reset`, `commit` (`git.service.ts:178-308`) — and that leaves
the app unable to do most of what people use a Git GUI for:

1. **No branches.** Cannot list, switch, or create. For most workflows that is
   the first thing you do, and its absence means the app can only ever describe
   the branch you happen to be on.
2. **No discard.** A file you have wrecked cannot be restored from HEAD without
   dropping to the Terminal — the most common "undo" in Git.
3. **All-or-nothing staging.** `add`/`reset` take whole paths; there is no
   per-hunk or per-line staging, which is how a reviewable commit gets built.
4. **No stash, no amend**, so an interrupted piece of work has nowhere to go.
5. **Diff is not side-by-side**, and there is no word-level highlighting.
6. **No repo picker or recents** — you navigate to a repo path each time.
7. **Large diffs and large repos are untested** against the 10 MB `maxBuffer`
   and 15s timeout; a big `diff` will hit those and the failure should be a
   clear message, not a generic error.

(As of 2026-07-31 the app is also no longer broken in production: `git` was
absent from both shipped artifacts and is now installed, with a clear 503 if it
ever goes missing again.)

## Proposed decisions (ungrilled)

- **Extend the allowlist deliberately, one subcommand at a time**, each through
  the existing seam with array args, each with tests. Add: `branch` (list/create),
  `switch`/`checkout` (branch switch and file restore), `stash`
  (push/pop/list), `commit --amend`, and `apply --cached` for hunk staging.
- **Read-only first, then mutating.** Branch listing and side-by-side diff carry
  no risk; switching and discarding can destroy uncommitted work and must be
  gated by `useConfirm({ destructive: true })` naming exactly what will be lost.
- **Per-hunk staging via `git apply --cached` with a generated patch**, which is
  how every GUI does it. The patch is constructed from the diff we already
  parse — no new parsing of user input, and the patch goes to stdin, never a
  shell.
- **Push / pull / fetch: NOT in this brief, and probably not in this app.**
  They need credentials — a token or SSH key — living in the container, and an
  outbound network path. That is a real security decision (where the secret
  lives, how it is encrypted, what an XSS in another app could reach) and it
  deserves its own grilled brief alongside the brief-50 SSRF stance. The Terminal
  already offers a real shell for anyone who needs to push today. **Say no here
  explicitly** so it stops being an implicit expectation.
- **Rejected — merge conflict resolution UI.** A large, subtle surface; the
  Terminal plus Code Editor covers it.
- **Rejected — a history graph.** Attractive, but log rendering with topology is
  substantial work for a single-user local repo browser. Revisit later.
- **Repo picker with recents**, persisted, using brief 54's directory picking.

## Fix

1. Backend, per subcommand: an allowlisted method on `GitService` using
   `this.git(...)`, its own DTO validation, and tests asserting the exact arg
   array (the existing `git.exec.spec.ts` pattern) plus jail behaviour.
2. `branch` list/create; `switch` with a dirty-tree guard; `restore`/`checkout --`
   for discard; `stash` push/pop/list; `commit --amend`.
3. Hunk staging: build a patch from the parsed diff, pipe to
   `git apply --cached` via stdin.
4. Frontend: branch selector in the toolbar; side-by-side diff with word-level
   highlight; per-hunk stage/unstage controls; destructive confirms; repo picker
   with recents.
5. Map `maxBuffer`/timeout overruns to a clear "diff too large" message rather
   than a generic failure.

## Must preserve (regression surface)

- **The single `exec` seam.** No new spawn site, no shell, no command strings,
  array args only. A reviewer will grep for exactly this.
- `--` pathspec guard and `GIT_LITERAL_PATHSPECS=1` on every path-taking
  command — including the new ones. A branch name is not a path and must not be
  passed where a pathspec is expected.
- The jail: repo cwd resolved only via `FilesService.resolveSafe`, and the
  work-tree top-level must stay inside the jail (the ancestor-`.git` case closed
  in brief 42).
- Session guard on every new route; no `@Public()`.
- The 2026-07-19 "Git GUI Select crash" fix in core stays fixed.

## Verify bar

`turbo typecheck`, lint + format green, `turbo build` ok, backend tests green
including the new per-subcommand arg-array assertions.

**Security review before commit** — the reviewer will try: a branch name
beginning with `-` or containing `--upload-pack=`, a branch or stash name that
is really a path, a repo path escaping the jail, a `.git` above the jail root, a
crafted patch fed to `apply --cached` attempting to write outside the work tree,
and a commit message full of shell metacharacters.

**Verified in a browser**: in a real repo, list and switch branches; discard a
modified file behind a confirm; stage one hunk of a multi-hunk file and commit
only that; stash and pop; amend a commit; open a very large diff and read a
clear message.

## Out of scope

Push/pull/fetch and credential storage (own brief), merge conflict resolution,
history graph, rebase, submodules, LFS, and tags.

---

## Outcome — done 2026-08-05

All seven problems addressed. The hardened backend is **unchanged in shape**: still one
`execa` seam, still array args, still no shell, still the `--` pathspec guard and the
jail. The allowlist grew from 7 subcommands to 12; the security properties did not
loosen, and two new guards were added because the new inputs are a new class.

### The one change to the seam, and why it is safe

`exec` gained an optional `input` for stdin, because per-hunk staging is
`git apply --cached` reading a patch. Stdin **is** the safety choice: a patch is the
one piece of large, structured, client-supplied text this module handles, and stdin
means it never becomes an argument, never a temp file, and never anything a shell
could see. Grepped after the fact: exactly one `execa(` call site, one
`shell: false`, and `--unsafe-paths` appears only in comments and in the test
asserting its absence.

### The new guard the brief's review is aimed at

A **ref is not a pathspec**, and this is the crux. `--` separates options from
*pathspecs*; there is no equivalent for `git switch <name>`, so a name beginning with
`-` would be read as a flag. `assertRefName` enforces git's own `check-ref-format`
rules in-process and refuses the input **before it becomes an argument** — 27 hostile
names are tested, including `-D`, `--upload-pack=/bin/sh`, `--exec=…`, `a..b`,
`refs/heads/@{now}` and `a.lock`. The pathspec guard is deliberately not reused: it
permits `-` and `..` on purpose, which is exactly what must not pass here.
`stash@{n}` is likewise built from a validated integer, never from client text.

### Per-hunk staging, and the claim I measured rather than trusted

`git apply --cached` with the patch on stdin. The security rests on git's default
path handling, and that was **measured on git 2.43 before the code depended on it**:

```
patch naming ../outside.txt      → error: does not exist in index
patch naming ../../etc/imb-pwned → error: invalid path
a legitimate hunk                → applies to the INDEX; the working tree is untouched
```

So `--unsafe-paths` must never be passed, and a test asserts that. A real-git test
then proves the thing flags cannot: **one hunk of a two-hunk file** is staged, the
other stays unstaged, the working tree keeps both edits, and committing lands only
the staged one. `--reverse` unstages the same hunk, so one code path serves both
directions.

### Considered departures from the brief, both recorded in decisions.md

1. **No server-side dirty-tree block on a switch.** Git already refuses a switch that
   would overwrite local changes and deliberately allows one that carries clean
   changes across — a normal, safe, very common workflow. Blocking it here would make
   the app worse than the Terminal it exists to save you from. So `branches` returns
   `dirty`, the **UI** warns and names the risk, and git's refusal is surfaced
   verbatim. Verified both ways in the browser: the warning appears, and a switch git
   refuses reports git's own sentence.
2. **Discard is tracked files only.** An untracked file is not in HEAD, so "restore"
   has nothing to restore it to — discarding it means *deleting* it, which is
   `git clean`, a more dangerous verb this brief does not add. The user is told
   plainly ("Not tracked by git… Delete it in Files instead") rather than given a
   silent no-op. `restore --worktree`, so discarding an unstaged edit never throws
   away something deliberately staged — tested.

### Found while probing, in no brief

- **The 10 MB cap failed silently, in the worst possible way.** With
  `reject: false`, a `maxBuffer` overrun arrives as a *result* with truncated or
  empty stdout — indistinguishable from "no changes". The backend now detects it
  (`isTooBig`, `isTimeout`) and returns 413 / 408 with a real sentence. Measured
  against a genuine 16.7 MB diff.
- **And then my own frontend swallowed that message.** I put the error text into the
  `diff` state, where `DiffView` parsed it as a diff, found no files, and rendered
  "0 hunks" over an empty body — so a correct 413 still reached the user as a blank
  pane. Found by actually opening the 16.7 MB diff rather than trusting the backend
  test. Fixed with a separate `diffError` state; the pane now shows the sentence.
- **A phantom context line in every parsed hunk.** `split('\n')` leaves a trailing
  empty element, and I was treating a bare `''` as a context line — git writes an
  empty context line as a single *space*. That added one line to every hunk, which
  went into the rebuilt patch and made its `@@` counts wrong. Caught by the
  round-trip test (parse → patch → parse) before it ever reached git.
- **A binary file parsed to nothing.** Its diff has no `---`/`+++` header, so it had
  no path and was filtered out as an empty parse. Paths are now also read from the
  `diff --git` line.

### Recents, and where they live

A `git_recent_repos` table with `UNIQUE(root, path)`, **not** the existing
`recent_files` — that one is Notes' (a bare path, no root), and folding two meanings
into one table is the shapeless-blob pattern this repo has refused since brief 71.
Recording is explicit rather than a side effect of `resolveRepo`, because status is
polled and a list that reorders itself while you read it is not a recents list. A row
whose directory has since gone is filtered out on read, so a deleted repo disappears
instead of 404-ing when clicked — tested.

### Security review, through the real HTTP API

Not only unit tests: every case on the brief's list was run against the running
backend, which exercises the DTO layer and the guard as an attacker reaches them.

```
REFUSED  branch/switch: -D, --upload-pack=/bin/sh, --exec=…, -, --, --force
REFUSED  branch names that are paths: ../../etc/passwd, /etc/passwd, refs/heads/../../x
REFUSED  repo paths escaping the jail: ../.., ../../etc, /etc, ..%2f.., gitprobe/../../..
REFUSED  a directory that is not a work tree
REFUSED  patches: parent traversal, absolute path, deep traversal, a .git/hooks write
ALLOWED  a stash label of shell metacharacters — it is legitimate text
CHECKED  nothing was created outside the work tree (8 candidate artefacts, 0 created)
401      all 13 new routes without a session cookie
SECURITY REVIEW CLEAN
```

### Verified in a browser, in a real repo

```
PASS branch bar shows "main" and lists main + feature/side
PASS the Select shows the branch NAME (core's Select fix from brief 75)
PASS f.txt reports 2 hunks with a Stage-hunk button on each
PASS side-by-side is the default, with 4 word-level highlight spans
PASS staging hunk 1 puts CHANGED TOP in the index and leaves CHANGED BOTTOM out
PASS committing lands only the staged hunk; f.txt stays pending
PASS discard confirms by name ("Throw away your changes to f.txt?") and restores
PASS discarding an untracked file is refused with the reason, not a no-op
PASS stash with a label, then Pop, both reported; the stash list empties
PASS amend is seeded with HEAD's message and REPLACES the commit (count unchanged)
PASS a dirty switch warns first, then reports git's own refusal verbatim
PASS a 16.7 MB diff shows "That output is too large… use the Terminal for this one"
PASS the recents list persists and reopens the repo when clicked
page errors: none
```

Tests: backend unit **208 → 282** (74 new — 57 asserting the exact arg arrays and the
27 hostile ref names, 17 against real git in a real jailed repo). Frontend vitest
**886 → 916** (30 new in a package that had **zero**, covering the diff parser, the
patch builder's round trip, side-by-side pairing and the word diff).
*(Corrected 2026-08-05: this first read "828 → 858", a baseline carried over from
brief 74 instead of brief 75's. The 30-new figure was right.)* Backend e2e
unchanged at 138. All 102 turbo tasks green. Zero new dependencies.

Out of scope and untouched, as specified: push/pull/fetch and credential storage
(recorded as its own future brief, with the reason), merge-conflict resolution, a
history graph, rebase, submodules, LFS, and tags. Drag-free per-*line* staging is not
here either — `patchForHunk` recomputes its counts precisely so that a later brief can
add line selection without touching the backend.
