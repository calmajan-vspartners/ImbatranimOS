import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import type { Document } from "../../capabilities/Document.js";
import {
  PdfEngineError,
  PdfEngineWarning,
  SignatureInvalidationWarning,
} from "../../api/errors.js";
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
  readonly #warnings: readonly PdfEngineWarning[];

  private constructor(doc: PDFDocument, warnings: readonly PdfEngineWarning[]) {
    this.#doc = doc;
    this.#warnings = warnings;
  }

  /** Load a Document adapter from existing PDF bytes. */
  static async load(bytes: PdfBytes): Promise<PdfLibDocument> {
    // pdf-lib mutates its input view; copy so callers keep their buffer.
    // `updateMetadata: false` — pdf-lib's default (true) overwrites /Producer
    // and /ModDate on every open, silently rewriting the user's metadata.
    const doc = await PDFDocument.load(new Uint8Array(bytes), {
      updateMetadata: false,
    });
    const warnings: PdfEngineWarning[] = [];
    // Our save() is a full rewrite, which invalidates any existing digital
    // signature. Detect one at load and surface a typed warning so the caller
    // is told before saving over a signed file (rather than failing silently).
    if (hasSignature(doc)) warnings.push(new SignatureInvalidationWarning());
    return new PdfLibDocument(doc, warnings);
  }

  /** Non-fatal warnings raised while loading (e.g. an existing signature). */
  warnings(): readonly PdfEngineWarning[] {
    return this.#warnings;
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
    // `updateFieldAppearances: false` — the Forms adapter's commit() already
    // regenerated appearances for the fields it staged; pdf-lib's default would
    // re-run it over EVERY field (throwing on any non-WinAnsi value and failing
    // the whole save). See PdfLibForms.commit().
    return this.#doc.save({ updateFieldAppearances: false });
  }
}

/**
 * True if the document carries a digital signature. The definitive marker is a
 * `/ByteRange` entry in the signature value dictionary, so scan the indirect
 * objects for any dict that has one.
 */
function hasSignature(doc: PDFDocument): boolean {
  const byteRange = PDFName.of("ByteRange");
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(byteRange)) return true;
  }
  return false;
}
