---
name: codegraph
description: Understand and safely change unfamiliar code using a code knowledge graph as a fast navigation layer, verified by grep+read where correctness matters. The graph scopes cheaply (impact/blast radius, who-calls, first map of a feature); grep+read confirms and is exhaustive (renames, duplicate names, correctness invariants). Use when the user says "impact of X", "what calls X", "who uses X", "blast radius", "explore <feature>", "is it safe to rename X", "find all usages", "where is X used", or "what breaks if I change X". Repo-agnostic methodology - bootstraps a pinned code-graph tool if none is present.
when_to_use: Understanding or planning a change to existing code in a non-trivial codebase - impact/blast radius of a symbol, callers/callees, orienting in an unfamiliar feature, or judging rename safety across a monorepo. Combines a code graph (fast, approximate) with grep+read (exact) instead of choosing one. Not needed for a one-file change you already understand, or for exact string/config lookups (that is plain grep).
---

# Codegraph - navigate with the graph, verify with grep

One rule governs everything below: **lead with the graph to *locate* and *scope*;
verify with `grep`/read before *acting* on completeness.** The graph is a
generated, heuristic, disposable planning aid - cheap and approximate. grep+read
is exact. Using either alone is the mistake: the graph misses aliased imports and
undercounts callers; grep over-matches comments/strings and misses the cross-
package barrel edges the graph resolves. A cheap wrong answer is worse than none,
so on anything correctness-critical the graph proposes and grep disposes.

## Table of contents

- [What the graph is (and is not)](#what-the-graph-is)
- [Lead with the graph for](#lead-with-the-graph)
- [Verify / complete with grep+read for](#verify-with-grep)
- [Bootstrapping a code graph in a new repo](#bootstrap)
- [Benchmark the accuracy envelope - do not skip](#benchmark)
- [The per-repo project skill vs. this one](#project-vs-personal)
- [Index & storage strategy](#index-strategy)

## What the graph is (and is not) {#what-the-graph-is}

A code graph is `tree-sitter + a heuristic resolver`, **not a compiler**: it does
not type-check and does not do real module resolution. That means:

- Its token savings are real for the structural queries it is good at (benchmarked
  20–180× less context than grep+read on impact/callers/explore on a real
  monorepo) - and irrelevant where it is silently wrong.
- It resolves some cross-package re-export (barrel) edges that pure tree-sitter
  tools return **0** results for - but heuristically, so confirm.
- It **conflates same-named symbols** across parallel packages, **undercounts
  callers**, and **misses aliased imports** (`import { Foo as Bar }`).
- It is generated, gitignored, and disposable - **never a source of truth, never
  a runtime dependency.** The graph reflects the indexed commit, not your
  uncommitted edits.

## Lead with the graph for {#lead-with-the-graph}

- **Impact / blast radius** - "what breaks if I change this symbol?" Resolves
  cross-package barrel + framework DI edges plain grep misses.
- **Who calls / is called by** a function or method (callers / callees).
- **Orienting in an unfamiliar feature** before a change - a quick symbol map,
  not a file dump.

## Verify / complete with grep+read for {#verify-with-grep}

- **Exhaustive rename / "every usage must change"** - the resolver finds only a
  subset. `grep -rnw <symbol>` enumerates candidate sites; then confirm each hit
  is a real reference (grep over-matches comments/strings/same-named symbols and
  misses aliased imports). **This is the one place the graph is unsafe alone.**
- **Exact string / config / literal / non-symbol** search, or reading one known
  file.
- **Verifying a graph edge on a correctness-critical change** (auth, payments,
  migrations, cross-service contracts). If an edge looks wrong or a result is
  empty where you expect hits, confirm with grep before relying on it.

Rule of thumb: **graph to navigate and scope (cheap, approximate); grep+read to
confirm and to be exhaustive (exact).**

## Bootstrapping a code graph in a new repo {#bootstrap}

If the repo has no code graph and the work would benefit (repeated structural
questions over an unfamiliar or large codebase), stand one up. Reference tool:
[`codegraph`](https://github.com/colbymchenry/codegraph) - turnkey, node-native,
ships an MCP server.

```bash
npm i -g @colbymchenry/codegraph@<pin>   # pin the version: MIT but effectively
                                         # single-maintainer - a supply-chain
                                         # surface even run locally
codegraph init
codegraph telemetry off                  # defaults ON
codegraph status                         # MUST say native backend;
                                         # WASM fallback is 5–10× slower
```

Gitignore the index dir (`.codegraph/`). Register the MCP server in `.mcp.json`:
`{"mcpServers":{"codegraph":{"command":"codegraph","args":["serve"]}}}`. The MCP
registers `codegraph_explore` by default; further tools may be gated behind an
env var. If the MCP is not installed, run the CLI subcommands directly
(`impact`, `callers`, `callees`, `explore`, `node`).

## Benchmark the accuracy envelope - do not skip {#benchmark}

Vendor claims are real for the good queries and useless where the tool is wrong.
Establish the envelope on *this* repo before trusting it. Pick oracles and
compare the graph to grep:

- **A cross-package barrel symbol** (defined in package A, re-exported via its
  `index.ts`, consumed in package B). Pure tree-sitter tools return 0 here; the
  resolver usually gets it. Confirm.
- **A widely-called function** - count files with a real call site
  (`grep -rl "name("`) vs the graph's caller count. Expect **substantial
  undercount**; measure it.
- **Duplicate exported names** across parallel packages - the graph conflates
  them and returns callers of only one:

  ```bash
  grep -rhoE "^export (function|class|const|interface|type) [A-Za-z0-9_]+" <pkgA> --include=*.ts | awk '{print $3}' | sort -u > /tmp/a
  grep -rhoE "^export (function|class|const|interface|type) [A-Za-z0-9_]+" <pkgB> --include=*.ts | awk '{print $3}' | sort -u > /tmp/b
  comm -12 /tmp/a /tmp/b
  ```

  Those names are **unsafe to query bare** - record them.

## The per-repo project skill vs. this one {#project-vs-personal}

This personal skill is the **reusable methodology** - the graph-first/grep-verify
loop, the bootstrap recipe, the benchmark procedure, the when-to-trust-vs-verify
triggers. It is repo-agnostic.

The **measured accuracy envelope is per-repo and cannot be written once**: the
duplicate-name list, the actual caller-undercount ratio, and the *use it for* /
*do NOT use it for* table for a specific codebase belong in a **project** skill
at `.claude/skills/codegraph/SKILL.md` in that repo (and, if the project runs a
corpus, the numbers get filed as a `wiki/code-graph.md` page and the routing
table in `corpus/routing.md`). When bootstrapping under `corpus-flow`, that
skill's §0b drives the write-up; this skill supplies the method it follows.

## Index & storage strategy {#index-strategy}

- Index the canonical codebase **once, pinned to the main branch, shared
  read-only** across worktrees where the tooling allows; refresh with a sync
  after pulling. Don't `init` throwaway worktrees.
- The index reflects the indexed commit, **not** your branch's uncommitted edits
  - so always complete the branch delta with grep+read.
- Never commit the index dir; it is auto-gitignored and disposable.
