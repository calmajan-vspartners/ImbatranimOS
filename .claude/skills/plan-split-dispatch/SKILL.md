---
name: plan-split-dispatch
description: Repo-agnostic implementation orchestrator. The controller (opus) plans a coding task, splits it into independent chunks, classifies each as hard or easy, then dispatches hard chunks to a subagent on opus ("senior") and easy chunks to a subagent on sonnet ("junior") — each a fresh subagent with curated context. Routes cheap tokens to cheap work. Use when the user says "split this into chunks", "implement with subagents", "plan with opus and do the easy parts on sonnet", "route by difficulty", "/plan-split-dispatch", or asks to carry out a multi-step coding task that decomposes into several independent pieces. Also runs a backlog of pre-written briefs in dependency waves with a verify+checkpoint gate between waves — say "build all the briefs", "run the backlog in waves", "be the master orchestrator". NOT for one- or two-file changes — the orchestration tax outweighs the work; just edit those inline.
---

# Plan, Split, Dispatch — model-routed subagent implementation

You (the controller) stay in this session on **opus**. Your job is **not** to
write the code — it is to **plan, split, classify, dispatch, and integrate**.
Subagents do the actual edits. This routes expensive (opus) reasoning to the
hard chunks and cheap (sonnet) execution to the mechanical ones, and keeps your
own context lean so coordination doesn't degrade over a long run.

**Core principle:** one **fresh subagent per chunk**. The controller curates
exactly the context each subagent needs — they never inherit your conversation
history. This is what makes it token-efficient *and* failure-resistant: no
context pollution, and the full transcript isn't reprocessed every turn.

This is the portable, repo-agnostic cousin of project-specific implement
skills. It needs **no custom agents** — it dispatches the built-in
`general-purpose` agent with an explicit `model` override per chunk.

**Front door.** This skill is the generic implement target of the `orchestrate`
router, which runs on top of `corpus-flow`. When `orchestrate` hands off, it
passes the brief being built plus the matched rows of the project's
**READ / SKIP / SKILLS** table (from `corpus/routing.md`). Use them to fill each
chunk's `Read` / `Skip` / `Skills` fields so subagents read the right slice and
skip the rest. Invoked directly with no router, read `corpus/routing.md` yourself
if it exists; otherwise infer per-chunk context as usual.

## When to use

- The task genuinely decomposes into **≥3 independent chunks**, and several are
  mechanical (follow-a-pattern, tests-for-existing-logic, type/string
  propagation, formatting).
- The user invokes `/plan-split-dispatch`, or asks to "split this up", "do the
  easy parts on sonnet", "route by difficulty", or "implement with subagents".
- A **backlog of pre-written briefs** (e.g. `corpus/briefs/todo/*`) with
  dependencies between them needs building — run them in dependency waves. See
  **Backlog / wave mode** below.

## When NOT to use

- **One- or two-chunk tasks, or any single-file edit** → just do it inline. The
  plan + classify + per-chunk context-curation overhead costs more than the
  work. This is the most common misfire — guard against it.
- The whole task is one indivisible hard problem (can't be split without
  threading state between chunks) → do it inline on opus.
- Pure review (no edits) → use a review skill/command.
- Research-only ("explore X") → use the `Explore` agent directly.

## Token efficiency — when it actually pays off

This skill is a **router that puts cheap tokens on cheap work**, not a universal
saver. Be honest about the trade-off:

- **Wins** when ≥3 independent chunks exist and several are mechanical: sonnet on
  the easy chunks is far cheaper than opus, and the controller's context stays
  small (the conversation isn't reprocessed every turn; each subagent gets only
  curated context).
- **Loses** on small tasks: planning + classification + context curation is real
  overhead that dominates 1–2 chunk work.
- **Backfires** if you undersize: sonnet stalls on a hard chunk → `BLOCKED` →
  re-dispatch on opus = *more* tokens than just using opus once. Hence the
  **when in doubt → senior** rule below.

## Procedure

### Step 1 — Plan (controller, opus)

Plan inline. Produce a numbered chunk list. Each chunk must be **self-contained**
— a subagent dispatched against it should not need to read the other chunks to
understand what to do. Each chunk has:

```
### Chunk N: <short name>
- **Files**: create/modify paths (exact)
- **Goal**: one sentence
- **Acceptance**: one or two bullets — what "done" means
- **Read**: the files/docs this chunk needs (from the profile's READ column, or what you'd grep anyway)
- **Skip**: areas this chunk must not touch (the profile's SKIP column) — advisory; the senior list below still overrides
- **Skills**: skill(s) the subagent should load for this chunk, or `none` (from the profile's SKILLS column)
- **Tests**: which test file(s) and what they must assert (if applicable)
- **Constraints**: patterns to follow
- **Depends on**: Chunk M (if any) — controller serializes these
```

