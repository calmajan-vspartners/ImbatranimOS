/**
 * Web Worker that owns the entire ExcelJS round-trip so xlsx parse/serialize
 * (the CPU-bound per-cell mapping between ExcelJS's async load/writeBuffer) runs
 * off the UI thread. This module is only ever referenced via
 * `new Worker(new URL('./xlsxWorker.ts', import.meta.url), { type: 'module' })`
 * in the bridge, so ExcelJS lands entirely in the worker chunk — never in the
 * desktop boot bundle or the main sheets entry chunk.
 *
 * A real same-origin module worker, NOT a `blob:` one: this OS's CSP has
 * `script-src 'self'` and no `worker-src`, so a blob-URL worker is refused
 * outright (brief 62 found fflate doing exactly that and hanging Docs forever).
 *
 * It handles two request kinds — `parse` (xlsx bytes → Univer snapshot + the
 * lossy-feature scan) and `serialize` (Univer snapshot → xlsx bytes) — echoing
 * each request's `id` on reply, and reporting failures as `{ id, error }` so the
 * bridge can reject the awaiting promise (a corrupt/unsupported file surfaces,
 * never hangs). The mapping itself lives in `./xlsxMapping.ts` so it can be
 * tested directly.
 */
import type { IWorkbookData } from '@univerjs/presets'
import { parse, serialize, type ParseResult } from './xlsxMapping'

// ── Worker message protocol ─────────────────────────────────────────────────
export type ParseRequest = { id: number; kind: 'parse'; bytes: ArrayBuffer }
export type SerializeRequest = { id: number; kind: 'serialize'; snapshot: IWorkbookData }
export type WorkerRequest = ParseRequest | SerializeRequest

export type ParseReply = { id: number; result: ParseResult }
export type SerializeReply = { id: number; result: ArrayBuffer }
export type ErrorReply = { id: number; error: string }
export type WorkerReply = ParseReply | SerializeReply | ErrorReply

// ── Worker entry ─────────────────────────────────────────────────────────────
// tsconfig ships the DOM lib (not WebWorker), so type the dedicated-worker
// global through a minimal local interface rather than DedicatedWorkerGlobalScope.
interface WorkerContext {
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: WorkerReply, transfer?: Transferable[]): void
}
const ctx = self as unknown as WorkerContext

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data
  void (async () => {
    try {
      if (msg.kind === 'parse') {
        const result = await parse(msg.bytes)
        ctx.postMessage({ id: msg.id, result })
      } else {
        const result = await serialize(msg.snapshot)
        // Transfer the freshly-written buffer back to the main thread.
        ctx.postMessage({ id: msg.id, result }, [result])
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      ctx.postMessage({ id: msg.id, error: message })
    }
  })()
}
