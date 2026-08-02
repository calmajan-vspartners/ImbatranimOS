# Brief 76 — Git GUI: branches, discard, and per-hunk staging

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
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
