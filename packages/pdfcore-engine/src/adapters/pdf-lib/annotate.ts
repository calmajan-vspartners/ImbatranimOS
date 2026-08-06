import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRef,
  type PDFDocument,
} from "pdf-lib";
import type {
  Annotate,
  Annotation,
  AnnotationPatch,
  AnnotationSpec,
} from "../../capabilities/Annotate.js";
import type { Color, Rect } from "../../api/types.js";
import type { AnnotationModel } from "../../model/annotations.js";
import { rawToSpec, type RawAnnotation } from "../pdfjs/read-annotations.js";
import { NativeAnnotationWriter } from "../native/annotate.js";
import type { PdfLibDocument } from "./document.js";

/**
 * `pdf-lib`-backed Annotate adapter (brief 14). CRUD operates on the in-memory
 * {@link AnnotationModel}; `save()` (via the facade) calls {@link commit}, which
 * writes the model to real PDF annotation objects.
 *
 * pdf-lib 1.17 has no high-level annotation API, so all dictionary + appearance
 * authoring is delegated to {@link NativeAnnotationWriter} (DEC-2/DEC-39); this
 * adapter owns model wiring, the re-editability seed, and ref bookkeeping for
 * update/delete of existing objects.
 *
 * Re-editability seed: existing annotations are read back into the model on
 * first access. Because the {@link Annotate} interface is synchronous, the seed
 * reads annotation dictionaries **synchronously from pdf-lib** (rather than via
 * the async pdf.js reader) so `list()` returns loaded annotations without an
 * awaited hook. It reuses `rawToSpec` from the pdf.js reader so both readers map
 * identically. See `adapters/pdfjs/read-annotations.ts`.
 */
export class PdfLibAnnotate implements Annotate {
  #seeded = false;
  /**
   * Model id → the PDF object backing it, for later rewrite/removal. Keyed by
   * the page's `PDFRef` (NOT a load-time page index): a delete/reorder shuffles
   * indices, so an index would strip the annotation off the wrong page.
   */
  readonly #refs = new Map<string, { ref: PDFRef; pageRef: PDFRef }>();

  private readonly doc: PdfLibDocument;
  private readonly model: AnnotationModel;

  constructor(doc: PdfLibDocument, model: AnnotationModel) {
    this.doc = doc;
    this.model = model;
  }

  add(spec: AnnotationSpec): string {
    this.#ensureSeeded();
    return this.model.add(spec);
  }

  update(id: string, patch: AnnotationPatch): void {
    this.#ensureSeeded();
    this.model.update(id, patch);
  }

  delete(id: string): void {
    this.#ensureSeeded();
    this.model.delete(id);
  }

  list(page?: number): Annotation[] {
    this.#ensureSeeded();
    return this.model.list(page);
  }

  /**
   * Commit the annotation model to real PDF annotation objects. Removes the
   * objects of deleted/edited seeded annotations, then (re)emits new and edited
   * annotations via {@link NativeAnnotationWriter}, and finally marks the model
   * committed so a subsequent no-edit save is a no-op. Called by
   * {@link PdfDoc.save}; only runs when the Annotate accessor was touched.
   */
  async commit(): Promise<void> {
    this.#ensureSeeded();
    const pdf = this.doc.pdfLibDocument;

    const toWrite = this.model.toWrite();
    // Seeded (pre-existing) annotations that were EDITED: their object is
    // stripped and re-emitted, so we must carry forward any third-party keys
    // (/M /NM /RC /F /IRT /CreationDate …) the native writer doesn't author.
    const editedIds = new Set(
      toWrite.filter((a) => this.model.isSeeded(a.id)).map((a) => a.id),
    );

    // Strip stale objects (deletes + edited-in-place) first, capturing the old
    // dict of edited ones so their keys can be merged onto the re-emit.
    const preserved = new Map<string, PDFDict>();
    for (const id of this.model.toRemove()) {
      const entry = this.#refs.get(id);
      if (!entry) continue;
      if (editedIds.has(id)) {
        const old = pdf.context.lookupMaybe(entry.ref, PDFDict);
        if (old) preserved.set(id, old);
      }
      const page = pdf.getPages().find((p) => p.ref === entry.pageRef);
      page?.node.removeAnnot(entry.ref);
      this.#refs.delete(id);
    }

    // Emit new + edited annotations.
    const writer = new NativeAnnotationWriter(this.doc);
    for (const ann of toWrite) {
      const { ref, pageIndex } = await writer.emit(ann);
      const old = preserved.get(ann.id);
      if (old) mergePreservedKeys(pdf, old, ref);
      const pageRef = pdf.getPages()[pageIndex]?.ref;
      if (pageRef) this.#refs.set(ann.id, { ref, pageRef });
    }

    this.model.markCommitted();
  }

  /* ── synchronous re-editability seed (pdf-lib) ──────────────────────────── */

  #ensureSeeded(): void {
    if (this.#seeded) return;
    this.#seeded = true; // guard reentry before we start mutating the model
    const pdf = this.doc.pdfLibDocument;
    const pages = pdf.getPages();
    for (let p = 0; p < pages.length; p++) {
      const annots = pages[p]!.node.Annots();
      if (!annots) continue;
      for (let i = 0; i < annots.size(); i++) {
        const el = annots.get(i);
        if (!(el instanceof PDFRef)) continue;
        const dict = pdf.context.lookupMaybe(el, PDFDict);
        if (!dict) continue;
        const raw = dictToRaw(dict, p + 1);
        if (!raw) continue;
        const spec = rawToSpec(raw);
        if (!spec) continue;
        const id = `existing_p${p + 1}_${i}`;
        this.model.seed({ ...spec, id } as Annotation);
        this.#refs.set(id, { ref: el, pageRef: pages[p]!.ref });
      }
    }
  }
}

