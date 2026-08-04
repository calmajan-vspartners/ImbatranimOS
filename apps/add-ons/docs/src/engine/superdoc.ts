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

/** One hit from {@link DocEngine.search}, opaque apart from being passable back. */
export type DocMatch = { readonly __brand?: 'DocMatch' }

export type DocEngine = {
  /** Export the current document back to docx bytes. */
  exportDocx: () => Promise<ArrayBuffer>
  /**
   * Find every occurrence of `text`, highlighted in the document.
   *
   * SuperDoc's own `search` command; the matches are opaque tokens that
   * {@link goToMatch} resolves back to positions. Returns `[]` when nothing
   * matches and when the engine has no active editor yet.
   */
  search: (text: string, opts?: { caseSensitive?: boolean }) => DocMatch[]
  /** Scroll to and select a match returned by {@link search}. */
  goToMatch: (match: DocMatch) => void
  /** The document's rendered HTML, for the word count. */
  html: () => string
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
    search: (text, opts) => {
      // The facade's `search` takes only a pattern, so case sensitivity is
      // expressed as a RegExp flag rather than an option — and the user's text is
      // escaped first, or a search for "a.b" would match "axb" and a stray "("
      // would throw a SyntaxError mid-typing.
      const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = new RegExp(escaped, opts?.caseSensitive ? 'g' : 'gi')
      // Returns undefined when there is no active editor or the active projection
      // has no search command — both mean "no matches" here, not an error.
      return (superdoc.search(pattern) ?? []) as DocMatch[]
    },
    goToMatch: (match) => {
      superdoc.goToSearchResult(match as Parameters<typeof superdoc.goToSearchResult>[0])
    },
    // getHTML returns one entry per editor; a docx is one document, so join
    // rather than assume [0] — a multi-editor future would silently under-count.
    html: () => (superdoc.getHTML() ?? []).join('\n'),
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
