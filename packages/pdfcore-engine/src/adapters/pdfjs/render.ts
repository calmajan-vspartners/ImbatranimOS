import type { PDFDocumentProxy, PDFDocumentLoadingTask } from "pdfjs-dist";
import type { Render } from "../../capabilities/Render.js";
import { PdfEngineError } from "../../api/errors.js";
import type {
  PageViewport,
  PdfBytes,
  RenderOptions,
  RenderResult,
  RenderTarget,
} from "../../api/types.js";
import { loadPdfjsTask } from "./document.js";

/**
 * `pdfjs-dist`-backed Render adapter. Isomorphic core: in the browser `target`
 * is a real `HTMLCanvasElement`; in Node it is a `@napi-rs/canvas` canvas — any
 * object exposing `getContext("2d")` + width/height works.
 *
 * Worker ownership: the pdf.js worker is configured by the platform layer
 * *before* this adapter is constructed — the **browser** path owns
 * `GlobalWorkerOptions.workerSrc` (see `worker.browser.ts`) so consumers never
 * re-wire it; the Node path uses `worker.node.ts`.
 */
export class PdfjsRender implements Render {
  readonly #bytes: PdfBytes;
  #task: PDFDocumentLoadingTask | undefined;

  constructor(bytes: PdfBytes) {
    this.#bytes = bytes;
  }

  async pageCount(): Promise<number> {
    const doc = await this.#document();
    return doc.numPages;
  }

  async page(
    page: number,
    target: RenderTarget,
    opts?: RenderOptions,
  ): Promise<RenderResult> {
    const doc = await this.#document();
    if (page < 1 || page > doc.numPages) {
      throw new PdfEngineError(
        `Render.page: page ${page} out of range (document has ${doc.numPages} page(s)).`,
      );
    }
    const pdfPage = await doc.getPage(page);
    const viewport = pdfPage.getViewport({
      scale: opts?.scale ?? 1,
      rotation: opts?.rotation,
    });

    const ctx = target.getContext("2d");
    if (!ctx) {
      throw new PdfEngineError("Render.page: target has no 2d context.");
    }
    target.width = Math.ceil(viewport.width);
    target.height = Math.ceil(viewport.height);

    await pdfPage.render({
      // pdf.js accepts canvas + 2d-context-shaped objects; our RenderTarget is
      // structurally a canvas (browser HTMLCanvasElement or Node napi canvas).
      canvas: target as never,
      canvasContext: ctx as never,
      viewport,
    }).promise;

    return { width: target.width, height: target.height };
  }

  async viewport(page: number, opts?: RenderOptions): Promise<PageViewport> {
    const doc = await this.#document();
    if (page < 1 || page > doc.numPages) {
      throw new PdfEngineError(
        `Render.viewport: page ${page} out of range (document has ${doc.numPages} page(s)).`,
      );
    }
    const pdfPage = await doc.getPage(page);
    const scale = opts?.scale ?? 1;
    const vp = pdfPage.getViewport({ scale, rotation: opts?.rotation });
    // Unrotated intrinsic size (rotation 0, scale 1).
    const base = pdfPage.getViewport({ scale: 1, rotation: 0 });
    return {
      width: vp.width,
      height: vp.height,
      pageWidth: base.width,
      pageHeight: base.height,
      scale,
      rotation: vp.rotation,
    };
  }

  /** Release the pdf.js document + its worker-side memory. Idempotent. */
  dispose(): void {
    void this.#task?.destroy();
    this.#task = undefined;
  }

  async #document(): Promise<PDFDocumentProxy> {
    if (this.#task) return this.#task.promise;
    this.#task = await loadPdfjsTask(this.#bytes);
    return this.#task.promise;
  }
}