If two chunks have no dependency and edit disjoint files, mark them
**parallel-safe**.

### Step 2 — Classify (controller, opus)

Tag each chunk `[senior]` (opus) or `[junior]` (sonnet) with this **generic**
rule:

**Senior (opus)** — anything where being wrong is expensive or the path isn't
obvious:
- Security / auth / access control / secrets / crypto.
- Schema or data migrations, anything that mutates persisted state irreversibly.
- Concurrency, race conditions, transaction boundaries, locking.
- Cross-module / cross-package contracts, public API surface, anything other
  code depends on.
- New design where acceptance criteria have gaps the agent must close.
- Refactors that move code across module boundaries.

**Junior (sonnet)** — mechanical work with an explicit target and an existing
pattern to copy:
- Single-file edit with clear acceptance.
- A new call/query/component that follows an established pattern in the repo.
- Tests for already-implemented logic.
- i18n / copy / string additions.
- Formatting, lint fixes, dead-code removal.
- Type propagation (add a field to an interface and thread it through).

**Trivial (haiku)** — the cheapest slice of the above with *zero* judgement: pure
copy/string additions, threading one named field through, deleting named dead code,
formatting. Use it instead of sonnet when the chunk is essentially find-and-replace
against an explicit spec.

**The reference-pattern rule — the biggest cost lever.** The chunk that FIRST
establishes a pattern, contract, or new subsystem is senior; **subsequent chunks that
copy that now-existing in-repo reference are junior, even when they look substantial.**
A "new panel just like the one we just built" is junior — the design risk was already
spent on the first one. On a multi-chunk feature, expect the first chunk senior and most
later chunks junior.

**When in doubt → senior** *for genuine risk* (security/data/concurrency/novel design):
cheap to oversize there, expensive to undersize. But do **not** reflexively senior
pattern-following work — a clear reference implementation makes it junior, and
escalate-on-block (Step 5) is the safety valve, so it's fine to start a borderline
pattern-copy as junior. Opus should be the **exception** (the hard/novel/risky pieces),
not the default; a healthy plan is mostly junior with a few senior chunks.

### Step 3 — Confirm with user (MANDATORY)

Output the plan + classification in this shape and **wait**:

```
## Plan

**Goal:** <one sentence>

**Chunks:**
1. [senior] Chunk 1: <name> — <one-line goal> — <why senior>
2. [junior] Chunk 2: <name> — <one-line goal> — <why junior>
3. [senior] Chunk 3: <name> ...

**Parallel-safe groups:** {1, 2} can run in parallel; 3 depends on 1.

**Estimated dispatches:** N senior (opus), M junior (sonnet), K trivial (haiku){, + review (sonnet finders)}.
<!-- If N dominates, re-check the reference-pattern rule — pattern-copies should be junior. -->

Proceed? (yes / re-classify / re-scope)
```

Do not dispatch until the user replies. `re-classify` → swap the named tags and
re-confirm. `re-scope` → fold in changes and re-emit.

### Step 4 — Dispatch (per chunk)

Process chunks in dependency order; send a parallel-safe group as multiple
`Agent` calls **in one message**. Use `subagent_type: general-purpose` with an
explicit model:

- **Senior** → `model: opus`
- **Junior** → `model: sonnet`

Dispatch prompt template (fill in from the chunk + curated context — the
subagent has none of your history):

```
You are implementing Chunk <N>: <name>.

## Task
<paste the chunk block verbatim — files, goal, acceptance, read, skip, skills, tests, constraints>

## Context
Working directory: <abs path>
Branch: <current branch>
Skills to load: <the chunk's Skills, or "none">
<2–3 lines of any repo conventions that bear on this chunk — naming, layering,
"no comments", reuse-existing-components, etc.>
Skip (do not touch): <the chunk's Skip>. This is advisory scoping, NOT a licence —
if a Skip area turns out to be load-bearing for the task, report BLOCKED rather
than working around it.

## Pre-existing state
<the files this chunk touches + one line each, so the subagent doesn't grep around>

## What I need back
- **Status**: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Files changed (paths)
- Tests added/modified and pass/fail
- Concerns (if DONE_WITH_CONCERNS)
- Blocker (if BLOCKED — be specific)
- Missing info (if NEEDS_CONTEXT — name exactly what)
- **Handoff for dependents** (backlog/wave mode): the exact signatures, paths, and
  data shapes this chunk/brief produced that downstream work must consume. This is
  the connective tissue — the controller pastes it into dependent prompts.

Do not commit, push, or open a PR. The controller handles integration.
```

For **junior** dispatches, prepend one line:

