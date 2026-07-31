import { PDFDocument, degrees } from "pdf-lib";
import type { Pages, PageInsert } from "../../capabilities/Pages.js";
import { PdfEngineError } from "../../api/errors.js";
import type { PdfBytes } from "../../api/types.js";
import type { PdfLibDocument } from "./document.js";
import { subsetToBytes } from "./util.js";

/** Default page size (US Letter, points) used when `insert({ kind: "blank" })` omits `size`. */
const DEFAULT_PAGE_SIZE: readonly [number, number] = [612, 792];

/**
 * `pdf-lib`-backed Pages adapter — page-level document surgery (rotate /
 * delete / reorder / insert / extract). Operates directly on the shared
 * {@link PdfLibDocument}'s underlying `PDFDocument` so subsequent Render/Text
 * calls (and `save()`) see the mutated state. `extract` is the exception: it
 * builds a brand-new document and returns its bytes without touching the
 * current one (see {@link subsetToBytes} in `./util.ts`).
 */
export class PdfLibPages implements Pages {
  private readonly doc: PdfLibDocument;

  constructor(doc: PdfLibDocument) {
    this.doc = doc;
  }

  rotate(page: number, degreesToAdd: 90 | 180 | 270 | -90 | -180 | -270): void {
    const p = this.getPage(page, "Pages.rotate");
    const current = p.getRotation().angle;
    const next = (((current + degreesToAdd) % 360) + 360) % 360;
    p.setRotation(degrees(next));
  }

  delete(pages: number | number[]): void {
    const list = Array.isArray(pages) ? pages : [pages];
    if (list.length === 0) return;

    const pdfDoc = this.doc.pdfLibDocument;
    const count = pdfDoc.getPageCount();
    const indices = new Set<number>();
    for (const page of list) {
      if (!Number.isInteger(page) || page < 1 || page > count) {
        throw new PdfEngineError(
          `Pages.delete: page ${page} out of range (document has ${count} page(s)).`,
        );
      }
      indices.add(page - 1);
    }

    // Remove highest-index-first so earlier removals don't shift later indices.
    const sorted = [...indices].sort((a, b) => b - a);
    for (const idx of sorted) pdfDoc.removePage(idx);
  }

  reorder(fromIndex: number, toIndex: number): void {
    const pdfDoc = this.doc.pdfLibDocument;
    const count = pdfDoc.getPageCount();
    for (const [name, idx] of [
      ["fromIndex", fromIndex],
      ["toIndex", toIndex],
    ] as const) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= count) {
        throw new PdfEngineError(
          `Pages.reorder: ${name} ${idx} out of range (document has ${count} page(s)).`,
        );
      }
    }
    if (fromIndex === toIndex) return;

    const page = pdfDoc.getPage(fromIndex);
    // removePage/insertPage indices both refer to the *current* page array at
    // the time of the call — this matches Array#splice(from,1)+splice(to,0,x)
    // semantics exactly (toIndex is the final position in the shortened array).
    pdfDoc.removePage(fromIndex);
    pdfDoc.insertPage(toIndex, page);
  }

  async insert(atIndex: number, what: PageInsert): Promise<void> {
    const pdfDoc = this.doc.pdfLibDocument;
    const count = pdfDoc.getPageCount();
    if (!Number.isInteger(atIndex) || atIndex < 0 || atIndex > count) {
      throw new PdfEngineError(
        `Pages.insert: atIndex ${atIndex} out of range (document has ${count} page(s), valid insert range 0..${count}).`,
      );
    }

    if (what.kind === "blank") {
      const size = what.size ?? {
        width: DEFAULT_PAGE_SIZE[0],
        height: DEFAULT_PAGE_SIZE[1],
      };
      pdfDoc.insertPage(atIndex, [size.width, size.height]);
      return;
    }

    // what.kind === "bytes": copy the requested (1-based) pages from the
    // external document and splice the copies in at atIndex, preserving order.
    const src = await PDFDocument.load(new Uint8Array(what.bytes));
    const srcCount = src.getPageCount();
    const pages =
      what.pages ?? Array.from({ length: srcCount }, (_, i) => i + 1);
    const indices = pages.map((p) => {
      if (!Number.isInteger(p) || p < 1 || p > srcCount) {
        throw new PdfEngineError(
          `Pages.insert: source page ${p} out of range (source has ${srcCount} page(s)).`,
        );
      }
      return p - 1;
    });

    const copied = await pdfDoc.copyPages(src, indices);
    copied.forEach((copiedPage, i) => {
      pdfDoc.insertPage(atIndex + i, copiedPage);
    });
  }

  async extract(pages: number[]): Promise<PdfBytes> {
    const pdfDoc = this.doc.pdfLibDocument;
    const count = pdfDoc.getPageCount();
    const indices = pages.map((p) => {
      if (!Number.isInteger(p) || p < 1 || p > count) {
        throw new PdfEngineError(
          `Pages.extract: page ${p} out of range (document has ${count} page(s)).`,
        );
      }
      return p - 1;
    });
    return subsetToBytes(pdfDoc, indices);
  }

  /** Resolve a 1-based page number to its pdf-lib `PDFPage`, or throw. */
  private getPage(page: number, what: string) {
    const pdfDoc = this.doc.pdfLibDocument;
    const count = pdfDoc.getPageCount();
    if (!Number.isInteger(page) || page < 1 || page > count) {
      throw new PdfEngineError(
        `${what}: page ${page} out of range (document has ${count} page(s)).`,
      );
    }
    return pdfDoc.getPage(page - 1);
  }
}