/* ── key preservation for edited seeded annotations ─────────────────────── */

/**
 * Keys the {@link NativeAnnotationWriter} authors itself — everything the
 * engine owns and re-derives from the model on each re-emit. Any key on the old
 * dict NOT in this set is third-party (a viewer's `/M`, `/NM`, `/RC`, `/F`,
 * `/IRT`, `/CreationDate`, …) and must be carried forward.
 */
const ENGINE_OWNED_KEYS = new Set<string>([
  "Type",
  "Rect",
  "Subtype",
  "Contents",
  "T",
  "CA",
  "C",
  "IC",
  "QuadPoints",
  "AP",
  "BS",
  "InkList",
  "L",
  "LE",
  "Name",
  "Open",
  "DA",
]);

/**
 * Copy third-party keys from an edited annotation's OLD dict onto its freshly
 * re-emitted one, so re-editing a pre-existing (third-party) annotation does
 * not silently drop the keys the engine doesn't model. The orphaned `/Popup`
 * (its `/Parent` pointed at the object we just replaced) is dropped and its
 * object deleted rather than carried forward.
 */
function mergePreservedKeys(
  pdf: PDFDocument,
  oldDict: PDFDict,
  newRef: PDFRef,
): void {
  const newDict = pdf.context.lookupMaybe(newRef, PDFDict);
  if (!newDict) return;

  const popupRef = oldDict.get(PDFName.of("Popup"));
  if (popupRef instanceof PDFRef) pdf.context.delete(popupRef);

  for (const [key, value] of oldDict.entries()) {
    const name = key.decodeText();
    if (name === "Popup") continue;
    if (ENGINE_OWNED_KEYS.has(name)) continue;
    if (newDict.has(key)) continue;
    newDict.set(key, value);
  }
}

/* ── pdf-lib dictionary → RawAnnotation ─────────────────────────────────── */

function nameOf(dict: PDFDict, key: string): string | undefined {
  const v = dict.lookupMaybe(PDFName.of(key), PDFName);
  return v ? v.decodeText() : undefined;
}

function textOf(dict: PDFDict, key: string): string | undefined {
  const v = dict.lookup(PDFName.of(key));
  return v &&
    typeof (v as unknown as { decodeText?: unknown }).decodeText === "function"
    ? (v as unknown as { decodeText: () => string }).decodeText()
    : undefined;
}

function numbersOf(dict: PDFDict, key: string): number[] | undefined {
  const arr = dict.lookupMaybe(PDFName.of(key), PDFArray);
  if (!arr) return undefined;
  const out: number[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const n = arr.lookup(i, PDFNumber);
    if (n) out.push(n.asNumber());
  }
  return out;
}

function colorOf(nums: number[] | undefined): Color | undefined {
  if (!nums || !nums.length) return undefined;
  if (nums.length === 1) return { r: nums[0]!, g: nums[0]!, b: nums[0]! };
  if (nums.length >= 3) return { r: nums[0]!, g: nums[1]!, b: nums[2]! };
  return undefined;
}

function dictToRaw(dict: PDFDict, page: number): RawAnnotation | undefined {
  const subtype = nameOf(dict, "Subtype");
  if (!subtype) return undefined;
  const rectNums = numbersOf(dict, "Rect");
  if (!rectNums || rectNums.length < 4) return undefined;
  const rect: Rect = [rectNums[0]!, rectNums[1]!, rectNums[2]!, rectNums[3]!];

  const bs = dict.lookupMaybe(PDFName.of("BS"), PDFDict);
  const bsW = bs?.lookupMaybe(PDFName.of("W"), PDFNumber)?.asNumber();
  const ca = dict.lookupMaybe(PDFName.of("CA"), PDFNumber)?.asNumber();

  const inkArr = dict.lookupMaybe(PDFName.of("InkList"), PDFArray);
  let inkList: number[][] | undefined;
  if (inkArr) {
    inkList = [];
    for (let i = 0; i < inkArr.size(); i++) {
      const stroke = inkArr.lookup(i, PDFArray);
      if (!stroke) continue;
      const flat: number[] = [];
      for (let j = 0; j < stroke.size(); j++) {
        const n = stroke.lookup(j, PDFNumber);
        if (n) flat.push(n.asNumber());
      }
      inkList.push(flat);
    }
  }

  const le = dict.lookupMaybe(PDFName.of("LE"), PDFArray);
  let arrow = false;
  if (le) {
    for (let i = 0; i < le.size(); i++) {
      const n = le.lookup(i, PDFName);
      if (n && /Arrow/i.test(n.decodeText())) arrow = true;
    }
  }
  const lineNums = numbersOf(dict, "L");

  return {
    subtype,
    page,
    rect,
    color: colorOf(numbersOf(dict, "C")),
    fill: colorOf(numbersOf(dict, "IC")),
    opacity: ca,
    contents: textOf(dict, "Contents") || undefined,
    author: textOf(dict, "T") || undefined,
    width: bsW,
    quadPoints: numbersOf(dict, "QuadPoints"),
    inkList,
    line:
      lineNums && lineNums.length >= 4
        ? [lineNums[0]!, lineNums[1]!, lineNums[2]!, lineNums[3]!]
        : undefined,
    arrow,
    name: nameOf(dict, "Name"),
  };
}