```
This is a junior-scoped chunk. If the work turns out to touch anything in the
senior list (security/auth, migrations, concurrency, cross-module contracts,
public API surface, open design questions), STOP and report BLOCKED — do not
stretch your scope.
```

### Step 5 — Handle status

- **DONE** → mark complete, proceed.
- **DONE_WITH_CONCERNS** → if it affects correctness, fix before proceeding
  (re-dispatch with the fix); if observation only, note and continue.
- **NEEDS_CONTEXT** → supply the missing info, re-dispatch the same chunk.
- **BLOCKED** → triage:
  1. Context gap → provide it, re-dispatch.
  2. Junior over their head → re-dispatch the chunk as **senior** (opus). This is
     the rule working, not a failure.
  3. Plan is wrong → escalate to user, revise, re-confirm.
  4. Two attempts failed → escalate; do not loop a third time.

**Never** silently re-dispatch the same chunk with the same prompt — something
must change between attempts.

### Step 6 — Continuous execution + output discipline

After Step 3 approval, **execute the whole plan** without checking in between
chunks. Valid stops: an unresolvable `BLOCKED`, genuinely blocking ambiguity, or
all chunks done. (**Exception — backlog/wave mode:** stop at each wave boundary to
run the **Verify gate** and checkpoint, then continue. Within a wave, still run
straight through.)

