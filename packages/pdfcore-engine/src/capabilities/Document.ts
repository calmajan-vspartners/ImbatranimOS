import type { DocumentMetadata, PageSize, PdfBytes } from "../api/types.js";

/**
 * Document — the foundation capability. Parse bytes, read metadata and page
 * geometry, and **save** (write bytes back). The root handle every other
 * capability hangs off. Backed by `pdf-lib` (write) with `pdfjs-dist` used
 * elsewhere for parsing.
 *
 * Platform: **common** (pdf-lib is isomorphic).
 */
export interface Document {
  /** Number of pages in the document. */
  pageCount(): number;

  /** Intrinsic size (PDF points) of a page by 1-based index. */
  pageSize(page: number): PageSize;

  /** Intrinsic sizes of every page, in order. */
  pageSizes(): PageSize[];

  /** Document Info-dictionary metadata (subset). */
  metadata(): DocumentMetadata;

  /**
   * Serialise the working document (including any committed edits) to bytes.
   * @see PdfDoc.save which delegates here.
   */
  save(): Promise<PdfBytes>;
}
