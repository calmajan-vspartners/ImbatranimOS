---
title: Office docx/xlsx parsing blocks the UI thread
created: 2026-07-17
status: promoted
tags: [add-on, perf, debt]
---

<!-- Both slices shipped: docx → brief 27 (2026-07-17), xlsx → brief 32 (2026-07-17). -->


# Office docx/xlsx parsing runs on the main thread

Found in the 2026-07-17 review pass (PERF-6). The Docs and Sheets engines
parse and serialize documents synchronously on the main thread, so a
large file freezes the entire desktop for hundreds of milliseconds to
seconds.

> **Docs slice DONE** (2026-07-17,
> [brief 27](../../briefs/done/27-docx-offthread-unzip.md)): `docxNormalize.ts`
> now uses fflate's async `unzip`/`zip` (off-thread worker pool), identical
> output. **Xlsx slice below is still open.**

Docs used fflate's synchronous zip APIs (now async, see brief 27). Sheets
uses ExcelJS, whose
`load`/`writeBuffer` are async
(`apps/add-ons/sheets/src/engine/xlsxBridge.ts:91` and `:191`), but the
per-cell iteration between them is CPU-bound and still runs on the main
thread (`xlsxBridge.ts:96-114` reading cells, `:165-189` writing cells).

The pattern to mirror already exists: pdf.js runs in a Web Worker
(`apps/add-ons/pdf-viewer/src/engine/pdf.ts:17` sets `workerSrc`).

Suggested approach: move parse/serialize into a Web Worker per engine.
fflate ships async `unzip`/`zip` variants; run ExcelJS inside the worker
and post the plain Univer snapshot back to the main thread. Keep the
worker boundary at the engine layer so the components stay unchanged.

Deferred because it is real per-engine engineering plus testing (worker
bundling, transferable buffers, error propagation across the boundary),
not a mechanical change.
