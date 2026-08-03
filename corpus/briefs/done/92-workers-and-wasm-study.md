# Brief 92 — Where workers and WebAssembly belong in this OS

Status: **done 2026-08-03** (study, no code) · Asked for directly: "can we use
wasm for some parts of it… make a study where we should use workers or wasm."
Measured against the **shipped production build served by the real backend with
the real CSP**, not from documentation.

## The short answer

**WebAssembly cannot run in this OS today. Not one byte.** The shipped CSP
refuses it on every path. Workers, by contrast, already carry the three heaviest
workloads and are the right tool for the two that remain — but only same-origin
module workers, because `blob:` workers are refused by the same CSP.

Neither of those is a guess. Both were measured, and both had already caused a
production bug before anyone looked (briefs 62 and 91).

## Finding 1 — the CSP refuses WebAssembly outright

The shipped header is:

```
default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none';
form-action 'self'; img-src 'self' data: blob:;
font-src 'self' https://fonts.gstatic.com data:;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
script-src 'self'; connect-src 'self'
```

Every WebAssembly entry point fails against it:

| Call | Result |
|---|---|
| `new WebAssembly.Module(bytes)` | `CompileError: Refused to compile or instantiate WebAssembly module because 'unsafe-eval' is not an allowed source of script` |
| `WebAssembly.compile(bytes)` | same |
| `WebAssembly.instantiate(bytes)` | same |
| `WebAssembly.instantiateStreaming(res)` | same |

Not a subset, not a workaround — `wasm-unsafe-eval` is simply absent, and
`script-src 'self'` does not imply it. **Any wasm dependency added today would
fail exactly the way fflate's blob worker failed in brief 62**: at runtime, in
the image, in a code path nobody tested, and quite possibly without an error the
user can see.

### What it would take

Adding **`'wasm-unsafe-eval'`** to `script-src` in
`apps/backend/src/security-headers.ts`. That token is the narrow one: it permits
wasm compilation and **not** JavaScript `eval`, so it is a far smaller concession
than `'unsafe-eval'`. Supported by Chrome/Edge 97+, Firefox 102+, Safari 16.4+.

**This is a human-gated change.** The CSP is a security decision in the same file
and the same class as SEC-9, and the project's rule is that those are not made
autonomously. Recorded here as a prerequisite, not done.

### There is already a wasm dependency, and it is silently unreachable

`pdfjs-dist` ships four modules: `openjpeg.wasm` (JPEG2000 images),
`jbig2.wasm` (JBIG2 — the codec most scanned documents use), `qcms_bg.wasm`
(colour management) and `quickjs-eval.wasm` (PDF JavaScript actions). pdf.js
resolves them from a relative `wasmUrl` defaulting to `"wasm"`.

None of them, and none of the `*_nowasm_fallback.js` files beside them, are
copied into the desktop build output — so the fetch would 404 even before the CSP
refused the compile. A plain PDF never asks for them, which is why nothing has
broken visibly; a scanned PDF with a JBIG2 image would render that image as
nothing.

`pdfcore-engine`'s own comment already says pdf.js needs no wasm "for the core
render/text/outline paths we ship in v1", and that is accurate. The gap is
narrower than it first looks, but it is real and it is undocumented outside that
one comment.

## Finding 2 — `blob:` workers are refused too, and that already cost us

Same CSP, same reason:

```
Refused to create a worker from 'blob:…' because it violates the following
Content Security Policy directive: "script-src 'self'".
Note that 'worker-src' was not explicitly set…
```

fflate's async API spawns exactly such a worker. Brief 62 found the consequence:
fflate 0.4.8 throws inside its own error handler rather than calling back, the
promise never settled, and **Docs could not open a single `.docx` in any shipped
image** — no error, no timeout, a spinner forever.

The rule that follows is short enough to remember: **our own module workers
(`new Worker(new URL('./x.ts', import.meta.url), { type: 'module' })`) are fine;
any library that builds its own worker from a blob URL is not.** Vite emits those
as same-origin chunks, which `'self'` covers. A library's blob worker is
unfixable from our side except by not using that code path.

## What is already off the main thread

| Workload | Where | Verified |
|---|---|---|
| xlsx parse + serialize (ExcelJS) | our module worker | brief 32; still correct — see the numbers below |
| TypeScript/JSON/CSS language services | Monaco's own workers | brief 88, live: `editor.worker.js` + `ts.worker.js` spawn, and the TS worker returns a real type error |
| PDF parse + render | pdf.js's own worker | vendored URL, same-origin |
| zip/tar extract + create | **the backend**, in Node | never in the browser |
| Argon2 password hashing, SQLite | **the backend** | never in the browser |

