# Brief 58 — System Monitor: confirm the kill, and show more than one instant

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
MEDIUM · add-on `apps/add-ons/system-monitor` + backend `system` module.
Standalone. Builds on the 2026-07-31 fix that replaced the broken `ps`
shell-out with a `/proc` walk — the process table now actually has data in a
shipped image, which makes the gaps below worth closing.

## Problem

**1. Kill has no confirmation.** `handleKill` (`ProcessTable.tsx:53-55`) fires
the mutation straight from the row's ⊗ button. The kill is uid-scoped
(`system.service.ts` refuses a different uid), but the backend itself runs as
that same user — so a single misclick on the wrong row can terminate the
process serving the desktop and take the OS down with it. The house rule is
explicit: a destructive action is `variant="destructive"` **and** gated by
`confirm({ destructive: true })` (`wiki/ui-conventions.md` §24). This is the
clearest violation of it in the repo. Failure feedback is also inline-only
(`setFailedPid`) rather than a `notify()`.

**2. Everything is a single instant.** `Gauge` renders one clamped percentage
(`Gauge.tsx:9-10`) and nothing keeps history, so the Overview cannot answer the
only question anyone opens a system monitor to ask: *is this getting worse?* A
spike between two 1.5s polls is invisible.

**3. The reported system is thinner than the real one.** `getStats` returns
aggregate CPU percent + core count, memory, and disk (`system.service.ts:90-97`).
Not reported, though all are cheap and already local:
- **load average** — `os.loadavg()`, one line;
- **per-core CPU** — `sampleCpus()` already computes per-core samples
  (`system.service.ts:170-175`) and then throws the detail away by summing;
- **swap** — `/proc/meminfo` is already parsed for MemTotal/MemAvailable
  (`:179-188`); SwapTotal/SwapFree are in the same file;
- **network I/O** — `/proc/net/dev`;
- **uptime** — already in `/api/system/about`, absent from Overview.

**4. No filter on the process list.** Sorting exists and works
(`ProcessTable.tsx:21-44`), but with ~111 rows on a modest host there is no way
to find a process by name.

**5. First poll reads 0.0%.** A consequence of the new delta-based CPU: the
first sample has no baseline. It self-corrects 1.5s later, but showing a
confident `0.0` is worse than showing `—`.

## Proposed decisions (ungrilled)

- **Confirm before killing**, via `useConfirm` with `destructive: true`, naming
  the process and pid. Additionally **warn explicitly** when the target is the
  backend's own pid (`process.pid`, exposed via `/api/system/about`) — do not
  forbid it (a real OS lets you shoot your own foot), but do not let it happen
  by accident either.
- **Keep history client-side, in a ring buffer.** 120 samples at 1.5s ≈ 3
  minutes, held in the app while the window is open. No backend storage, no new
  dependency, and it disappears with the window — honest, since nothing is
  recording when the app is closed.
- **Sparklines, not a charting library.** A small inline SVG polyline under each
  gauge. Adding a chart dependency for three sparklines fails the lightweight
  test.
- **Add loadavg, swap, per-core and uptime to `/api/system/stats`**; add network
  I/O as counters plus a computed per-second rate. All from `/proc` and `os`,
  no new dependency, consistent with the `/proc` direction already taken.
- **Per-core as a compact bar strip**, not 16 gauges.
- **Deferred — SSE/WebSocket streaming instead of 1.5s polling.** The poll is
  cheap and the code is simple; streaming is a real change to the transport for
  no user-visible gain today. Revisit if the poll ever shows up in a profile.
- **Rejected — disk I/O per process.** `/proc/<pid>/io` is unreadable for other
  uids and the numbers would be misleading. Whole-device stats only.
- **Rejected — a "kill hung desktop app" view.** Windows are not processes;
  brief 47's error boundaries are the honest version of that.

## Fix

1. `ProcessTable.tsx`: `useConfirm` before `killMutation.mutate`; make the row
   action a `destructive` variant with an `aria-label`; route success and
   failure through `notify({ appId: 'system-monitor' })`.
2. Filter input in the Processes toolbar, matching on name and pid, applied
   before the existing sort so virtualization is unaffected.
3. Backend `system.service.ts`: extend `SystemStats` with `loadAvg`,
   `perCore: number[]`, `swap`, `uptimeSeconds`, and `net: { rxBytes, txBytes,
   rxPerSec, txPerSec }` — the per-second figures computed from a stored
   previous sample, using the same "only advance the baseline once it is old
   enough" guard the process CPU delta already uses.
4. Overview: a `useRef` ring buffer fed by the existing query, an inline
   `Sparkline` component, plus rows for load average, swap, uptime and network
   rate.
5. Render `—` instead of `0.0` for a process whose CPU has no baseline yet
   (add a nullable `cpuPercent` or a first-sample flag).

## Must preserve (regression surface)

- uid-scoped kill still refuses a process owned by another user (403), and
  still 404s a dead pid.
- The virtualized list (brief 31) still recycles rows and stays scroll-stable
  across the 1.5s refetch; the filter must not break `useVirtualList` sizing.
- Existing sort behaviour and the `MAX_PROCESSES` cap are unchanged.
- `/api/system/stats` stays backward-compatible — add fields, do not rename.
- No external binary is reintroduced: everything comes from `/proc` and `os`.

## Verify bar

`turbo typecheck`, lint + format green, `turbo build` ok. Backend tests for the
new fields, including a `/proc/net/dev` parse and a swap-absent host (a
container with no swap must report 0, not crash).

**Verified in a browser**: kill a harmless process — a confirm appears naming
it, and cancelling does nothing; attempt to kill the backend's own pid and get
the explicit warning. Run a CPU burner and watch the sparkline rise and fall.
Filter the list by name. Confirm the first render shows `—`, not `0.0`.

## Out of scope

Streaming transport, per-process disk I/O, historical persistence across
window closes, alerting/thresholds, and the Storage-breakdown Settings section
(its own parity brief).
