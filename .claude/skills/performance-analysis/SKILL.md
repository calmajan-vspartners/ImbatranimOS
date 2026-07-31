---
name: performance-analysis
description: Measure real web-app performance locally with Chrome DevTools MCP - Core Web Vitals (LCP/CLS/INP), performance traces, Lighthouse scores, and network/console waterfalls - then turn the trace into ranked, actionable fixes. Use when the user says "why is this slow", "measure performance", "run Lighthouse", "check Core Web Vitals", "profile this page", "find the slow request", "performance audit", or wants numbers instead of guesses about a live page. Chrome-only, runs offline against the locally-running app.
when_to_use: The user wants to measure (not guess at) the performance of a running web page - load speed, runtime jank, oversized assets, layout shift, slow requests - and get concrete fixes. Requires a page reachable in a local Chrome (a dev server or a deployed URL) and the Chrome DevTools MCP server registered. Not for backend/CLI profiling and not a substitute for a committed perf-regression suite.
---

# Performance Analysis - measure a live page, don't guess

The rule this skill exists to enforce: **for performance, measure the running
page.** Reading source and reasoning about it finds *candidate* problems; only a
trace tells you which ones actually cost the user time. Guessing at perf wastes
effort on fast paths and misses the real regression.

The driver is [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp)
(Google). It runs a local, isolated Chrome (fresh profile per run, nothing
persists), and Claude reads the trace. Nothing leaves the machine. It is the
right tool whenever the question is *behavioral or timing* rather than *does the
DOM look right* - for the latter, or for a visual/interaction audit, use
`agent-browser` via the `ui-test-plans` / `ui-ux-pro-max` skills instead.

## Table of contents