You coordinate; subagents produce the heavy text. Keep your between-chunk
messages to a few status lines ("Chunk 3 dispatched (senior)…", "Chunk 3 DONE,
2 files, 14/14 tests"). Do **not** echo a subagent's full diff or re-narrate the
plan each turn — one giant turn risks the output-token cap and can lose the run.
Save detail for the final summary.

### Step 7 — Optional review

If the run was non-trivial (or the user asks), review the cumulative diff
(`git diff <base>...HEAD` — also `git diff HEAD` if uncommitted). For a substantial
multi-file build, **don't rely on one broad review agent** — dispatch **2–3 focused
finder agents in parallel, scoped by area/risk** (e.g. one on cross-file integration +
wiring correctness, one on the new module's own logic, one on reuse/cleanup/conventions),
each returning concrete `{file, line, summary, failure_scenario}` findings. **Finders
default to sonnet** — reading a diff and pattern-matching for bugs is mostly junior work;
reserve **opus for at most one finder on the highest-risk integration/correctness lens**,
or to adversarially verify an uncertain finding before acting. Then **consolidate + dedup**
their findings yourself, and dispatch **one fix agent whose tier follows the fix**
(haiku/sonnet for mechanical fixes — dead code, padding, a guard; opus only for subtle
correctness/integration/security), re-verify the gates, and stop. The scoped-finder shape catches integration bugs a single
generalist pass routinely misses (it has, every time). A repo review skill/command can
stand in for a finder. Skip review on small runs — say so explicitly rather than silently
dropping it.

### Step 8 — Deliver

```
## Done

**Chunks:** N senior + M junior, all DONE
**Files changed:** <count / list>
**Review verdict:** ship | fix-required | needs-discussion | skipped (small run)
**Suggested next:** <commit / open a PR / run the repo's PR skill>
```

Do not commit, push, or open a PR yourself unless the user asked — hand off
cleanly.

## Verify gate (between waves, and before final delivery)

A subagent reporting "tests pass" is **not** sufficient — verify it yourself, from
the controller, against the integrated tree. Run, in order, and do **not** proceed
past a failure:

1. **Typecheck** the whole workspace (the repo's typecheck cmd, e.g. `npm run typecheck`).
2. **Build** every package that emits artifacts dependents consume (a downstream
   wave often resolves a dependency from its built `dist/`, not source).
3. **Tests** for the packages touched this wave — and confirm prior waves still pass.
4. **Tracked, not just on-disk** (the silent-ignore check): `git status --porcelain`
   must list the expected new files, and `git check-ignore <new-source-dir>` must be
   empty for any new source directory. A chunk can build and test green entirely from
   files git is **ignoring** (e.g. an over-broad `store/` rule that also hides
   `src/store/`); this step catches that before it ships as "done".

On failure: fix in place — re-dispatch the owning chunk with the specific error —
before the next wave. Never let unverified breakage flow into a dependent wave; that
cascade is the whole reason this gate exists.

## Backlog / wave mode

Use this when the unit of work is a **set of pre-written briefs** with dependencies
between them (e.g. `corpus/briefs/todo/*`), not chunks of one fresh task. The briefs
already are the chunks; your job is to order, dispatch, verify, and integrate them.

1. **Build the dependency DAG.** Read each brief's *depends-on*, *Files you OWN*, and
   *Files you must NOT touch*. An edge = brief B consumes a file or contract brief A
   owns. (If briefs don't declare ownership, infer it — and prefer adding it.)
2. **Group into waves.** A wave = every brief whose dependencies are all already done.
   Two briefs are **parallel-safe in the same wave iff their OWN sets are disjoint** —
   this, not worktrees, is the cheap parallelism lever (see Configuration → Parallel
   dispatch). Dispatch a wave as multiple `Agent` calls in **one** message.
3. **Carry contracts forward.** Harvest each completed brief's **Handoff for dependents**
   and paste the relevant pieces into the prompts of briefs that depend on it. Dependent
   briefs are only as accurate as the contracts you thread in — don't make them re-derive
   an interface a prior brief already pinned down.
4. **Verify gate + checkpoint between waves.** After each wave, run the **Verify gate**.
   Then, if the user asked for per-brief / per-wave commits, commit each completed brief
   separately on the current branch (never a protected branch without asking). Only then
   dispatch the next wave. Present a one-line wave plan up front so the user sees the
   shape (`01 → 02‖08 → 03 → 04‖06 → 05 → 07`).
5. **Standing authorization.** If the user pre-authorized the whole build ("build all the
   briefs", "be the master orchestrator", "just go"), present the wave plan **once** and
   execute through it — don't re-gate every wave. Reserve the Step-3 confirm gate for
   genuinely ambiguous scope. Closeout (move briefs to done, log, fold findings —
   including any deviations/discovered-gaps the agents reported — into the wiki) is the
   controller's, via `corpus-flow` §4.

6. **Pause & checkpoint on demand (quota / session boundary).** If the user says they are
   near a quota/usage limit or asks to pause, **stop at the next wave boundary** (never
   mid-wave with subagents in flight) and write a durable resume point to the corpus before
   ending: which waves/briefs are **done** (with their Handoff-for-dependents contracts),
   which are **in-flight or next**, the current branch + last commit, and any open decisions.
   Put it at `corpus/log.md` (or a `corpus/resume-<date>.md` brief) so a **fresh session can
   pick up cold** without re-deriving state. Confirm what was written and stop — do not start
   another wave. This is a first-class action, not a failure mode.

Each brief is dispatched with the Step-4 template and must return a **Handoff for
dependents** section.

## Configuration

- **Default model routing**: trivial = haiku, junior = Sonnet, senior = opus,
  controller = opus. **Bias to the cheapest tier that can do the chunk** — opus is the
  exception (novel/risky/security/data), not the default. Current-generation Sonnet is a
  strong *executor* — reliable on well-specified, well-gated chunks **including medium-hard
  ones** (not just mechanical copies), so **bias borderline chunks → junior** rather than
  reflexively senioring them. Review finders default to Sonnet (Step 7). **Keep opus in the
  controller/verify seat — do NOT promote Sonnet to it**: the controller's value is planning
  the grounded briefs the executors succeed *inside*, plus being a *stronger second opinion*
  at verify time and making the expensive-if-wrong calls (design/contract decisions,
  real-bug-vs-stale-test adjudication). Hard objective gates (tests, determinism/
  byte-identity checks) are the net that makes routing risky chunks down safe. Keep the
  controller's own turns lean (don't echo subagent diffs) so the one unavoidable opus seat
  stays cheap. Override per-chunk when the user asks ("do all of these on sonnet to save
  cost" / "promote chunk 3 to opus").
- **Parallel dispatch**: only within a parallel-safe group, and only for chunks
  that edit disjoint files. Never run two implementers against the same file in
  parallel.
- **File lanes** (preferred over worktree when feasible): when two parallel chunks
  would *otherwise* both touch a shared hub file (a central `main.ts`, a barrel, a
  router), split the work so each owns a disjoint set of files and state the lane
  **explicitly in each chunk prompt** ("you may edit ONLY X/Y; chunk N owns Z — do not
  touch it; if you can't avoid Z, report BLOCKED"). This keeps them genuinely
  disjoint → safe to run in one message, no worktree/merge overhead. Each chunk's
  transient typecheck errors from the other's half-done hub edits are expected; verify
  the *combined* gates after both land. Reach for worktree only when the edits can't be
  cleanly laned apart.
- **Worktree**: if chunks mutate files in parallel and could conflict, dispatch
  with `isolation: "worktree"`. On a protected branch (main/dev), refuse and ask
  the user to branch first.
- **Max retry per chunk**: 2. After two failures, escalate.

## Failure modes

- **Invoked on a 1–2 chunk task** → the orchestration tax loses tokens. Decline
  and edit inline instead; this skill is for ≥3 independent chunks.
- **Junior BLOCKED on a senior-only area** → re-classify, re-dispatch as senior.
  Signal, not failure.
- **Senior BLOCKED on a design call** → escalate to user; don't invent the design.
- **Two parallel juniors edit the same file** → controller bug; sequence them or
  use worktree isolation.
