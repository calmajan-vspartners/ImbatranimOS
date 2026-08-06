/**
 * Lazy bridge to pdf.js. `pdfjs-dist` (plus its web worker) is heavy and must
 * never land in the desktop boot bundle — it is pulled in on first open via
 * dynamic import, so the whole engine becomes its own chunk. Nothing here is
 * imported at module top level (the `import type` is erased at build time).
 */
import { installMapGetOrInsert } from '@imbatranim/ui'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

// The library + worker are configured exactly once, then cached: repeated opens
// reuse the same module instance and worker URL (pdf.js spawns its own workers).
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null

async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      // Before the library loads: pdf.js 6.1 calls Map.prototype
      // .getOrInsertComputed on every render, and without it every page is blank
      // on Chrome 141 and earlier (brief 91).
      installMapGetOrInsert()
      const lib = await import('pdfjs-dist')
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
      lib.GlobalWorkerOptions.workerSrc = workerUrl
      return lib
    })()
  }
  return pdfjsPromise
}

export type LoadedPdf = {
  doc: PDFDocumentProxy
  /** Tears down the worker transport for this document (pdf.js v6: on the task). */
  destroy: () => void
}

/** Parse an ArrayBuffer of PDF bytes into a document handle + its destroyer. */
export async function loadPdfDocument(data: ArrayBuffer): Promise<LoadedPdf> {
  const pdfjs = await getPdfjs()
  // getDocument transfers/detaches the buffer; hand it a copy so the caller's
  // ArrayBuffer stays intact if it needs to reload.
  const task = pdfjs.getDocument({ data: data.slice(0) })
  const doc = await task.promise
  return {
    doc,
    destroy: () => {
      void task.destroy()
    },
  }
}

export type { PDFDocumentProxy, PDFPageProxy }
