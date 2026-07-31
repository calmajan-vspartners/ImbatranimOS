---
name: orchestrate
description: "Generic, repo-agnostic work-intake router that runs ON TOP OF corpus-flow. Use at the START of any work request in any project — \"let's work on X\", \"fix the Y bug\", \"open a PR\", \"add a todo\", \"work on brief 7\", or `/orchestrate`. It ensures a corpus/ workspace exists (bootstrapping one via corpus-flow if missing), reads corpus/routing.md to learn this project's intent routing + READ/SKIP/SKILLS + which implement/review/PR skills to use, classifies the request, presents a Route Plan, and hands off after approval — capture to corpus-flow, build to plan-split-dispatch, questions to the wiki. Router, never the worker. Improves quality (workspace memory + grilled briefs), token efficiency (model-routed dispatch + scoped context), and UX (one front door)."
---

# Orchestrate — Generic Work Intake & Router (corpus-flow front door)

You are the **single entry point** for work in this project. You do *not* do the
work — you ensure the workspace exists, decide what kind of work this is, and
hand off to the right skill. You are the conductor of three generic skills:

- **`corpus-flow`** — the project workspace: `corpus/` with an LLM-curated
  `wiki/`, immutable numbered **briefs** (per-chunk work specs), `todos/`, and
  `log.md`. Owns capture, the workspace knowledge, and closeout.
- **`plan-split-dispatch`** — the implementer: plans a build, splits it into
  chunks, classifies each hard/easy, and dispatches hard→opus / easy→sonnet as
  fresh subagents with curated context.
- **this skill** — the router that routes intake to the right one.

This is the **generic** variant. A repo with its own bespoke project router
should use that instead; this is for everything else.

<HARD-GATE>
Do NOT invoke any implement/review/spec skill until you have:
1. Ensured the `corpus/` workspace exists (Step 0).
2. Loaded `corpus/routing.md`.
3. Gathered context (Step 2).
4. Presented a Route Plan (Step 5).
5. Received explicit approval (`go` / `yes` / `proceed`).

Anything other than approval is an adjustment — update the plan and re-present.
</HARD-GATE>

## When to Use

- Start of a session, or any work request: a ticket ID, an MR/PR, a free-form
  intent, a lifecycle verb (`open a PR`, `tag a release`), or a workspace verb
  (`add a todo`, `work on brief 7`, `what does the wiki say about X`).
- Direct: `/orchestrate <args>`.

## When NOT to Use

- The user already invoked a specific skill (`/plan-split-dispatch`,
  `/corpus-flow`, a PR skill) — let it run; don't intercept.
- A genuinely trivial one-off in a repo you don't intend to track (a single
  obvious edit) — just make the edit; don't stand up a workspace for it. This
  skill is the **project-work** front door; it presupposes the project is worth
  a `corpus/`.
- The repo has its own bespoke router — use that.

---

## Step 0 — Ensure the workspace (required)

Look for **`corpus/routing.md`**.

- **Present** → load it. Its fields drive Steps 2–6:
  - `Implement skill` / `Review skill` / `PR skill` — the hand-off targets
    (implement defaults to `plan-split-dispatch`).
  - `Issue tracker` / `Code host` — what to query in the context fan-out.
  - `Intent routing` table — Step 3.
  - `Knowledge routing` table — which layer answers a given question (wiki /
    code graph / grep / guard test). Obey it before fanning out with grep+read.
  - `READ / SKIP / SKILLS` table — passed to the implement skill so each chunk
    reads the right slice and skips the rest.
