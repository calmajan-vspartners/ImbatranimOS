/**
 * Lazy bridge between xlsx bytes and Univer's workbook model, backed by
 * **ExcelJS** (MIT). The entire ExcelJS round-trip — load + cell→Univer mapping
 * on parse, Univer→cell + writeBuffer on serialize — runs in a dedicated Web
 * Worker (`./xlsxWorker.ts`), so the CPU-bound per-cell iteration never blocks
 * the desktop's UI thread. Because the worker is the only thing that imports
 * ExcelJS, the heavy `exceljs` chunk lands entirely in the worker chunk and
 * never in the desktop boot bundle or the main sheets entry chunk. The worker
 * is created lazily on first open/save (same as the old dynamic import) and
 * reused across every subsequent open/save.
 *
 * SheetJS Community Edition was the original pick but its writer silently drops
 * cell styles (bold/fills/colors) — proven in the brief-20 spike — so it fails
 * the "basic styles survive open→edit→save" bar. ExcelJS reads *and* writes
 * fonts, fills, number formats and formulas, which the spike verified via an
 * independent openpyxl round-trip. This bridge maps the intersection Univer can
 * render: values, formulas, number formats, bold/italic, font color, and solid
 * cell fills. The mapping code itself lives in the worker (moved verbatim, not
 * rewritten) so fidelity is unchanged — this module only owns the threading.
 */
import type { IWorkbookData } from '@univerjs/presets'
import type { ParseResult } from './xlsxMapping'
import type { WorkerReply, WorkerRequest } from './xlsxWorker'

/**
 * A request that never gets an answer must still end.
 *
 * `onerror`/`onmessageerror` cover a worker that fails loudly, but not one that
 * is alive and silent — and brief 62 is the standing lesson here: fflate's
 * blocked worker produced a promise that never settled, so Docs showed a
 * spinner forever with no error to report. A ceiling turns that class of bug
 * into a message. Generous, because a genuinely large workbook takes time and a
 * timeout that fires on real work is worse than none.
 */
const REQUEST_TIMEOUT_MS = 120_000

// One worker instance, created lazily on first use and cached like pdf.js's
// `pdfjsPromise`: repeated opens/saves reuse the same worker. Each request gets
// an incrementing id so parse and serialize replies can't cross wires.
let worker: Worker | null = null
let nextId = 0
const pending = new Map<
  number,
  {
    resolve: (value: unknown) => void
    reject: (reason: Error) => void
    timer: ReturnType<typeof setTimeout>
  }
>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./xlsxWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (ev: MessageEvent<WorkerReply>) => {
      const reply = ev.data
      const entry = pending.get(reply.id)
      if (!entry) return
      clearTimeout(entry.timer)
      pending.delete(reply.id)
      if ('error' in reply) {
        // Reject with a real Error so Sheets.tsx's catch fires on a corrupt or
        // unsupported file instead of the promise hanging forever.
        entry.reject(new Error(reply.error))
      } else {
        entry.resolve(reply.result)
      }
    }
    // A worker-level failure (module load error, uncaught crash) sends no
    // id-tagged reply, so fail every in-flight request rather than hang, and
    // drop the instance so the next call spawns a fresh worker.
    const failAll = (message: string) => {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer)
        entry.reject(new Error(message))
      }
      pending.clear()
      worker = null
    }
    worker.onerror = (ev) => failAll(ev.message || 'xlsx worker crashed')
    worker.onmessageerror = () => failAll('xlsx worker received an uncloneable message')
  }
  return worker
}

// Distributive Omit so `bytes`/`snapshot` survive the union (a plain
// `Omit<WorkerRequest, 'id'>` collapses to the members' common keys).
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

// Post a request and await the reply correlated by id. `transfer` neuters the
// listed buffers, so callers must not touch them again after handing them over.
function request<T>(
  msg: DistributiveOmit<WorkerRequest, 'id'>,
  transfer: Transferable[] = []
): Promise<T> {
  const w = getWorker()
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('The spreadsheet engine stopped responding.'))
    }, REQUEST_TIMEOUT_MS)
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
    w.postMessage({ ...msg, id }, transfer)
  })
}

/**
 * Parse xlsx bytes into a Univer workbook snapshot, plus the list of features
 * the package holds that a save will not preserve.
 */
export function xlsxToUniver(bytes: ArrayBuffer): Promise<ParseResult> {
  // Transfer the input buffer into the worker (neuters `bytes` here — the caller
  // does not read it again after this call).
  return request<ParseResult>({ kind: 'parse', bytes }, [bytes])
}

/** Serialize a Univer workbook snapshot back to xlsx bytes. */
export function univerToXlsx(snapshot: IWorkbookData): Promise<ArrayBuffer> {
  // The snapshot is a plain structured-cloneable object — post it as-is; the
  // worker transfers the freshly-written buffer back to us.
  return request<ArrayBuffer>({ kind: 'serialize', snapshot })
}
