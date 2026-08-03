/**
 * Lazy bridge to SuperDoc — the real docx editor with browser-side round-trip.
 * SuperDoc (Vue app + ProseMirror + docx converter) is heavy and only pulled in
 * on first open via dynamic import, so it becomes its own build chunk and never
 * touches the desktop boot bundle. Only `import type` lives at module top level.
 *
 * SuperDoc is AGPL-3.0 — the whole repo is relicensed AGPL-3.0-only to match
 * (see /LICENSE).
 */
import type { SuperDoc as SuperDocClass } from '@harbour-enterprises/superdoc'

export type DocEngine = {
  /** Export the current document back to docx bytes. */
  exportDocx: () => Promise<ArrayBuffer>
  /**
   * Monotonic count of every editor update. Save records this before exporting
   * and only clears dirty if it is unchanged once the upload resolves — so edits
   * made mid-save aren't silently clobbered.
   */
  editCount: () => number
  /** Tear down the editor and release its resources. */
  destroy: () => void
}

type CreateDocEngineOptions = {
  /** Element the editor mounts into. */
  editor: HTMLElement
  /** CSS selector (e.g. `#docs-toolbar-<id>`) of the toolbar mount element. */
  toolbar: string
  /** The docx file to load. */
  file: File
  /** Called once the editor is ready and interactive. */
  onReady: () => void
  /** Called on the first content-changing edit (for dirty tracking). */
  onEdit: () => void
  /** Called only if the document genuinely fails to load/parse. */
  onError: (err: unknown) => void
}

export async function createDocEngine(opts: CreateDocEngineOptions): Promise<DocEngine> {
  const [{ SuperDoc }] = await Promise.all([
    import('@harbour-enterprises/superdoc'),
    import('@harbour-enterprises/superdoc/style.css'),
  ])

  let readyFired = false
  let editCount = 0
  const superdoc: SuperDocClass = new SuperDoc({
    selector: opts.editor,
    toolbar: opts.toolbar,
    document: opts.file,
    documentMode: 'editing',
    // SuperDoc defaults to `telemetry: { enabled: true }` and POSTs to
    // `https://ingest.superdoc.dev/v1/collect` on every document open. The
    // desktop's CSP (`connect-src 'self'`) already refuses it — that refusal is
    // how it was found — but blocking an outbound call the app deliberately
    // makes is the wrong layer to rely on: a deployment behind a proxy that
    // relaxes the CSP would start leaking. The user's documents are their own,
    // and nothing about opening one should reach a third party.
    telemetry: { enabled: false },
    onReady: () => {
      if (!readyFired) {
        readyFired = true
        opts.onReady()
      }
    },
    onEditorUpdate: () => {
      editCount++
      opts.onEdit()
    },
    // Only a genuine content/parse failure is fatal. `onException` fires for a
    // range of internal, often-benign conditions (incl. during export), so it is
    // logged, not surfaced as an "open failed" error.
    onContentError: ({ error }) => opts.onError(error),
    onException: (params) => console.warn('[docs] superdoc exception', params),
  })

  return {
    exportDocx: async () => {
      const blob = await superdoc.export({ exportType: ['docx'], triggerDownload: false })
      return blob.arrayBuffer()
    },
    editCount: () => editCount,
    destroy: () => {
      try {
        superdoc.destroy()
      } catch {
        // best-effort teardown
      }
    },
  }
}
