---
name: web-research
description: Produce a fact-checked research report on a topic by running web searches inline (token-efficient - no per-query search subagent), optionally using subagents for codebase exploration, and verifying key claims before writing. Ships two deliverables: a comprehensive Markdown report and a concise, dev-friendly HTML digest (results-first, graphs/tables/short paragraphs). Use when the user says "research X", "investigate X", "compare X vs Y", "write a research report", "what are the options for X", "deep dive on X", or wants a sourced, cited answer rather than an off-the-cuff one.
when_to_use: The user wants a sourced, multi-source, verified answer or report on a topic - a technology comparison, a landscape scan, a "what should we use for X" decision, or a deep dive. Runs web search inline in the main thread; spawns subagents only for codebase exploration (and gates any fan-out of more than 5). Not for a single-fact lookup you can answer in one search, and not a substitute for the project's own docs.
---

# Web Research - inline searches, verified claims, two deliverables

Produce a research report that is **sourced, fact-checked, and cheap to run**.
The design principle throughout is **token efficiency**: search inline, fetch
selectively, and spend subagents only where isolation earns its cost.

## Table of contents

- [Operating rules](#operating-rules)
- [Model routing (subagents)](#model-routing)
- [The fan-out gate (> 5 subagents)](#fan-out-gate)
- [Workflow](#workflow)
- [Deliverable 1 - Markdown report (comprehensive)](#md-report)
- [Deliverable 2 - HTML digest (concise, dev-friendly)](#html-digest)
- [Verification bar](#verification)

## Operating rules {#operating-rules}

1. **Search inline, in the main thread.** Run `WebSearch` / `WebFetch` yourself -
   do **not** spawn a subagent per query. A search subagent round-trips the full
   result set through another context and burns tokens for no isolation benefit.
   The main thread already holds the question; keep the searches there.
2. **Fetch selectively.** Search returns snippets; only `WebFetch` a page when a
   snippet is load-bearing for a claim you will cite. Reading ten full pages to
   write three sentences is the anti-pattern.
3. **Subagents are for codebase exploration only** - "how does *this repo* do X",
   "find every place we call Y" - where a fresh, isolated context reading many
   files should not pollute the research thread. Their **conclusion** returns to
   you, not the file dumps.
4. **Cite as you go.** Every non-obvious claim gets a source URL captured the
   moment you read it; do not reconstruct citations at write-time.
5. **Be honest about uncertainty.** Mark contested or thin-sourced claims; a
   single blog post is not consensus.

## Model routing (subagents) {#model-routing}

Declare the model on each `Agent` call. Research reasoning is Opus's strength, so
**lean Opus** - only clearly mechanical slices go to Sonnet.

| Subagent task | Model |
| --- | --- |
| Synthesis, comparison, judgment, resolving contradictory sources | **Opus** |
| Adversarial claim verification / refutation | **Opus** |
| Exploring an unfamiliar codebase feature and explaining it | **Opus** |
| Locating files / enumerating call sites / mechanical grep sweep | **Sonnet** |
| Extracting a known field from a known file | **Sonnet** |

Rule of thumb: if being wrong is expensive or the task needs synthesis, **Opus**;
if it is a lookup with an obvious right answer, **Sonnet**. When unsure for a
research subtask, prefer **Opus**.

## The fan-out gate (> 5 subagents) {#fan-out-gate}

Spawning subagents is fine up to **5**. If your plan needs **more than 5**, STOP
and ask the user first (`AskUserQuestion`): state how many, what each does, and
the rough cost, and let them approve, trim, or run it inline. Never silently fan
out a large fleet - the user opted into research, not into an unbounded agent
swarm. (Inline web searches do not count toward this cap; only subagents do.)

## Workflow {#workflow}

1. **Scope the question.** If it is underspecified (e.g. "what should we use for
   caching" with no constraints), ask 1–3 sharp clarifying questions, then weave
   the answers into the search plan. Do not research the wrong question.
2. **Plan the angles.** List the 4–8 sub-questions that together answer the
   topic. This is the report's skeleton.
3. **Search inline, angle by angle.** For each: a couple of targeted `WebSearch`
   queries, then `WebFetch` only the sources that carry a claim. Capture
   `{claim, source URL, confidence}` as you go.
4. **Explore the codebase if the topic touches this repo** - via subagents
   (models per the table; mind the fan-out gate). Fold their conclusions in.
5. **Verify key claims** before writing (see the bar below).
6. **Write both deliverables** - the Markdown report and the HTML digest - from
   the same verified claim set.
7. **Ask where to save.** Default to a sensible path (a `research/` dir or the
   project's corpus if one exists); confirm if ambiguous.

## Deliverable 1 - Markdown report (comprehensive) {#md-report}

The thorough artifact - the place for full reasoning and every source.

- **Title + one-paragraph executive summary** (the answer, up front).
- **Context / question** and the constraints that scoped it.
- **Findings**, one section per angle: the evidence, the trade-offs, the
  disagreements between sources - full prose, not just bullets.
- **Recommendation** with the reasoning and the conditions under which it flips.
- **Risks / open questions / what would change the answer.**
- **Sources**: numbered, every URL, each with a one-line note on what it
  supported and how much to trust it.
- Inline citation markers (`[1]`, `[2]`) tying claims to that list.

This is the long-form record. Comprehensiveness beats brevity here.

## Deliverable 2 - HTML digest (concise, dev-friendly) {#html-digest}

A **skim-in-two-minutes** companion for a developer, **not** a re-render of the
Markdown. Distill, don't duplicate.

- **Results-first**: lead with the answer/recommendation and a verdict line.
- **Favor structure over prose**: comparison **tables**, simple **charts**, and
  **short paragraphs** (2–4 sentences max). If a paragraph runs long, it belongs
  in the Markdown, not here.
- **Charts from data, inline and dependency-free**: render bars/scores as inline
  CSS or hand-written SVG (a `<div>` with a `width:%`, or a small `<svg>`). **No
  external scripts, fonts, or CDN** - the file must open standalone offline.
- **Self-contained**: all CSS inline in a `<style>` block; embed any image as a
  `data:` URI. Responsive (relative units, `max-width:100%`); wide tables/charts
  scroll inside their own `overflow-x:auto` container so the page never scrolls
  horizontally.
- **Theme-aware**: style light and dark via `@media (prefers-color-scheme: dark)`.
- **Scannable hierarchy**: a verdict banner, a key-numbers row (stat tiles), a
  comparison table, one or two charts for the headline metrics, and a short
  "why / caveats" note. Link out to the Markdown for depth.

Keep the HTML lean: if a reader needs more than the digest, they open the
Markdown. The HTML earns its place by being *faster to read*, not by being
complete.

> Building a chart, stat tile, or dashboard-style layout? Read the `dataviz`
> skill first for palette/mark/legend conventions so the digest reads as one
> system.

## Verification bar {#verification}

Before a claim lands in either deliverable:

- **Two independent sources** for anything load-bearing, or it is flagged as
  single-sourced.
- **Primary over secondary** - official docs / the repo itself / a spec beat a
  summary blog.
- **For contested or high-stakes claims, verify adversarially**: spawn an Opus
  subagent (or reason explicitly) tasked to *refute* the claim; keep it only if
  refutation fails. Report what survived and what did not.
- **Date-check** - flag anything where staleness would change the answer
  (versions, pricing, "current best practice").
