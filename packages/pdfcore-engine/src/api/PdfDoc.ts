import type { Render } from "../capabilities/Render.js";
import type { Text } from "../capabilities/Text.js";
import type { Outline } from "../capabilities/Outline.js";
import type { Pages } from "../capabilities/Pages.js";
import type { Assemble } from "../capabilities/Assemble.js";
import type { Forms } from "../capabilities/Forms.js";
import type { Annotate } from "../capabilities/Annotate.js";
import type { Sign } from "../capabilities/Sign.js";
import type { Generate } from "../capabilities/Generate.js";
import type { Platform } from "../platform/types.js";
import { getPlatform, requirePlatform } from "../platform/registry.js";

import type { DocumentMetadata, PageSize, PdfBytes } from "./types.js";

import { PdfLibDocument } from "../adapters/pdf-lib/document.js";
import { PdfjsText } from "../adapters/pdfjs/text.js";
import { PdfjsOutline } from "../adapters/pdfjs/outline.js";
import { PdfLibPages } from "../adapters/pdf-lib/pages.js";
import { PdfLibAssemble } from "../adapters/pdf-lib/assemble.js";
import { PdfLibForms } from "../adapters/pdf-lib/forms.js";
import { PdfLibAnnotate } from "../adapters/pdf-lib/annotate.js";
import { SignAdapter } from "../adapters/pdf-lib/sign.js";
import { PdfLibGenerate } from "../adapters/pdf-lib/generate.js";
import { AnnotationModel } from "../model/annotations.js";
import { FormModel } from "../model/forms.js";

/**
 * `PdfDoc` — the public facade (DEC-1/DEC-37). Wraps a loaded document and
 * exposes the ten capabilities as lazy accessors, each backed by an adapter.
 * Callers depend only on this and the capability interfaces; no backend type is
 * ever exposed.
 *
 * ── Wiring for downstream briefs ────────────────────────────────────────────
 * Each capability accessor constructs its adapter once and caches it. To plug
 * an implementation in, a brief fills the bodies of the adapter it owns (e.g.
 * `PdfLibPages` for brief 11) — the accessor here does not change. Write
 * adapters share:
 *   • {@link PdfLibDocument} (`this.#document`) — the one pdf-lib doc every
 *     mutating capability operates on, serialised by {@link save};
 *   • the in-memory {@link AnnotationModel} / {@link FormModel} stores, which
 *     `save()` commits to real PDF objects (DEC-39; briefs 13/14 wire commit).
 *
 * Read capabilities (`render`/`text`/`outline`) read the CURRENT bytes and are
 * invalidated on {@link save} so they re-parse the updated document.
 */
export class PdfDoc {
  #bytes: PdfBytes;
  readonly #platform: Platform | undefined;
  readonly #document: PdfLibDocument;

  // Shared edit models (DEC-39).
  readonly #annotationModel = new AnnotationModel();
  readonly #formModel = new FormModel();

  // Read-side caches (dropped on save).
  #render: Render | undefined;
  #text: Text | undefined;
  #outline: Outline | undefined;

  // Write-side caches (persist across saves; operate on #document).
  #pages: Pages | undefined;
  #assemble: Assemble | undefined;
  // Typed as the concrete adapters (not the public interfaces) so `save()` can
  // call their internal `commit()`; the getters still expose the interface.
  #forms: PdfLibForms | undefined;
  #annotate: PdfLibAnnotate | undefined;
  #sign: Sign | undefined;
  #generate: Generate | undefined;

  private constructor(
    bytes: PdfBytes,
    document: PdfLibDocument,
    platform: Platform | undefined,
  ) {
    this.#bytes = bytes;
    this.#document = document;
    this.#platform = platform;
  }

  /**
   * Load a document from PDF bytes. The platform is taken from the bound entry
   * point (`@pdfcore/engine/browser` | `/node`) unless one is passed
   * explicitly. Only `render` requires a platform; the rest are isomorphic.
   */
  static async load(bytes: PdfBytes, platform?: Platform): Promise<PdfDoc> {
    const document = await PdfLibDocument.load(bytes);
    return new PdfDoc(bytes, document, platform ?? getPlatform());
  }

  /** The current bytes (as of the last load/save). */
  get bytes(): PdfBytes {
    return this.#bytes;
  }

  /** The bound platform name, or `undefined` on the neutral (common) entry. */
  get platform(): "node" | "browser" | undefined {
    return this.#platform?.name;
  }

  /* ───────────────────────────── Document (foundation) ─────────────────── */

  /** Number of pages. */
  pageCount(): number {
    return this.#document.pageCount();
  }

  /** Size (PDF points) of a 1-based page. */
  pageSize(page: number): PageSize {
    return this.#document.pageSize(page);
  }

  /** Sizes of every page, in order. */
  pageSizes(): PageSize[] {
    return this.#document.pageSizes();
  }

  /** Document Info-dictionary metadata. */
  metadata(): DocumentMetadata {
    return this.#document.metadata();
  }

  /**
   * Serialise the working document to bytes and adopt them as current state.
   * Commits the in-memory edit models to real PDF objects (briefs 13/14 wire
   * the commit) and drops read caches so `render`/`text`/`outline` re-parse.
   */
  async save(): Promise<PdfBytes> {
    // Commit the in-memory edit models to real PDF objects before serialising
    // (DEC-39). Each adapter owns its own commit (brief 13 Forms / brief 14
    // Annotate); only an adapter that was accessed can hold pending edits, so
    // an untouched capability is skipped entirely.
    if (this.#annotate) await this.#annotate.commit();
    if (this.#forms) await this.#forms.commit();
    this.#bytes = await this.#document.save();
    this.#render = undefined;
    this.#text = undefined;
    this.#outline = undefined;
    return this.#bytes;
  }

  /* ───────────────────────────── Read & navigate ───────────────────────── */

  /** Render capability (pdf.js). Requires a bound platform. */
  get render(): Render {
    if (this.#render) return this.#render;
    const platform = this.#platform ?? requirePlatform("PdfDoc.render");
    return (this.#render = platform.createRender(this.#bytes));
  }

  /** Text capability (pdf.js, isomorphic). Extract now; search in brief 16. */
  get text(): Text {
    return (this.#text ??= new PdfjsText(this.#bytes));
  }

  /** Outline capability (pdf.js, isomorphic). */
  get outline(): Outline {
    return (this.#outline ??= new PdfjsOutline(this.#bytes));
  }

  /* ───────────────────────────── Edit (stubs → later briefs) ───────────── */

  /** Pages capability (pdf-lib). Stub → brief 11. */
  get pages(): Pages {
    return (this.#pages ??= new PdfLibPages(this.#document));
  }

  /** Assemble capability (pdf-lib). Stub → brief 12. */
  get assemble(): Assemble {
    return (this.#assemble ??= new PdfLibAssemble(this.#document));
  }

  /** Forms capability (pdf-lib + pdf.js geometry). Stub → brief 13. */
  get forms(): Forms {
    return (this.#forms ??= new PdfLibForms(this.#document, this.#formModel));
  }

  /** Annotate capability (pdf-lib + native). Stub → brief 14. */
  get annotate(): Annotate {
    return (this.#annotate ??= new PdfLibAnnotate(
      this.#document,
      this.#annotationModel,
    ));
  }

  /** Sign capability (built on Annotate + Forms). Stub → brief 15. */
  get sign(): Sign {
    return (this.#sign ??= new SignAdapter(this.annotate, this.forms));
  }

  /** Generate capability (pdf-lib). Stub. */
  get generate(): Generate {
    return (this.#generate ??= new PdfLibGenerate(this.#document));
  }
}
