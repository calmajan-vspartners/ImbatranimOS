import type { PDFDocumentProxy, PDFDocumentLoadingTask } from "pdfjs-dist";
import type { PdfBytes } from "../../api/types.js";

/**
 * pdf.js backend resolution.
 *
 * In Node the modern `pdfjs-dist` build references browser globals (`DOMMatrix`
 * etc.) at import time and warns to use the legacy build; in the browser the
 * modern build (with a real worker) is what we want. We pick the build at
 * runtime, but with **literal** dynamic-import specifiers in each branch — a
 * *variable* specifier leaves a bare module id that a browser bundler (Vite)
 * can't statically analyse, so it survives to runtime and fails to resolve for
 * every browser consumer of Render/Text/Outline. Literal specifiers let the
 * bundler emit a real chunk. The surfaces are identical, so both branches cast
 * to the modern build's types (the legacy subpath ships no types of its own).
 *
 * The import is memoised so every adapter (Render, Text, Outline) shares one
 * module instance — important so the browser worker configuration set on
 * `GlobalWorkerOptions` applies to documents loaded here.
 */
type Pdfjs = typeof import("pdfjs-dist");

let backendPromise: Promise<Pdfjs> | undefined;

function isNodeEnvironment(): boolean {
  const hasWindow = "window" in globalThis;
  // Via globalThis, not the bare `process` global: this file is type-checked by
  // BROWSER packages (norpdf's tsc walks into it), whose tsconfig deliberately
  // has no @types/node. The bare identifier only ever resolved through an
  // incidental type-graph leak that brief 48's barrel shrink closed.
  const proc = (globalThis as { process?: { versions?: { node?: string } } })
    .process;
  return !hasWindow && !!proc?.versions?.node;
}

export function getPdfjs(): Promise<Pdfjs> {
  if (!backendPromise) {
    backendPromise = isNodeEnvironment()
      ? // Node: the legacy build avoids browser globals at import time.
        // @ts-ignore -- legacy subpath ships no type declarations; surface matches modern
        (import("pdfjs-dist/legacy/build/pdf.mjs") as Promise<Pdfjs>)
      : // Browser: modern build; literal specifier so Vite bundles it into a chunk.
        (import("pdfjs-dist") as Promise<Pdfjs>);
  }
  return backendPromise;
}

/**
 * Parse PDF bytes into a pdf.js document proxy. Shared by the Render, Text and
 * Outline adapters. `getDocument` transfers/detaches its input buffer, so we
 * hand it a fresh copy to leave the caller's bytes intact.
 */
export async function loadPdfjsDocument(
  bytes: PdfBytes,
): Promise<PDFDocumentProxy> {
  return (await loadPdfjsTask(bytes)).promise;
}

/**
 * Like {@link loadPdfjsDocument} but returns the loading TASK, whose
 * `.destroy()` (the proxy has none) releases the worker-side parse. Adapters
 * hold the task so they can dispose it; read the proxy via `task.promise`.
 */
export async function loadPdfjsTask(
  bytes: PdfBytes,
): Promise<PDFDocumentLoadingTask> {
  const { getDocument } = await getPdfjs();
  const data = new Uint8Array(bytes);
  return getDocument({ data });
}

/**
 * Run `fn` against a freshly parsed pdf.js document and ALWAYS destroy it
 * afterward — for one-shot reads (form geometry, annotation seeding) that
 * would otherwise orphan a worker-side document on every call.
 */
export async function withPdfjsDoc<T>(
  bytes: PdfBytes,
  fn: (doc: PDFDocumentProxy) => Promise<T>,
): Promise<T> {
  const task = await loadPdfjsTask(bytes);
  try {
    return await fn(await task.promise);
  } finally {
    void task.destroy();
  }
}
