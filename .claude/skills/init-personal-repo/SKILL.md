---
name: init-personal-repo
description: Wire a repo into the personal-skills workflow so any future Claude session auto-routes through the right skills. Writes (or idempotently updates) a delimited managed block in the repo-root CLAUDE.md that tells sessions to start with /orchestrate and maps each intent to its skill (research to web-research, code understanding to codegraph, capture to corpus-flow, build to plan-split-dispatch, design to impeccable), then bootstraps the corpus/ workspace and offers the codegraph layer. Use when the user says "init personal repo", "set up this repo for my skills", "wire this repo to personal-skills", "personalize this repo", "integrate this repo", or "/init-personal-repo".
when_to_use: The user wants a repo to integrate with the personal-skills plugin so fresh sessions know to route work through orchestrate, web-research, codegraph, corpus-flow, and the rest, instead of picking skills ad hoc. Run once per repo (re-run any time to refresh the managed block). Not for a one-off task in a repo you will not reuse, and it never rewrites the user's existing CLAUDE.md content - it only adds or updates its own delimited block.
---

# Init Personal Repo - wire a repo to the personal-skills workflow

The plugin ships the *workers* (orchestrate, web-research, codegraph, corpus-flow,
plan-split-dispatch, the design suite). What a fresh repo lacks is the
*activation* layer: a repo-root `CLAUDE.md` that makes a new Claude session route
work through them instead of choosing skills ad hoc. This skill installs that
layer, non-destructively.

Two routing layers, and this skill sets up both:

1. **repo-root `CLAUDE.md`** - *activation*. A managed block tells any session to
   start with `/orchestrate` and which intent maps to which skill.
2. **`corpus/routing.md`** - *configuration*. `orchestrate` reads this to route
   within the project; `corpus-flow` creates it on bootstrap.

## Table of contents

- [Golden rule: additions only](#golden-rule)
- [Steps](#steps)
- [The managed CLAUDE.md block](#managed-block)
- [Report](#report)

## Golden rule: additions only {#golden-rule}

An existing root `CLAUDE.md` is the user's file. **Never rewrite, reorder, or edit
their content.** This skill only ever adds or updates its own block, delimited by
`<!-- personal-skills:start -->` / `<!-- personal-skills:end -->`. Everything
outside those markers is left byte-for-byte untouched.

## Steps {#steps}

1. **Find the repo root.** `git rev-parse --show-toplevel` (fall back to the
   current working dir if not a git repo). All paths below are relative to it.

2. **Bootstrap the corpus.** If `corpus/` does not exist, invoke the `corpus-flow`
   skill to create it (`corpus/CLAUDE.md`, `index.md`, `routing.md`, `wiki/`,
   `briefs/`, `log.md`). If it already exists, leave it as is.

3. **Populate `corpus/routing.md`** with the intent -> skill routing table below,
   so `orchestrate` routes consistently. If the file already has a routing table,
   merge the personal-skills rows in rather than clobbering project-specific ones.

4. **Install the managed block in the repo-root `CLAUDE.md`** - exactly one of:
   - **No `CLAUDE.md`**: create it with a one-line title, then the managed block.
   - **`CLAUDE.md` exists, markers present**: replace only the text between the
     markers with the current block (idempotent refresh).
   - **`CLAUDE.md` exists, markers absent**: **append** the managed block to the
     end of the file (a blank line before it). Do not touch anything above.

   Read the file first to decide which case applies; use Edit for the
   marker-replace and append cases so surrounding content is provably preserved.

5. **Offer the codegraph layer** for a code repo (skip for a docs/notes-only
   repo): follow the `codegraph` skill to stand up and benchmark the code-graph
   layer, and record the per-repo envelope in a project skill at
   `.claude/skills/codegraph/SKILL.md` plus a `corpus/wiki/code-graph.md` page.
   Ask before installing tooling; do not auto-install.

6. **Report** what was created vs. updated vs. left alone (see below).

## The managed CLAUDE.md block {#managed-block}

Write this verbatim (it is intentionally generic and personal-info-free). Keep the
markers exact so re-runs can find and refresh it.

````markdown
<!-- personal-skills:start -->
## Working in this repo (personal-skills)

At the **start of any work request**, invoke **`/orchestrate`** - the work-intake
router. It ensures a `corpus/` workspace exists, reads `corpus/routing.md`,
classifies the request, proposes a plan, and hands off after approval. Do not
hand-pick a skill before orchestrate has routed, unless the user names one.

**Intent -> skill** (what orchestrate routes to; invoke directly only if the user
names it):

| Intent | Skill |
| --- | --- |
| Capture a note / idea / task; "what does the wiki say about X" | `corpus-flow` |
| Research a topic, compare options, produce a sourced report | `web-research` |
| Understand code: impact / blast radius, who-calls, explore, rename safety | `codegraph` |
| Build or implement a multi-step change | `plan-split-dispatch` |
| Design or redesign a frontend, UI polish, design audit | `impeccable` (+ `the-one-move` for a brand-new surface) |
| Quick single-screen UI check | `ui-check` |
| Stress-test a plan or design before building | `grill-me` |
| Measure live web performance | `performance-analysis` |
| Scaffold a Caddy VPS deploy | `bootstrap-vps-deploy` |

**Knowledge lives in `corpus/`** - the LLM-maintained wiki + todos/briefs
lifecycle. Fold reusable findings back into the corpus, not into chat.
`corpus/routing.md` is the per-repo routing config: edit it to tune how
orchestrate routes here.
<!-- personal-skills:end -->
````

The `corpus/routing.md` table uses the same intent -> skill rows, plus the
project's own READ/SKIP notes and any implement/review/PR skills specific to the
repo.

## Report {#report}

Close with a short summary: the `CLAUDE.md` action taken (created / block-refreshed
/ block-appended, and confirmation that existing content was untouched), whether
the corpus was bootstrapped or already present, and whether the codegraph layer
was set up, offered, or skipped. Point the user at `corpus/routing.md` as the dial
for tuning routing in this repo.