Two of those matter for the wasm question: the archive and crypto workloads —
the classic wasm candidates — are already on the server side of the syscall
bridge, where they run as native Node code. There is nothing to move.

## Measured cost of what is still on the main thread

Median of repeated runs, Node 24 on this machine (same V8 as the browser, so a
fair proxy for the same JavaScript):

| Workload | Input | Time |
|---|---|---|
| docx unzip + rezip (`normalizeDocx`, brief 62) | 36 KB real docx | **31 ms** |
| docx unzip + rezip | 45 KB, 40 000 paragraphs | **76 ms** |
| xlsx parse (in the worker) | 8 KB, ~12 cells | 11 ms |
| xlsx serialize (in the worker) | same | 6 ms |
| xlsx parse (in the worker) | 271 KB, **50 000 cells** | **240 ms** |
| xlsx serialize (in the worker) | 50 000 cells | **328 ms** |
| CSV parse | 1.5 MB, 250 000 fields | **33 ms** |
| CSV → Univer model | same | **95 ms** |
| CSV write back | same | **70 ms** |

Read those against the frame budget: 16 ms is one frame, ~100 ms is the threshold
where an interaction stops feeling instant, and anything past ~300 ms reads as a
freeze.

## Recommendations, per candidate

| Candidate | Verdict | Why |
|---|---|---|
| **xlsx round-trip** | **keep the worker** | 240 + 328 ms at 50k cells. On the main thread that is a half-second freeze on every save. The existing worker is vindicated by the numbers, not just by principle. |
| **docx normalize** | **stay synchronous on the main thread** | 31 ms typical, 76 ms pathological, once, behind the open overlay. A worker would add a message round-trip and a second failure mode to save 30 ms nobody can perceive. Brief 62's choice was right for a second reason beyond the CSP. |
| **CSV parse + map** | **move into the existing xlsx worker** — small, worth doing | 95 ms at 1.5 MB is acceptable; the same code at 15 MB is ~1 s of frozen desktop, and CSVs that size are ordinary. The worker already exists and already speaks a request/reply protocol, so this is a message kind, not new infrastructure. |
| **Univer grid render** | **leave it** | Canvas painting driven by user input. Univer owns it; an `OffscreenCanvas` rewrite is a different product. |
| **Snipping Tool `canvas.toBlob`** | **leave it** | Already asynchronous and encoded off-thread by the browser. |
| **Image Viewer rotate/zoom** | **leave it** | CSS transforms. No pixels are touched in JavaScript. |
| **Archive, hashing, SQLite** | **already server-side** | Nothing to move, and moving them into the browser would be the wrong direction. |

## Recommendations for wasm specifically

**Do not add a wasm dependency until the CSP admits one.** After that, three
candidates are worth revisiting and none is urgent:

1. **pdf.js's own decoders** (`jbig2`, `openjpeg`) — the only wasm the repo
   already ships. Cost is copying `pdfjs-dist/wasm/` into the build and setting
   `wasmUrl`; benefit is scanned PDFs rendering their images. This is the one
   with a concrete user-visible payoff, and it needs the CSP change plus asset
   vendoring, in that order.
2. **A faster inflate/deflate** — measured at 31 ms for a real docx. There is
   nothing here to win. Rejected on the numbers.
3. **A spreadsheet formula engine** — Univer already computes formulas, and
   brief 63 explicitly declined to chase Excel function parity. Not a wasm
   question.

Things wasm is genuinely good at that this OS does **not** do in the browser:
video transcoding (rejected — see `real-os-gaps.md`), image codecs beyond what
the browser decodes natively, cryptography (server-side), and compression
(server-side). The slim-image identity also argues against it: every `.wasm` is
image weight for a workload that is currently either fast enough or on the
server.

## The pattern worth keeping

Three of this sweep's bugs — the fflate hang, the chart failure, the blank PDF
pages — were found by running the shipped build and looking, not by reading code.
Two had passing tests nearby. **The CSP is a load-bearing part of the runtime and
it is invisible in dev**, because the Vite dev server sets no CSP at all. Anything
that compiles code, spawns a worker, or opens a connection needs to be checked
against the built artifact behind the real backend before it is believed.

## Out of scope

Changing the CSP (human-gated), vendoring pdf.js's wasm assets, moving CSV into
the worker (a small follow-up brief), and `OffscreenCanvas` anywhere.
EOF
