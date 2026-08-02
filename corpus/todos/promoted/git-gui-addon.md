---
title: Git GUI add-on
created: 2026-07-17
status: promoted
tags: [add-on, developer, git]
---

# Git GUI add-on

A GitHub-Desktop / Fork-style panel over the container's real `git`: repo
status, stage/unstage, diff view, commit, log/history, branch switch. The
backend shells out to `git` in the selected working directory.

## Context

`git` is already in the box (this repo uses it); the real userland makes a real
git client genuinely useful, not simulated. Web + low-level devs both live in
git daily.

**Constraints to respect when this is grilled into a brief:**
- Needs a backend endpoint to run `git` as the unprivileged `imbatranim` user
  in a chosen path — no sudo, stay inside the home FS jail already used by the
  Files API.
- Auth on every route like everything else (project invariant).
- Start scoped: status/stage/commit/diff/log for one repo at a time; push/pull
  and credential handling are a second phase (ties into an SSH key story).

From the 2026-07-17 daily-driver research pass.
