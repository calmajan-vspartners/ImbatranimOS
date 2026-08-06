import type { PDFDocumentProxy, PDFDocumentLoadingTask } from "pdfjs-dist";
import type { TextItem as PdfJsTextItem } from "pdfjs-dist/types/src/display/api.js";
import type { Text } from "../../capabilities/Text.js";
import type {
  TextExtractOptions,
  TextHit,
  TextItem,
  TextSearchOptions,
} from "../../api/types.js";
import { loadPdfjsTask } from "./document.js";
import { searchDocument } from "./search.js";

/**
 * `pdfjs-dist`-backed Text adapter (isomorphic — DEC-40 drops the old Node-only
 * `pdf.js-extract` split; `getTextContent()` gives positional text on both
 * platforms). pdf.js text items carry a transform matrix `[a,b,c,d,e,f]` where
 * `(e,f)` is the position in PDF user space (origin bottom-left), so extracted
 * coordinates already agree with pdf-lib's draw origin.
 *
 * `search` (brief 16) delegates to `./search.js` — see that module for the
 * matching/rect algorithm; here we just own the document handle.
 */
export class PdfjsText implements Text {
  readonly #bytes: Uint8Array;
  #task: PDFDocumentLoadingTask | undefined;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }

  async extract(opts?: TextExtractOptions): Promise<TextItem[]> {
    const doc = await this.#document();
    const wanted = opts?.pages ?? range(1, doc.numPages);
    const items: TextItem[] = [];

    for (const pageNumber of wanted) {
      if (pageNumber < 1 || pageNumber > doc.numPages) continue;
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      for (const raw of content.items) {
        if (!isTextItem(raw)) continue;
        if (raw.str === "") continue;
        const [, , , , e, f] = raw.transform as number[];
        items.push({
          page: pageNumber,
          x: e ?? 0,
          y: f ?? 0,
          str: raw.str,
          w: raw.width,
          h: raw.height,
        });
      }
    }
    return items;
  }

  async plain(opts?: TextExtractOptions): Promise<string> {
    const doc = await this.#document();
    const wanted = opts?.pages ?? range(1, doc.numPages);
    const pageStrings: string[] = [];
    for (const pageNumber of wanted) {
      if (pageNumber < 1 || pageNumber > doc.numPages) continue;
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      pageStrings.push(
        content.items
          .filter(isTextItem)
          .map((t) => t.str)
          .join(" "),
      );
    }
    return pageStrings.join("\n");
  }

  async search(query: string, opts?: TextSearchOptions): Promise<TextHit[]> {
    const doc = await this.#document();
    return searchDocument(doc, query, opts);
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

function isTextItem(item: unknown): item is PdfJsTextItem {
  return (
    typeof item === "object" &&
    item !== null &&
    "str" in item &&
    "transform" in item
  );
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}
