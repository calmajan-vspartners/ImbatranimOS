import { PDFDocument } from "pdf-lib";
import type { Document } from "../../capabilities/Document.js";
import { PdfEngineError } from "../../api/errors.js";
import type { DocumentMetadata, PageSize, PdfBytes } from "../../api/types.js";

/**
 * `pdf-lib`-backed Document adapter — load/parse, metadata, page geometry and
 * save. This is the write-side root the facade holds; the mutating capabilities
 * (Pages/Assemble/Forms/Annotate/Sign/Generate) all operate on the same
 * underlying `PDFDocument` and are serialised by {@link save}.
 *
 * Platform: common (pdf-lib is isomorphic).
 */
export class PdfLibDocument implements Document {
  readonly #doc: PDFDocument;

  private constructor(doc: PDFDocument) {
    this.#doc = doc;
  }

  /** Load a Document adapter from existing PDF bytes. */
  static async load(bytes: PdfBytes): Promise<PdfLibDocument> {
    // pdf-lib mutates its input view; copy so callers keep their buffer.
    const doc = await PDFDocument.load(new Uint8Array(bytes));
    return new PdfLibDocument(doc);
  }

  /** The underlying pdf-lib document — used by sibling adapters (briefs 11-15). */
  get pdfLibDocument(): PDFDocument {
    return this.#doc;
  }

  pageCount(): number {
    return this.#doc.getPageCount();
  }

  pageSize(page: number): PageSize {
    const idx = page - 1;
    const pages = this.#doc.getPages();
    const p = pages[idx];
    if (!p) {
      throw new PdfEngineError(
        `pageSize: page ${page} out of range (document has ${pages.length} page(s)).`,
      );
    }
    const { width, height } = p.getSize();
    return { width, height };
  }

  pageSizes(): PageSize[] {
    return this.#doc.getPages().map((p) => {
      const { width, height } = p.getSize();
      return { width, height };
    });
  }

  metadata(): DocumentMetadata {
    const d = this.#doc;
    return {
      title: d.getTitle(),
      author: d.getAuthor(),
      subject: d.getSubject(),
      keywords: d.getKeywords(),
      creator: d.getCreator(),
      producer: d.getProducer(),
      creationDate: d.getCreationDate(),
      modificationDate: d.getModificationDate(),
    };
  }

  async save(): Promise<PdfBytes> {
    return this.#doc.save();
  }
}
