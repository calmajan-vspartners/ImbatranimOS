import type {
  PageViewport,
  RenderOptions,
  RenderResult,
  RenderTarget,
} from "../api/types.js";

/**
 * Render — rasterise a page onto a canvas at a scale + rotation, and report
 * page viewport geometry. Backed by `pdfjs-dist`.
 *
 * Platform: **browser** (real `HTMLCanvasElement`) and **node**
 * (`@napi-rs/canvas`). The browser adapter OWNS pdf.js worker configuration
 * (see adapters/pdfjs/worker.browser.ts) so consumers never re-wire it.
 */
export interface Render {
  /** Number of pages in the document. */
  pageCount(): Promise<number>;

  /**
   * Render a single page onto a 2D canvas target.
   * @param page 1-based page index.
   * @param target a canvas-like object exposing `getContext("2d")` + width/height.
   * @param opts scale / rotation.
   * @returns the pixel dimensions that were drawn.
   */
  page(
    page: number,
    target: RenderTarget,
    opts?: RenderOptions,
  ): Promise<RenderResult>;

  /**
   * Page viewport geometry at a given scale/rotation — the shared bridge the
   * selection layer (brief 16) and annotation hit-testing (brief 14) align to.
   * @param page 1-based page index.
   */
  viewport(page: number, opts?: RenderOptions): Promise<PageViewport>;

  /**
   * Release the underlying pdf.js document (and its worker-side memory).
   * Idempotent; the adapter re-parses lazily if used again after disposal.
   */
  dispose(): void;
}
