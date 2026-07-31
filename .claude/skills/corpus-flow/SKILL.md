---
name: corpus-flow
description: Run a project's knowledge and work as an LLM-maintained wiki ("corpus") at the repo root — a curated wiki/ synthesis layer plus a todos→briefs→done+log work lifecycle. The LLM owns synthesis; the human curates sources and asks questions. Use when the user says "add a todo", "promote to a brief", "work on <brief>", "mark this done + log it", "what does the wiki say about X", "ingest this finding", "lint the corpus", "/corpus-flow", or wants durable, wiki-style project knowledge + task tracking (not the ephemeral in-session TodoWrite list). Bootstraps ./corpus on first use.
---

# Corpus Flow — a project's knowledge + work as an LLM-maintained wiki

A **corpus** is a small **LLM-maintained wiki** living in `corpus/` at the repo
root. The governing split: **the human curates the sources and asks the
questions; the LLM curates the synthesis and tracks the work.** It is the
durable counterpart to `TodoWrite` (ephemeral, in-session only) and to chat
(which evaporates) — reusable findings get **folded back into the corpus**, not
left in conversation or personal memory.

## The three layers

```
corpus/
  CLAUDE.md         schema + conventions for THIS corpus (written on bootstrap)
  index.md          content catalog — generated from each page's `summary:` frontmatter
  routing.md        which question goes to which layer (wiki / code graph / grep / tests)
  lint.sh           health check: frontmatter, link resolution, page size, stale paths
  log.md            chronological record of every meaningful change
  todos/            captured ideas/tasks as prose (pre-spec)
  briefs/           raw, immutable task specs
    todo/  done/  superseded/
  wiki/             LLM-curated synthesis pages — the actual knowledge base
    overview.md, architecture.md, decisions.md, status.md, open-questions.md, …
  test-plans/       (optional) plain-text browser test plans + latest RESULTS
    index.md  TP-NN-<slug>.md …  RESULTS.md
```

`test-plans/` is an **optional adjacent layer** — present only in projects with a
UI worth walking in a real browser. It holds plain-text, human-or-agent-runnable
plans (one `TP-NN-<slug>.md` per area, an `index.md` catalog, a `RESULTS.md`
snapshot of the latest run); the actual browser bring-up/fixtures live outside
the corpus (e.g. a gitignored `playwright/` hub). It is **authored by the
[`ui-test-plans`](../ui-test-plans/SKILL.md) skill**, not this one — corpus-flow
just gives it a home so runs feed findings back as todos/briefs and a `log.md`
line. Skip it entirely for backend/CLI/library projects.

