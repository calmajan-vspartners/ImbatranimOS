import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Outline } from "../../capabilities/Outline.js";
import type {
  NamedDestination,
  OutlineNode,
  PdfBytes,
} from "../../api/types.js";
import { loadPdfjsDocument } from "./document.js";

/** A raw pdf.js outline item (subset of the fields we use). */
interface RawOutlineItem {
  title: string;
  dest: string | unknown[] | null;
  items: RawOutlineItem[];
}

/**
 * `pdfjs-dist`-backed Outline adapter. Reads the document outline (bookmarks)
 * and named destinations, resolving destinations to 0-based page indices where
 * possible. Isomorphic (`common`).
 */
export class PdfjsOutline implements Outline {
  readonly #bytes: PdfBytes;
  #doc: PDFDocumentProxy | undefined;

  constructor(bytes: PdfBytes) {
    this.#bytes = bytes;
  }

  async tree(): Promise<OutlineNode[]> {
    const doc = await this.#document();
    const raw = (await doc.getOutline()) as RawOutlineItem[] | null;
    if (!raw) return [];
    return this.#mapItems(doc, raw);
  }

  async destinations(): Promise<NamedDestination[]> {
    const doc = await this.#document();
    const dests = (await doc.getDestinations()) as Record<string, unknown[]>;
    const out: NamedDestination[] = [];
    for (const [name, dest] of Object.entries(dests)) {
      out.push({ name, pageIndex: await this.#pageIndexOf(doc, dest) });
    }
    return out;
  }

  async #mapItems(
    doc: PDFDocumentProxy,
    items: RawOutlineItem[],
  ): Promise<OutlineNode[]> {
    const nodes: OutlineNode[] = [];
    for (const item of items) {
      const node: OutlineNode = {
        title: item.title,
        children: await this.#mapItems(doc, item.items ?? []),
      };
      if (typeof item.dest === "string") node.dest = item.dest;
      const pageIndex = await this.#resolveDest(doc, item.dest);
      if (pageIndex !== undefined) node.pageIndex = pageIndex;
      nodes.push(node);
    }
    return nodes;
  }

  /** Resolve an outline `dest` (named string or explicit array) to a page index. */
  async #resolveDest(
    doc: PDFDocumentProxy,
    dest: string | unknown[] | null,
  ): Promise<number | undefined> {
    if (!dest) return undefined;
    if (typeof dest === "string") {
      const explicit = (await doc.getDestination(dest)) as unknown[] | null;
      return explicit ? this.#pageIndexOf(doc, explicit) : undefined;
    }
    return this.#pageIndexOf(doc, dest);
  }

  async #pageIndexOf(
    doc: PDFDocumentProxy,
    dest: unknown[],
  ): Promise<number | undefined> {
    const ref = dest[0];
    if (!ref || typeof ref !== "object") return undefined;
    try {
      return await doc.getPageIndex(ref as never);
    } catch {
      return undefined;
    }
  }

  async #document(): Promise<PDFDocumentProxy> {
    if (this.#doc) return this.#doc;
    this.#doc = await loadPdfjsDocument(this.#bytes);
    return this.#doc;
  }
}