- [Setup](#setup)
- [The loop](#the-loop)
- [What each tool answers](#what-each-tool-answers)
- [Reading a trace: where time actually goes](#reading-a-trace)
- [Throttling: measure the slow case, not your machine](#throttling)
- [Turning findings into fixes](#turning-findings-into-fixes)
- [Pitfalls](#pitfalls)

## Setup

Register the MCP server once (pin the version - it is a supply-chain surface even
run locally):

```bash
claude mcp add chrome-devtools -- npx chrome-devtools-mcp@<pin> --isolated
# or per-project via .mcp.json:
#   {"mcpServers":{"chrome-devtools":{"command":"npx","args":["chrome-devtools-mcp@<pin>","--isolated"]}}}
```

`--isolated` gives a throwaway profile each run - repeatable, and no stray auth
or cache from a previous run skewing the numbers. It launches headed by default;
pass `--headless` for an unattended run.

**Bring the app up first** and confirm it is healthy before profiling. Profile a
production-like build where you can (`vite build && vite preview`, not the dev
server) - dev servers ship unminified code, source maps, and HMR, so their
numbers are not the ones users see. Say which build you measured in the report.

## The loop

1. **Navigate** to the target page (`navigate_page`, or `new_page` for a clean
   tab).
2. **Baseline with Lighthouse** (`lighthouse_audit`) for a scored snapshot:
   Performance, plus Accessibility/Best-Practices/SEO if useful. This gives
   Core Web Vitals (LCP, CLS, INP/TBT) and a prioritized opportunity list in one
   call - start here.
3. **Trace the interaction that matters** (`performance_start_trace` →
   perform the load or interaction → `performance_stop_trace`). Lighthouse
   scores a cold load; a trace captures *any* flow (a click that janks, a route
   change, a slow filter).
4. **Drill into the biggest insight** (`performance_analyze_insight`) for the top
   1–3 items - LCP breakdown, long main-thread tasks, layout-shift culprits,
   render-blocking resources.
5. **Check the network waterfall** (`list_network_requests`, then
   `get_network_request` on suspects) for oversized/uncompressed/blocking/
   duplicate/waterfalled requests.
6. **Check the console** (`list_console_messages`) for errors, forced-reflow
   warnings, and deprecations that correlate with the slow path.
7. **Correlate to source and rank.** Map each measured cost to the code that
   causes it (Grep/Read), then report fixes ordered by *measured* impact.

Re-measure after a fix to confirm the number moved - a perf "fix" that does not
move the trace is not a fix.

## What each tool answers

| Question | Tool |
| --- | --- |
| Overall score + prioritized opportunities on a cold load | `lighthouse_audit` |
| Where did wall-clock time go in *this* load/interaction | `performance_start_trace` → `performance_stop_trace` |
| Deep breakdown of one insight (LCP, long task, CLS source) | `performance_analyze_insight` |
| Which requests are slow / large / blocking / duplicated | `list_network_requests` → `get_network_request` |
| Runtime errors, forced-reflow / deprecation warnings | `list_console_messages` |
| Simulate a slow phone / slow network | `emulate` (CPU + network throttle) |
| DOM state at a moment (for correlating a shift/repaint) | `take_snapshot` / `take_screenshot` |

## Reading a trace {#reading-a-trace}

The metrics that map to user pain, and their usual causes:

- **LCP (Largest Contentful Paint)** - time to the main content. Usual culprits:
  render-blocking CSS/JS, a slow server response (TTFB), an un-preloaded hero
  image, or a font swap. `performance_analyze_insight` on LCP gives the phase
  breakdown (TTFB → load delay → load time → render delay); fix the dominant
  phase.
- **CLS (Cumulative Layout Shift)** - content jumping. Usual culprits: images/
  ads/embeds without reserved dimensions, injected banners, late web fonts. The
  insight names the shifting elements.
- **INP / TBT (interaction latency / main-thread blocking)** - jank on click/
  type. Usual culprits: long JS tasks, heavy re-renders, synchronous layout
  thrash. Look for long tasks (>50ms) on the main thread and the function that
  owns them.
- **Network waterfall shape** - a staircase (request N waits on N-1) means a
  dependency chain to parallelize or preload; a few fat bars mean assets to
  split/compress; a wall of tiny requests means bundling/HTTP-2 push territory.

Common wins, in rough order of frequency: uncompressed responses (no gzip/br),
oversized/unoptimized images, a single giant JS chunk (no code-splitting),
render-blocking resources, main-thread work that belongs in a worker,
request waterfalls that should be parallel, and missing cache headers.

## Throttling {#throttling}

Your dev machine is faster than your users' phones. Before trusting a number,
`emulate` a realistic profile - mid-tier mobile CPU throttle (4–6×) and a
"Slow 4G"-class network - and re-measure. A page that is smooth unthrottled and
janks at 4× CPU has a main-thread problem you would otherwise ship. State the
throttle profile in the report; an unthrottled number is only meaningful for a
desktop-only app.

## Turning findings into fixes

Report **ranked by measured impact, with the number attached** - never "this
could be slow." Each finding: the metric it moves, the measured cost, the root
cause in code (`file:line`), the fix, and the expected delta. Example shape:

> **LCP 4.1s → hero image is the LCP element, 2.3s of it is load delay.**
> `src/pages/Home.tsx:44` renders `<img>` with no `fetchpriority`/preload and
> serves a 1.8MB PNG. Fix: preload + `fetchpriority="high"`, convert to WebP/AVIF,
> size to the layout box. Expected LCP ≈ 1.8s.

Then **re-measure** to confirm.

## Pitfalls

- **Dev-server numbers lie.** Unminified + source maps + HMR. Measure a
  preview/production build; label which.
- **One run is noisy.** Take 2–3 traces and use the median for anything you
  report as a delta; cold vs. warm cache differ a lot.
- **Lighthouse ≠ field data.** It is a lab load on one machine. Useful for
  opportunities, not a promise about real users; throttle to close the gap.
- **`--isolated` starts cold every run** - no cache, no auth. That is the point
  for repeatability, but it means every run is a cold-cache load unless you warm
  it first, and an authenticated page needs re-login each run (Chrome DevTools
  MCP does not persist state by design - for stateful flows drive with
  agent-browser instead, per `ui-test-plans`).
- **Don't confuse this with the committed suite.** This is exploratory local
  measurement. Perf regressions that must not come back belong in a CI
  perf/Lighthouse budget, not in a one-off trace.