- **Absent** → the workspace isn't set up. **Bootstrap it now** (don't ask for a
  ticket first): run `corpus-flow`'s bootstrap (§0) to create the `corpus/`
  skeleton, then scan the repo (one `Explore` agent, "very thorough":
  package manager + languages, top-level layout, any existing skills, test/lint/
  build commands, tracker/host from `git remote`) and seed `corpus/routing.md`
  from the template below. Announce it in one line ("Bootstrapped corpus/ +
  routing.md — tune routing.md anytime"), then continue. Never route without it.

**Code-graph layer.** If `.claude/skills/codegraph/` is absent, mention once that
`corpus-flow` §0b can bootstrap it (a benchmarked, repo-specific structural-query
skill) — then continue. Don't stall the request on it, and never create a
*personal* codegraph skill: the accuracy envelope is per-repo, so it belongs in
the project.

**Named-tool override (all modes):** if the user names a tool/MCP, use exactly
that — never substitute `Agent`/`WebFetch` for a named tool.

### `corpus/routing.md` template (what the bootstrap writes)

```markdown
# Routing — how work routes in this project
<!-- Read by the orchestrate skill. Tune freely; keep it short. -->

**Implement skill:** plan-split-dispatch      <!-- or a repo-specific implement skill -->
**Review skill:** <repo review cmd, or "a general-purpose agent over the diff">
**PR skill:** <repo PR cmd, or "propose git commands">
**Issue tracker:** <none | Jira/Linear/GitHub Issues + how to query>
**Code host:** <GitHub (gh) | GitLab (glab) | none>

## Intent routing
| Signal | Intent | Route to |
|--------|--------|----------|
| New idea/task to capture | capture | corpus-flow: add todo |
| Ready to build, ≥3 chunks | build | brief → plan-split-dispatch |
| Ready to build, 1–2 files | build (small) | brief → implement inline |
| Research a topic / compare options / sourced report | research | web-research |
| Measure live web performance | perf | performance-analysis |
| MR/PR open, not ready | review | <review skill> |
| Branch ahead, ship intent | PR open | <PR skill> |
| "what does the wiki say about X" | query | corpus-flow: query wiki |

## Knowledge routing — which layer answers which question
<!-- The corpus is the WHY; a code graph is the WHAT. Neither substitutes. -->
| Question shape | Route to |
|---|---|
| "Why is it built this way?" / "what was decided?" | `corpus/wiki/` (start at `index.md`; budget: ≤3 pages) |
| "Who calls X?" / "blast radius of X?" / "where does feature Y live?" | the `codegraph` **project** skill, if bootstrapped |
| **"Did I get _every_ usage?"** (rename/refactor/delete) | **`grep -rnw`** — the graph undercounts |
| A symbol name exported by two sibling packages | **`grep`**, scoped by path — the graph conflates them |
| A correctness invariant (dependency rule, determinism, palette) | **run the guard test** |

## READ / SKIP / SKILLS
| Task type | READ | SKIP | SKILLS |
|-----------|------|------|--------|
| feature   | corpus/wiki/decisions.md, the brief, <key dirs> | unrelated areas | <skills to load> |
```

---

## Step 1 — Mode Gate + Intake

**Mode gate** — classify into three:
- **Question** ("how do I X", "where is Y") → answer it. Explore silently if
  needed; no Route Plan. (If it's project knowledge, prefer querying the wiki.)
- **Trivial edit** — a 1–2 file, non-sensitive change with no design question →
  make it inline, show the diff, stop. (When unsure, treat as a task.)
- **Task** — implement / fix / add / refactor / review / ship / a workspace verb
  → run the full flow.

**Intake** — if a task is ambiguous, ask **one** question and stop:

> What are we working on? A ticket ID, an MR/PR, a short description, a lifecycle
> verb, or a workspace verb (`add a todo`, `work on brief N`).

Do not ask a second question — context gathering answers the rest.

---

## Step 2 — Gather Context (parallel fan-out)

Dispatch relevant probes **in a single message**; wait for all before classifying.

**Always:** read `corpus/index.md` (the workspace front door) + `corpus/wiki/status.md`;
list open briefs (`corpus/briefs/todo/`); `git status` + `git branch --show-current`.

**Conditional (driven by routing.md):**

| If input is | Add to the fan-out |
|---|---|
| A ticket ID | Fetch it via routing.md's tracker tool (description, status, AC). |
| An MR / PR | View it via routing.md's host CLI for description + changed files + state; get the diff. |
| Free-form intent | One `Explore` agent (medium breadth) with the topic terms + any path hint. |
| Verb-only ("open a PR") | `git log <base>..HEAD --oneline`, `git diff <base>...HEAD --stat`. |

Build a scratchpad: open-briefs digest, ticket/MR digest, candidate files, git
state, relevant wiki pages. Don't read whole files here — paths + one-liners suffice.

---

## Step 3 — Classify Intent

Walk routing.md's **Intent routing** table top-down; first match wins. The
generic spine:

| Signal | Intent | Hand off to |
|---|---|---|
| New idea/task to keep | **capture** | `corpus-flow` §1 — add a todo |
| Ready to build, decomposes into ≥3 chunks | **build (dispatched)** | ensure a brief (`corpus-flow` §2), then `plan-split-dispatch` |
| Ready to build, 1–2 files / one indivisible piece | **build (inline)** | ensure a brief, then implement inline |
| Research a topic / compare options / sourced report | **research** | `web-research` — inline searches, twin MD report + HTML digest |
| Measure a live page's performance | **perf** | `performance-analysis` — Chrome DevTools MCP, ranked by measured impact |
| MR/PR open, not "ready to merge" | **review** | routing.md review skill, else a `general-purpose` agent over the diff |
| Branch ahead of base, ship intent | **PR open** | routing.md PR skill, else propose git commands |
| "what does the wiki say about X" | **query** | `corpus-flow` §5 — query the wiki |
| Work finished, needs recording | **closeout** | `corpus-flow` §4 — done + log + fold into wiki |

If two match, prefer the later phase. If still ambiguous, present alternatives in Step 5.

**Research and design are gated, not auto-built.** `research` and new-feature `design` are terminal deliverables that produce **options for the user to choose from** — never a licence to start building. Hard sequence: *research/explore → propose the ideas → **user picks** what to promote → write brief(s) → build.* Do not skip from a research result straight to a brief or to `plan-split-dispatch`; surface the options and stop for the pick. For a non-trivial new feature, route the design through **`grill-me`** first (interview the user to resolve the open decisions), *then* write the briefs. The user asks for exactly this shape ("propose the ideas… let me pick what should be promoted to todo briefs", "grill me about it, then we'll write the briefs"). Any web search this involves runs **inline** (see `web-research`), not fanned out to a subagent, unless the user asks otherwise.

---

## Step 4 — Scope (for build intents)

For build work, name the affected areas from the candidate files, then pick the
matching **READ / SKIP / SKILLS** rows from routing.md. These get passed to the
implement skill so each dispatched chunk reads the right slice (token-efficient)
and stays in scope. SKIP is **advisory** — a chunk that finds a SKIP area is
load-bearing must report BLOCKED, not work around it.

---

## Step 5 — Present the Route Plan (mandatory gate)

Output in **this exact format** and stop. Trim aggressively.

```
## Route Plan — <one-line summary>

**Intent:** <capture / build (dispatched) / build (inline) / review / PR open / query / closeout>

**Workspace:** corpus/ present <new this session? yes/no>
**Context loaded:**
- Open briefs: <N> (next: <NN-slug>)                 [or "none"]
- Ticket: <ID — status — summary>                     [or "none"]
- MR/PR: <id — state — N files>                        [or "none"]
- Candidate files: <N> (top: <p1>, <p2>)
- Branch: <name> (<ahead>/<behind>, <clean|dirty>)
- Relevant wiki: <pages>                               [or "none"]

**Workflow chain (next skill in bold):**
1. **`<primary>`** — <one-line why>
2. `<follow-up>` — <why>                                [only if obvious]

**Context routing (passed to the implement skill):**
- READ: <…>   SKIP: <…>   SKILLS: <…>                  [or "n/a"]

**Open questions (block `go`):** <list, or "none">

Reply `go` to invoke `<primary>`, or tell me what to adjust.
```

---

## Step 6 — Hand Off

On `go` / `yes` / `proceed`:
1. State the hand-off in one sentence.
2. Invoke the primary skill via the Skill tool with the original args. For a
   **build**, that means: file/select the brief (`corpus-flow` §2), then invoke
   `plan-split-dispatch` (or routing.md's implement skill), passing the brief +
   the Step-4 READ/SKIP/SKILLS. After the build lands, route **closeout** to
   `corpus-flow` §4 so the work is logged and folded into the wiki, **then commit
   the completed brief** (see the commit principle below) — one commit for the
   code, one for the corpus change, per the repo's convention. Do **not** push.
3. Stop. The downstream skill owns the rest — don't narrate or re-classify.

Adjustments (anything but approval) → update the plan, re-present, loop until `go`.

---

## Principles

- **Router, not worker.** Your artifacts are the Route Plan + the hand-off.
- **Workspace first.** No routing without `corpus/routing.md`; bootstrap it if missing.
- **Quality comes from the workspace.** Grilled, immutable briefs + a curated
  wiki mean each build starts from settled decisions, not a cold prompt.
- **Token efficiency is the model + scope levers.** `plan-split-dispatch` puts
  sonnet on mechanical chunks and keeps the controller lean; READ/SKIP keeps each
  subagent's context scoped. Don't dispatch 1–2 chunk work — implement inline.
- **One question max** at intake; let context gathering answer the rest.
- **Confirmation every time** (except a Step-1 trivial edit).
- **Answer questions, don't task them.** Honor any tool the user names.
- **No chaining past the first hand-off** — except the build→closeout pair, which
  you own (dispatch, then route closeout to corpus-flow).
- **Commit completed briefs at closeout; never push without the user's go.** When
  a brief's build lands and closeout has recorded it, **commit** the work (one
  commit per brief, plus a separate commit for the corpus/wiki change, per the
  repo's "one commit per meaningful corpus change" convention) so git history and
  the corpus stay in step — don't leave finished briefs sitting uncommitted across
  a long multi-brief run. Pushing, PRs, tags, and force operations remain the
  user's explicit call. If the work isn't on a feature branch yet, branch first.
