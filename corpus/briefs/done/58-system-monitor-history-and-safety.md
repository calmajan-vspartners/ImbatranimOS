
---

## Outcome — 2026-08-04

Done. All five problems closed, plus one piece of missing test infrastructure that
the work itself exposed.

### The kill now asks, and knows when you are aiming at the OS

`useConfirm({ destructive: true })` naming the process and pid, and the outcome —
success or failure — goes through `notify()` rather than an inline "not permitted"
that sat inside a virtualized row that scrolls away, in a window the user may not be
looking at.

The specific case worth building: **`/api/system/about` now reports `serverPid`**, so
the backend's own row is marked `(this OS)` and killing it gets a different dialog —
*"Process N is the ImbatranimOS backend — the process serving this desktop. Ending it
will disconnect every app and terminate your session."* Warned, **not forbidden**: a
real OS lets you shoot your own foot, it just should not happen by accident. The kill
is uid-scoped, but the backend runs as that same uid, so "you are allowed to" and
"you meant to" are different questions and only the client can ask the second.

### `/proc` details that were already being measured and thrown away

- **Per-core CPU** cost nothing to add: `sampleCpus()` already computed per-core
  samples and then summed them, discarding the detail. Rendered as a compact bar
  strip — sixteen gauges is not information, it is a wall.
- **Swap** comes out of the same `/proc/meminfo` read as memory. Reading it twice
  would be two syscalls and two chances for the halves to disagree about one instant.
- **Load average** and **uptime** are one call each.
- **Network** is a new `/proc/net/dev` parse, in `proc-net.ts` with 16 tests.

`SystemStats` gained fields and renamed none — the tray polls the same endpoint and a
rename would have broken it silently.

### Two `/proc/net/dev` traps, both tested

1. **Loopback must be excluded**, and this is the load-bearing one. In this OS the
   desktop talks to its own backend over `lo` — every file read, every stats poll,
   the whole PTY stream. Counting it would report the machine's internal chatter as
   network traffic, so a box with no network at all would show megabytes. Bridges,
   veth pairs and `ifb` are excluded too because they double-count real traffic.
2. **There may be no space after the colon.** Once a counter outgrows its column the
   kernel prints `eth0:123456789012` flush against it, so tokenising the whole line
   on whitespace reads the byte count as the interface name — and it only happens on
   the busy machines whose numbers you actually care about. Splitting on the first
   colon avoids it.

Plus: a counter that went backwards (interface reset, or a 32-bit wrap) reports 0 for
one tick rather than a huge spike or a negative rate, and the rate reuses the CPU
delta's baseline-age guard so a second poll milliseconds after the first cannot divide
a tiny byte delta by a near-zero window.

### `0.0` became `null`

`ProcessInfo.cpuPercent` is now `number | null`, and the table renders `—`. On the
first poll there is no baseline, so nothing is known about any process's CPU use, and
a confident `0.0` for a busy process is a lie that persists for 1.5s — long enough to
read. The sort uses `?? -1` so a null never reaches the subtraction; `NaN` there would
make the order depend on the input order *and* on the engine's sort implementation.

An existing test asserted `cpuPercent === 0` on the first poll. That assertion encoded
the behaviour being fixed, so it was **changed deliberately**, with the reason written
into it.

### History without a charting dependency

A 120-sample ring buffer (≈3 minutes at the existing 1.5s poll), held in the window
and gone when it closes — honest, since nothing records while the app is shut. Drawn
as an inline SVG `polyline`; a chart library for two sparklines fails the lightweight
test.

The scale is **fixed at 0–100, not auto-fitted**, and that is the decision the tests
pin. Auto-fitting is tempting and wrong: a series wobbling between 0.1% and 0.4%
would fill the whole box and make idle noise look like a crisis.

### Found while working: the backend was never type-checked

`nest build` rejected a change that `turbo run typecheck` had just passed, because
**the backend had no `typecheck` script at all** — only `build` ever type-checked it,
and `src/` errors could only surface at build time. It also carried two long-standing
supertest typing errors in `test/`, which is why nobody had added one.

Both fixed: `binaryParser` now takes `unknown` and narrows (superagent declares its
parser's first parameter as its own `Response` type, so a `ReadableStream` parameter
was never assignable — even though the object handed over at runtime *is* a readable
stream, which is why it worked), and the backend has a `typecheck` script. `turbo run
typecheck` went from 25 tasks to 26.

I also caught myself filtering away the error I was looking for: `tsc | grep "^src/"`
matches nothing when tsc emits colour, because the line starts with an ANSI escape.

### Verified

**Backend 208 unit + 46 e2e; frontend vitese 353.** 16 new `proc-net` tests, 17 new
history/filter tests.

**In the shipped bundle** (`uitest/sys58.mjs`), spawning a **real** `sleep 600` in the
container and driving the UI:

- The confirm names it — *"Send SIGTERM to sleep (pid 14512)?"* — **Cancel leaves it
  alive** (checked with `kill -0` from outside the browser), and confirming really
  ends it.
- The backend's own row shows `(this OS)` and produces the backend-specific warning
  instead of the generic one; cancelling leaves the OS running.
- `loadAvg {one:0.34, five:0.62, fifteen:0.3}`, 4 per-core cells for 4 cores, real
  network rates, and this swapless host reports zeros → "none configured" rather than
  an empty bar.
- The first process poll renders `—`; the filter narrows 200+ rows to one by name and
  by pid.
- Sparklines grow from 3 to 8 points over 8 seconds.
- The original `cpu`/`memory`/`disk` fields are all still present.
- No page errors.

### Unchanged from the brief

Streaming transport, per-process disk I/O, persistence across window closes and
alerting all stay out.
