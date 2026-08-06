import type {
  TextExtractOptions,
  TextHit,
  TextItem,
  TextSearchOptions,
} from "../api/types.js";

/**
 * Text — positional text extraction and in-document search/find. Backed by
 * `pdfjs-dist` `getTextContent()`.
 *
 * Platform: **common** (isomorphic — pdf.js text extraction runs on both node
 * and browser; DEC-40). The DOM-hosted *selectable text layer* built on top of
 * this is the one browser-only piece (brief 16, `browser/` layer).
 */
export interface Text {
  /**
   * Positional text fragments across the document, in page/reading order.
   * @returns one {@link TextItem} per fragment (PDF points, bottom-left origin).
   */
  extract(opts?: TextExtractOptions): Promise<TextItem[]>;

  /** Convenience: all text as a single newline-joined-per-page string. */
  plain(opts?: TextExtractOptions): Promise<string>;

  /**
   * Find occurrences of `query`, returning ordered hits with per-hit highlight
   * rects (PDF user space). Handles matches spanning multiple text items.
   *
   * Implemented by **brief 16** — the brief-09 adapter throws `NotImplemented`.
   */
  search(query: string, opts?: TextSearchOptions): Promise<TextHit[]>;

  /**
   * Release the underlying pdf.js document (and its worker-side memory).
   * Idempotent; the adapter re-parses lazily if used again after disposal.
   */
  dispose(): void;
}