1. **briefs/** — raw, **immutable**. Each file is a task spec used to direct a
   slice of work (often by a subagent). Once in `done/` or `superseded/`, do
   **not** edit it. New work gets a new brief in `todo/`.
2. **wiki/** — the LLM **owns** this. Synthesis, entity pages, concept pages,
   current status. Edited freely as understanding evolves. This is where
   durable knowledge accrues.
3. **index.md + log.md + todos/** — navigation and capture aids. Updated on
   every meaningful change.

The work lifecycle moves a single piece of work left-to-right; the wiki layer
is the standing knowledge the work draws from and feeds back into:

```
todos/<slug>.md             capture an idea/task as prose
      │  (promote)
      ▼
briefs/todo/<NN>-<slug>.md   a numbered work spec, ready to build
      │  (grill → plan → implement)
      ▼
briefs/done/<NN>-<slug>.md   moved verbatim (number kept) + outcome note
      │
      ├─► log.md             one chronological entry per meaningful change
      └─► wiki/              fold durable findings into the synthesis pages
```

Pick the matching section below by what the user asked. If ambiguous, ask one
question to disambiguate, then proceed.

---

## The wiki — what it is and what pages live in it

The wiki is **not** a freeform dump of notes. It is a small set of curated pages,
each with **one job and its own curation discipline**. The point is that a reader
(human or a fresh agent) opens `index.md`, sees the catalog, and lands on the one
page that answers their question — without spelunking the code or the brief
archive. Knowledge that doesn't fit one of the standing pages gets its **own
concept page**, not a paragraph wedged into an unrelated one.

A typical wiki has a **spine** of standing pages plus **entity/concept pages**
that grow as the project does.

### The spine (most projects want these)

- **`overview.md`** — what this project *is*, in a paragraph: the pitch, the
  lineage, the cast/major components, and what lives where at the top level.
  The orientation page. Short and stable.
- **`architecture.md`** — the structural map: workspaces/packages, layers and
  their dependency direction, the data-flow / main loop, the big boundaries.
  "How is it put together." Updated when structure shifts, not on every change.
- **`decisions.md`** — **locked** tech/design choices, listed so future briefs and
  reviews **don't relitigate them**. Each is a settled call ("npm workspaces, not
  pnpm"; "pinned versions"; "no `.js` import suffixes"). Changing one requires an
  **explicit revisit + a `log.md` note** — you don't quietly flip a decision.
  This page *wins* over `status.md` for choices not formally revisited.
- **`status.md`** — a **dated snapshot** of current state: a terse one-liner per
  brief/area and a short "where things stand" paragraph. **Detail is pushed
  down**, not duplicated — the brief file owns the full spec, `log.md` owns the
  history. Re-stamp the date when you update it. It's the living dashboard, kept
  deliberately thin.
- **`open-questions.md`** — only the **genuinely unresolved**. The moment a
  question is answered or shipped, **delete it from here** — its history lives in
  `status.md` + `log.md`. This page must never accumulate resolved cruft, or it
  stops being trustworthy as "what's actually open."

### Entity / concept pages (grow with the project)

One page per meaningful concept, subsystem, or entity — e.g. `economy.md`,
`world-generation.md`, `animation.md`, `performance.md`, `system-ordering.md`.
Each is the **single home** for its topic: the synthesis of how that thing works,
the decisions specific to it, the open threads, and links into the code. Rules:

- **One concept per file.** When a page passes ~200 lines or starts straddling
  two topics, **split it** and cross-link.
- **Born from ingest.** When a finding is named repeatedly but has no page (§6),
  create one and link it from `index.md`. A concept mentioned across three pages
  but owned by none is a lint finding (§7).
- **Code refs are relative and verifiable.** They drift — §8 before quoting.

### What makes it a wiki (not a notes folder)

- **Synthesis over transcript.** A page states the *current understanding*, not a
  log of how you got there. The chronology is `log.md`'s job.
- **The LLM curates, freely.** Rewrite a page as understanding improves; don't
  append-only. Stale phrasing is a bug to fix, not history to preserve.
- **Every page is reachable** from `index.md` (the catalog). Orphans get linted.
- **Pages can drift from code** — they're a view, not the truth. Source-of-truth
  ordering (Conventions) and §8 verification keep them honest.

---

## Frontmatter + the retrieval budget

A corpus exists to make an agent **cheaper**, not just better-informed. A wiki you
must *read* to discover is irrelevant has already cost you the tokens. So every
wiki page opens with exactly two keys:

```markdown
---
summary: <one line — what question this page answers. The triage signal.>
updated: <YYYY-MM-DD>
---
```

`summary:` is the load-bearing one. It is written **for an agent deciding whether
to open the page**, not as a title. "Ranked optimization backlog, filtered against
what the code actually does, and what is explicitly not worth doing at this scale"
tells you whether to open it; "Performance notes" does not.

This is the atomic-note idea (Zettelkasten / A-Mem) applied to a repo wiki: one
concept per note, each carrying an LLM-written description, so retrieval lands in
a small budget instead of pulling whole documents.

**`index.md` is generated from those summaries** — one line per page,
`bash corpus/lint.sh --index`. Never hand-maintain the catalog, and never let
`index.md` duplicate a list that another page already owns (a brief catalog belongs
in `status.md`; `index.md` links to it).

**The budget, stated in `corpus/CLAUDE.md` so a fresh agent inherits it:**

1. Read `index.md`. Then read **at most 2–3 wiki pages**.
2. Needing more than three is a **signal**, not a licence to read more: a page is
   straddling topics and must split, or the summaries aren't sharp enough. Fix the
   cause.
3. Never read `briefs/` or `todos/` wholesale. `status.md` holds every brief's
   state in one line; open a brief only for the spec that directed specific work.
4. Prefer the `summary:` line over opening the page. That is what it is for.

---

## The two-graph model — the corpus is the *why*, not the *what*

The corpus answers **why the code is the way it is**: decisions, intent, history.
It is authored, git-reviewed, and a source of truth.

It is the wrong tool for **what the code is**: "who calls X", "what breaks if I
change X", "where does feature Y live". Those belong to a **code graph** — a
generated, disposable symbol index (tree-sitter → SQLite, served over MCP). It is
regenerated from source, never hand-maintained, and **never a source of truth**.

Keeping them separate is what protects the budget above. An agent that greps and
reads twenty files to answer a structural question has blown its context before it
reaches the wiki; an agent that asks the wiki a structural question gets a stale
answer. Route each to its own layer (see the table in `routing.md`, §0).

**Never let the code graph's output be written into the wiki as fact.** The graph
is a lookup, not a finding.

---

## 0 — Bootstrap (first use in a project)

`corpus/` always lives at the **repo root** (`./corpus`). Before any operation,
ensure the skeleton exists:

```bash
mkdir -p corpus/todos corpus/briefs/todo corpus/briefs/done \
         corpus/briefs/superseded corpus/wiki
```

If they're missing, create:

- **`corpus/CLAUDE.md`** — the schema/conventions for this corpus. Adapt the
  **Conventions** and **Workflows** sections at the bottom of this skill into a
  concise per-project version (so a fresh agent opening the repo learns the
  rules without this skill loaded). Note the source-of-truth ordering and tell
  agents to read `index.md` first.
- **`corpus/index.md`** — the content catalog (what lives where), starting with
  links to CLAUDE.md, log.md, and the wiki pages. This is the front door.
- **`corpus/log.md`** — a `# Log` heading and nothing else yet.
- **`corpus/routing.md`** — the routing profile read by the `orchestrate` skill
  (the front door): implement/review/PR skill choices, an intent table, a
  READ/SKIP/SKILLS table, and the **knowledge-routing table** (§0b). Seed it with
  `Implement skill: plan-split-dispatch` and stub the rest — see the template in
  the `orchestrate` skill. If `orchestrate` does the bootstrap it enriches this by
  scanning the repo; created here so the file always exists. Link it from `index.md`.
- **`corpus/lint.sh`** — the health check (§7). Write it at bootstrap so the
  invariants are enforceable from day one, not aspirational prose. It must check:
  every wiki page has `summary:` + `updated:` frontmatter; every relative link
  resolves; no page exceeds ~200 **body** lines (frontmatter excluded); no page
  references a directory layout the repo has since abandoned. `--index`
  regenerates `index.md`'s catalog block from the summaries. Exit non-zero on
  failure so it can gate a commit.
- **The wiki spine** — at minimum seed `corpus/wiki/status.md` (the living
  dashboard). Also seed `overview.md`, `architecture.md`, `decisions.md`, and
  `open-questions.md` when you have enough to say — even a stub paragraph each is
  better than a missing page, because it gives ingest (§6) a home to grow into.
  See the wiki section above for what each page is for. Don't fabricate content
  to fill them; a one-line "TODO: …" stub is fine. **Every page gets frontmatter**,
  stubs included.

Keep index.md and log.md minimal — they are navigation aids, not content.
Tell the user you bootstrapped the corpus; don't make it a ceremony. Do **not**
commit anything in this skill unless the user explicitly asks — the user
controls when corpus changes land in git.

---

## 0b — Add the code-graph layer (the *what*)

The corpus is the **why** layer (synthesis, decisions, status). A generated code
graph is the complementary **what** layer — call graph and impact/blast radius
for change-planning. A corpus without it leaks tokens on structural questions
("who calls X", "what breaks if I change Y"). During bootstrap, or when the user
asks to add it, stand this layer up.

**The method lives in the personal [`codegraph`](../codegraph/SKILL.md) skill** —
the graph-first / grep-verify loop, the pinned install, the accuracy-envelope
benchmark, and the when-to-trust-vs-verify triggers. Follow it; do **not**
re-derive it here. This section is only how the result plugs into the corpus:

1. **Bootstrap per the `codegraph` skill, and commit the wiring.** Install pinned
   (`@colbymchenry/codegraph@<pin>`, MIT but effectively single-maintainer, a
   supply-chain surface even offline), `codegraph init`, telemetry off, confirm
   the native backend, gitignore `.codegraph/`. **Commit the MCP registration into
   the repo `.mcp.json`** rather than leaning on a per-dev `codegraph install`: a
   manual per-dev step reliably never gets run, so the graph tool silently stays
   absent from most sessions and the whole layer goes dead (the failure mode this
   skill exists to prevent). Point the server at the index with an
   env-overridable path so **one canonical index is shared read-only across
   worktrees** instead of re-`init`ed per throwaway tree:
   `serve --mcp --no-watch --path ${CODEGRAPH_INDEX_PATH:-<index-dir>}` (Claude
   Code expands `${VAR:-default}` in `.mcp.json`, so the committed default works
   for a single checkout while worktree users export the absolute path once). Wrap
   the build in a one-command task-runner script (e.g. `npm run codegraph:init` /
   `codegraph:sync`) so onboarding is one line, not a hunt through the docs.
   **Do not skip its benchmark**: the tool is `tree-sitter + a heuristic
   resolver`, not a compiler, so token-savings claims hold only for the queries it
   is good at and it is silently wrong elsewhere. The envelope is per-repo.

2. **Write the per-repo project skill** at `.claude/skills/codegraph/SKILL.md`
   carrying the *measured* envelope: a *use it for* table (callers, impact/blast
   radius, first map of an unfamiliar area) and an explicit *do NOT use it for*
   list — rename/"every usage" completeness (use `grep -rnw`), the conflated
   duplicate-name list from the benchmark, and any correctness invariant a guard
   test already covers. It lives in the **project**, never in personal skills:
   its whole value is the repo-specific accuracy numbers, which cannot be written
   once and reused. (The personal `codegraph` skill supplies the method; the
   project skill records what the method measured *here*.)

3. **Make the numbers durable in the corpus.** File the benchmark as a
   `wiki/code-graph.md` page, and add the knowledge-routing table to
   `corpus/routing.md` (question shape → layer: wiki / code graph / grep / tests)
   so the graph becomes a first-class member of this project's structure, not a
   rediscovered afterthought.

**The working rule, everywhere:** lead with the graph to *locate* and *scope*;
verify with `grep` or a guard test before *acting* on completeness. A cheap wrong
answer is worse than no answer.

---

## 1 — Add a todo (capture)

For a durable task/idea/follow-up the user wants to keep. Prose, **not** a
formal spec yet.

1. Get the todo text. If the user gave a bare "add a todo" with no content, ask
   what it is — one question, then proceed.
2. Derive a kebab-case slug from the gist (e.g. "fix the scalloped shore mask" →
   `fix-scalloped-shore-mask`). Filename: `corpus/todos/<slug>.md` — do NOT
   date-prefix the name; the date lives in the `created:` frontmatter below.
   On a name clash, append `-2`, `-3`, ….
3. Write the file:

   ```markdown
   ---
   title: <one-line title>
   created: <YYYY-MM-DD>
   status: open
   tags: [<optional>]
   ---

   # <title>

   <The task in the user's framing — what needs doing and why.>

   ## Context

   <Motivation, related files, constraints. Relative markdown links to code or
   corpus pages where relevant. Omit the whole section if there's nothing.>

   ## Acceptance

   <What "done" looks like, if the user stated it. Omit if unclear.>
   ```

   Fill only sections you have real content for; drop the empty ones. Stay
   faithful to the user's wording — don't invent scope or acceptance criteria.
4. Confirm: report the clickable relative path + a one-line summary. One todo
   per file (multiple todos → one `Write` each).

---

## 2 — Promote a todo to a brief

When the user is ready to actually build a todo (or files a brief directly).

1. **Pick the next number.** Briefs are numbered with a zero-padded prefix that
   is **stable for the life of the file**. Find the current max across
   `corpus/briefs/{todo,done,superseded}/` and add 1:

   ```bash
   ls corpus/briefs/todo corpus/briefs/done corpus/briefs/superseded 2>/dev/null \
     | grep -oE '^[0-9]+' | sort -n | tail -1
   ```

   Use 2-digit padding (`07`, `42`) unless existing briefs use more.
2. **Write `corpus/briefs/todo/<NN>-<slug>.md`** as a self-contained work spec a
   fresh agent could execute without other context:

   ```markdown
   # Task <NN> — <Title>

   ## Context
   <Why this exists, the problem, links to the source todo and relevant code.>

   ## Files you OWN
   <Paths this work creates/edits. Be specific — this is the contract.>

   ## Files you must NOT touch
   <Anything adjacent that another change owns, integration points, generated
   files. Omit if nothing applies.>

   ## What to do
   <The plan, concrete enough to act on. Numbered steps if multi-part.>

   ## Acceptance
   <Observable "done" — tests pass, behavior X, typecheck clean, etc.>
   ```

3. If promoting from a todo, mark the source todo `status: promoted` (add a line
   linking the brief) or delete it — ask which the user prefers if unclear;
   default to marking it promoted so the trail survives.
4. Confirm the brief path. Don't start building yet unless the user said to.

---

## 3 — Work a brief: grill → plan → implement

When the user says "work on brief NN" / "let's build this". Three phases, **in
order**. Do not write implementation code before the plan is acknowledged.

### 3a — Grill the design (inline)

Interrogate the brief until the design is unambiguous. Ask the user pointed
questions — one tight batch, not a stream — covering whichever of these actually
have open branches:

- **Scope boundary.** What's explicitly in vs. out? What's the smallest version
  that counts as done?
- **Unknowns.** Any value, path, format, or behavior the brief leaves implicit?
- **Collisions.** What existing code/data does this touch or risk breaking?
  (Verify by reading the code — don't guess.)
- **Failure modes.** What's the expensive-to-be-wrong part, and how do we know
  it's right?
- **Invariants.** Does this project have load-bearing constraints (seeded RNG,
  enforced palette, layering rules, pinned deps)? Check `corpus/CLAUDE.md` and
  the repo's conventions; confirm the brief respects them.

If the brief or codebase already answers a branch, resolve it yourself and say
so — don't ask the user what you can read. Stop grilling when no branch with a
material consequence is still open.

> If the richer standalone `grill-me` skill is available and the design is large
> or contentious, you may run that instead of this inline pass — but this inline
> grill is the default and keeps the skill self-contained.

### 3b — Plan

Write the implementation plan back to the user (and, if it changes the spec,
fold the resolved decisions into the brief file so it stays the source of
truth). Get an acknowledgement before building. Use EnterPlanMode/ExitPlanMode
if the harness supports it.

### 3c — Implement

Build per the plan. **If the brief decomposes into ≥3 independent chunks (several
mechanical), dispatch it via `plan-split-dispatch`** — it splits the work,
classifies each chunk hard/easy, and runs hard→opus / easy→sonnet as fresh
subagents with curated context (cheap tokens on cheap work, lean controller).
Pass the brief + the project's READ/SKIP/SKILLS rows from `corpus/routing.md`.
For a 1–2 chunk or single-indivisible brief, implement inline — the dispatch tax
isn't worth it.

Either way: honor the brief's "Files you OWN / must NOT touch". Verify against the
brief's **Acceptance** — run the project's typecheck/tests/build as applicable;
report results faithfully (failing tests get said so, with output).

---

## 4 — Complete a brief + log it + fold into the wiki

When the work is done and verified.

1. **Move the brief, keep its number:**

   ```bash
   git mv corpus/briefs/todo/<NN>-<slug>.md corpus/briefs/done/<NN>-<slug>.md \
     2>/dev/null || mv corpus/briefs/todo/<NN>-<slug>.md corpus/briefs/done/<NN>-<slug>.md
   ```

   A brief in `done/` is **immutable** — don't edit it later. Append a short
   outcome note at the bottom only at move time (what actually shipped vs. the
   spec, anything deferred). If later work *undoes* a done brief, move it to
   `superseded/` with a one-line top note explaining why — never rewrite history.
2. **Append a `log.md` entry** at the bottom (chronological, newest last):

   ```markdown
   ## [<YYYY-MM-DD>] done | Brief <NN> — <one-line what-shipped>

   <2–5 lines: what landed, key files/decisions, what was deferred, how it was
   verified. Link the brief and any wiki page. Absolute dates only.>
   ```

   Other entry kinds: `todo` (brief filed), `maintenance`, `incident`,
   `decision`, `ingest`, `lint`, `resume`.

   A **`resume`** entry is the checkpoint written when a long run is paused (e.g.
   the user hits a quota/usage limit and asks to stop for a fresh session). It
   captures enough for a **cold start next session**: what is done (with the
   contracts dependents need), what is in-flight or next, the branch + last
   commit, and any open decisions. `plan-split-dispatch` wave-mode writes one at a
   wave boundary; keep it at the bottom of `log.md` (or a dedicated
   `corpus/resume-<YYYY-MM-DD>.md` when the state is large) so the next session
   reads it first.
3. **Fold durable findings into `wiki/`** (this is the step that makes it a
   wiki, not a task tracker). If the work changed how the system behaves or
   revealed something reusable, update the affected synthesis page(s) —
   `status.md` always, plus the relevant entity/concept page, `decisions.md` if
   a choice was locked, `open-questions.md` if a question opened or closed. See
   §6 (Ingest). A finding that lives only in the brief or the log will be missed
   by the next reader; the wiki is where standing knowledge belongs.
4. **Update navigation** if a new wiki page was added: cross-link it from
   `index.md`.
5. Confirm: report the moved path, the log entry, and which wiki pages changed.
   Commit only if asked.

---

## 5 — Query the wiki (answer a question against the corpus)

When the user asks "what does the corpus/wiki say about X" / "how does Y work
here".

1. **Read `index.md` first**; triage on the `summary:` lines. Respect the
   **retrieval budget** — index plus at most 2–3 pages.
2. Drill into the **wiki pages**, not the codebase — unless the wiki points you
   at specific code, or you need to verify a claim (see §8).
3. **Structural questions are not wiki questions.** "Who calls X", "what breaks if
   I change X", "where does feature Y live" go to the code graph (§0b), and
   "did I get *every* usage" goes to `grep`. Check `routing.md` first.
4. If the answer is non-trivial **and reusable**, file it back as a new or
   updated wiki page rather than letting it disappear into chat. Then answer.
5. Honor the **source-of-truth ordering** (see Conventions) when pages disagree.

---

## 6 — Ingest a finding (new source / new knowledge)

When the user shares a result, a decision, an exploration outcome, or a brief
lands — anything that should become standing knowledge. Triggers: "ingest
this", "remember that we decided…", "fold this into the wiki", or naturally at
the end of §4.

1. If it's a spec, drop the raw artifact in `briefs/`. Otherwise summarize the
   finding inline.
2. **Update the affected wiki pages** — `status.md`, the relevant entity/concept
   page, `open-questions.md`. Edit freely; the wiki is the LLM's to curate.
3. If the concept is **named but has no page yet**, create one (one concept per
   file) and cross-link it from `index.md`.
4. **Append a `log.md` entry**: `## [<YYYY-MM-DD>] ingest | <short title>`.
5. Keep `decisions.md` for locked tech/design choices; don't relitigate a
   decision recorded there without flagging it explicitly.

---

## 7 — Lint the corpus (periodic health check)

When the user says "lint the corpus" / "is the wiki stale".

**Run `bash corpus/lint.sh` first** — it mechanically catches missing frontmatter,
broken relative links, oversized pages, and abandoned path roots. Fix those, then
sweep by hand for what a script can't see:

- **Contradictions** between pages (e.g. `decisions.md` vs `status.md`).
- **Stale claims** — verify by reading the actual code or running the relevant
  command before trusting (see §8). The nastiest kind is a page whose *top-ranked
  finding* was silently obsoleted by later work; the links still resolve, so only
  reading the code catches it.
- **Orphan pages** — no inbound link from `index.md` or another wiki page.
- **Named-but-pageless concepts** — mentioned repeatedly, no page of their own.
- **Drifted briefs** — a `done/` brief whose work has since been undone or
  replaced → move to `superseded/` with a one-line note.
- **Straddling pages** — two topics in one file → split, even under the line cap.
- **Duplicated catalogs** — a list `index.md` maintains that another page owns.

A large repo reorganization invalidates paths *en masse*; when the lint reports
many broken links, resolve them by basename against the real tree rather than
one at a time. Mark obsolete findings **obsolete** — don't delete the reasoning.

Report findings as a short list; fix the cheap ones inline, surface the rest for
the user to decide. Append a `## [<YYYY-MM-DD>] lint | …` entry to `log.md`
noting what was swept and changed.

---

## 8 — Verify before quoting the wiki

A wiki page that names a specific file, function, or commit may have **drifted**.
The wiki reflects what was true when written — it is not authoritative over the
code. Before acting on a wiki claim:

- Names a **path** → check it exists.
- Names a **function / flag** → grep for it.
- Names a **commit** → `git log --oneline | grep <hash>`.

If a claim is stale, fix the page (it's the LLM's to curate) and note it in
`log.md`. Never recommend an action based on an unverified wiki claim about
specific code.

---

## Conventions (load-bearing)

- **Numbers are stable.** Never renumber a brief when it moves between dirs.
- **Every wiki page carries `summary:` + `updated:` frontmatter**, and `index.md`
  is generated from it (`bash corpus/lint.sh --index`). The summary is the
  retrieval signal — write it for an agent deciding whether to open the page.
- **The retrieval budget is a rule, not advice.** `index.md` + at most 2–3 pages.
  Needing more means a page must split.
- **Standard markdown links, relative to the file's own location** — not Obsidian
  `[[wikilinks]]`. Repos render in VSCode/GitHub, where standard links are
  clickable. (Code refs from `wiki/` are `../../src/...`; from
  `briefs/<area>/<state>/` they're one level deeper.)
- **Absolute dates** (`2026-06-15`), never "yesterday".
- **One concept per file.** Split a page that grows past ~200 body lines or
  straddles two topics.
- **The corpus is the *why*; a code graph is the *what*.** Never answer a
  structural question from the wiki, and never write a code graph's output into
  the wiki as fact (§0b).
- **Source-of-truth ordering** when pages or beliefs disagree:
  1. The **actual code** wins over any wiki claim.
  2. A brief in **`done/`** wins over `wiki/` if the wiki hasn't caught up.
  3. **`decisions.md`** wins over `status.md` for tech choices not formally
     revisited.
  4. An **external spec** (e.g. an upstream README the project tracks) wins for
     design disagreements in its domain.
  Verify any path/function/commit a page names before acting on it — pages drift.
- **The LLM owns `wiki/`; briefs are immutable; index/log are navigation.**
  Don't edit a `done/` brief; don't let durable findings rot in chat.
- **One commit per meaningful corpus change** (when committing) so `log.md` and
  git history agree. Never commit without the user asking.
- **`TodoWrite` is for the in-session task list; `corpus/` is durable.** Don't
  conflate them. Likewise prefer the corpus over personal memory for
  project-specific, reusable knowledge.
