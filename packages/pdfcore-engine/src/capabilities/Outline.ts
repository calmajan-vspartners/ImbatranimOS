import type { NamedDestination, OutlineNode } from "../api/types.js";

/**
 * Outline — the document outline/bookmarks tree and named destinations, for
 * navigation. Backed by `pdfjs-dist`.
 *
 * Platform: **common** (isomorphic).
 */
export interface Outline {
  /** The outline (bookmark) tree; empty array if the document has none. */
  tree(): Promise<OutlineNode[]>;

  /** Named destinations resolved to 0-based page indices where possible. */
  destinations(): Promise<NamedDestination[]>;

  /**
   * Release the underlying pdf.js document (and its worker-side memory).
   * Idempotent; the adapter re-parses lazily if used again after disposal.
   */
  dispose(): void;
}
