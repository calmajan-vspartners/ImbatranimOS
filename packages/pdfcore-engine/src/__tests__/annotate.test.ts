import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef } from "pdf-lib";
import { loadPdf } from "../index.node.js";
import { readAnnotationsWithPdfjs } from "../adapters/pdfjs/read-annotations.js";
import type { PdfBytes } from "../api/types.js";
import type { Annotation } from "../capabilities/Annotate.js";

/** A blank N-page fixture (no annotations) built with pdf-lib directly. */
async function makeBlank(
  pages = 1,
  size: [number, number] = [400, 400],
): Promise<PdfBytes> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage(size);
  return doc.save();
}

/** Minimal 1x1 PNG (red) for the stamp image path. */
const RED_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

function byType(list: Annotation[], type: string): Annotation | undefined {
  return list.find((a) => a.type === type);
}

/** Inspect the raw /Annots of a saved PDF (via pdf-lib) for structural checks. */
async function rawAnnots(bytes: PdfBytes, pageIndex = 0) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(pageIndex);
  const annots = page.node.Annots();
  const out: { subtype: string; hasRect: boolean; hasAP: boolean }[] = [];
  if (!annots) return out;
  for (let i = 0; i < annots.size(); i++) {
    const el = annots.get(i);
    const dict =
      el instanceof PDFRef ? doc.context.lookup(el, PDFDict) : (el as PDFDict);
    const subtype = dict.lookup(PDFName.of("Subtype"), PDFName).decodeText();
    const hasRect = !!dict.lookupMaybe(PDFName.of("Rect"), PDFArray);
    const hasAP = !!dict.lookupMaybe(PDFName.of("AP"), PDFDict);
    out.push({ subtype, hasRect, hasAP });
  }
  return out;
}

describe("Annotate capability (pdf-lib + native adapter)", () => {
  it("highlight round-trips add → save → reload → list()", async () => {
    const doc = await loadPdf(await makeBlank());
    const id = doc.annotate.add({
      type: "highlight",
      page: 1,
      rect: [50, 300, 200, 315],
      color: { r: 1, g: 1, b: 0 },
      contents: "important",
    });
    expect(id).toBeTruthy();
    const saved = await doc.save();

    const reloaded = await loadPdf(saved);
    const list = reloaded.annotate.list(1);
    const hl = byType(list, "highlight");
    expect(hl).toBeDefined();
    expect(hl!.type).toBe("highlight");
    const rect = (hl as { rect: number[] }).rect;
    expect(rect[0]).toBeCloseTo(50);
    expect(rect[1]).toBeCloseTo(300);
    expect(rect[2]).toBeCloseTo(200);
    expect(rect[3]).toBeCloseTo(315);
    expect(hl!.contents).toBe("important");
  });

  it("freeText round-trips including its text content", async () => {
    const doc = await loadPdf(await makeBlank());
    doc.annotate.add({
      type: "freeText",
      page: 1,
      rect: [40, 200, 260, 240],
      text: "Hello annotation",
      fontSize: 14,
      color: { r: 0, g: 0, b: 1 },
    });
    const saved = await doc.save();

    const reloaded = await loadPdf(saved);
    const ft = byType(reloaded.annotate.list(), "freeText") as
      | { text: string; rect: number[] }
      | undefined;
    expect(ft).toBeDefined();
    expect(ft!.text).toBe("Hello annotation");
    expect(ft!.rect[0]).toBeCloseTo(40);
  });

  it("ink round-trips its stroke paths", async () => {
    const doc = await loadPdf(await makeBlank());
    doc.annotate.add({
      type: "ink",
      page: 1,
      paths: [
        [
          { x: 50, y: 50 },
          { x: 80, y: 120 },
          { x: 150, y: 60 },
        ],
      ],
      width: 2,
      color: { r: 1, g: 0, b: 0 },
    });
    const saved = await doc.save();

    const reloaded = await loadPdf(saved);
    const ink = byType(reloaded.annotate.list(), "ink") as
      | { paths: { x: number; y: number }[][] }
      | undefined;
    expect(ink).toBeDefined();
    expect(ink!.paths).toHaveLength(1);
    expect(ink!.paths[0]).toHaveLength(3);
    expect(ink!.paths[0]![0]!.x).toBeCloseTo(50);
    expect(ink!.paths[0]![2]!.y).toBeCloseTo(60);
  });

  it("every v1 subtype persists as a real annotation object and re-loads", async () => {
    const doc = await loadPdf(await makeBlank());
    const a = doc.annotate;
    a.add({ type: "highlight", page: 1, rect: [10, 350, 120, 365] });
    a.add({ type: "underline", page: 1, rect: [10, 330, 120, 345] });
    a.add({ type: "strikeout", page: 1, rect: [10, 310, 120, 325] });
    a.add({
      type: "ink",
      page: 1,
      paths: [
        [
          { x: 10, y: 10 },
          { x: 40, y: 40 },
        ],
      ],
    });
    a.add({
      type: "rect",
      page: 1,
      rect: [150, 150, 220, 210],
      fill: { r: 0.9, g: 0.9, b: 0.9 },
    });
    a.add({
      type: "line",
      page: 1,
      start: { x: 250, y: 250 },
      end: { x: 350, y: 260 },
    });
    a.add({
      type: "arrow",
      page: 1,
      start: { x: 250, y: 100 },
      end: { x: 350, y: 130 },
    });
    a.add({
      type: "freeText",
      page: 1,
      rect: [40, 40, 200, 70],
      text: "note box",
    });
    a.add({ type: "note", page: 1, at: { x: 300, y: 350 }, text: "sticky" });
    a.add({
      type: "stamp",
      page: 1,
      rect: [300, 200, 360, 250],
      image: RED_PNG,
      name: "Logo",
    });
    const saved = await doc.save();

    const reloaded = await loadPdf(saved);
    const types = reloaded.annotate
      .list()
      .map((x) => x.type)
      .sort();
    expect(types).toEqual(
      [
        "arrow",
        "freeText",
        "highlight",
        "ink",
        "line",
        "note",
        "rect",
        "stamp",
        "strikeout",
        "underline",
      ].sort(),
    );
  });

  it("a standards reader (pdf.js) sees the emitted annotations", async () => {
    const doc = await loadPdf(await makeBlank());
    doc.annotate.add({ type: "highlight", page: 1, rect: [50, 300, 200, 315] });
    doc.annotate.add({
      type: "freeText",
      page: 1,
      rect: [40, 200, 260, 240],
      text: "hi",
    });
    doc.annotate.add({
      type: "ink",
      page: 1,
      paths: [
        [
          { x: 10, y: 10 },
          { x: 40, y: 40 },
        ],
      ],
    });
    const saved = await doc.save();

    const seen = (await readAnnotationsWithPdfjs(saved))
      .map((s) => s.type)
      .sort();
    expect(seen).toEqual(["freeText", "highlight", "ink"].sort());
  });

  it("highlight / freeText / ink emit structurally correct /Annots entries (Subtype, Rect, AP)", async () => {
    const doc = await loadPdf(await makeBlank());
    doc.annotate.add({ type: "highlight", page: 1, rect: [50, 300, 200, 315] });
    doc.annotate.add({
      type: "freeText",
      page: 1,
      rect: [40, 200, 260, 240],
      text: "hi",
    });
    doc.annotate.add({
      type: "ink",
      page: 1,
      paths: [
        [
          { x: 10, y: 10 },
          { x: 40, y: 40 },
        ],
      ],
    });
    const saved = await doc.save();

    const raw = await rawAnnots(saved);
    const bySub = new Map(raw.map((r) => [r.subtype, r]));
    for (const sub of ["Highlight", "FreeText", "Ink"]) {
      expect(bySub.has(sub)).toBe(true);
      expect(bySub.get(sub)!.hasRect).toBe(true);
      expect(bySub.get(sub)!.hasAP).toBe(true);
    }
  });

  it("loads a document with PRE-EXISTING annotations as editable and does not duplicate them", async () => {
    // Build a document that already carries committed annotations.
    const seed = await loadPdf(await makeBlank());
    seed.annotate.add({
      type: "highlight",
      page: 1,
      rect: [50, 300, 200, 315],
      contents: "seeded",
    });
    seed.annotate.add({
      type: "note",
      page: 1,
      at: { x: 300, y: 350 },
      text: "seeded note",
    });
    const preexisting = await seed.save();

    // Reopen: the two annotations must load into list() (re-editable seed).
    const doc = await loadPdf(preexisting);
    expect(doc.annotate.list().length).toBe(2);

    // Add one more, save, reopen: exactly 3 — seeded ones are not re-emitted.
    doc.annotate.add({
      type: "ink",
      page: 1,
      paths: [
        [
          { x: 10, y: 10 },
          { x: 40, y: 40 },
        ],
      ],
    });
    const saved = await doc.save();

    const reopened = await loadPdf(saved);
    const list = reopened.annotate.list();
    expect(list.length).toBe(3);
    expect(byType(list, "highlight")!.contents).toBe("seeded");
    expect(byType(list, "note")).toBeDefined();
    expect(byType(list, "ink")).toBeDefined();
  });

  it("update on a seeded annotation persists through save → reload", async () => {
    const seed = await loadPdf(await makeBlank());
    seed.annotate.add({
      type: "highlight",
      page: 1,
      rect: [50, 300, 200, 315],
      contents: "old",
    });
    const preexisting = await seed.save();

    const doc = await loadPdf(preexisting);
    const id = doc.annotate.list()[0]!.id;
    doc.annotate.update(id, { contents: "new text" });
    const saved = await doc.save();

    const reopened = await loadPdf(saved);
    const list = reopened.annotate.list();
    expect(list.length).toBe(1); // edit rewrites in place, no duplicate
    expect(byType(list, "highlight")!.contents).toBe("new text");
  });

  it("delete on a seeded annotation persists through save → reload", async () => {
    const seed = await loadPdf(await makeBlank());
    seed.annotate.add({
      type: "highlight",
      page: 1,
      rect: [50, 300, 200, 315],
      contents: "keep",
    });
    seed.annotate.add({
      type: "freeText",
      page: 1,
      rect: [40, 200, 260, 240],
      text: "drop me",
    });
    const preexisting = await seed.save();

    const doc = await loadPdf(preexisting);
    const ft = byType(doc.annotate.list(), "freeText")!;
    doc.annotate.delete(ft.id);
    const saved = await doc.save();

    const reopened = await loadPdf(saved);
    const list = reopened.annotate.list();
    expect(list.length).toBe(1);
    expect(byType(list, "freeText")).toBeUndefined();
    expect(byType(list, "highlight")!.contents).toBe("keep");
  });

  it("delete on a not-yet-committed annotation simply drops it", async () => {
    const doc = await loadPdf(await makeBlank());
    const id = doc.annotate.add({
      type: "highlight",
      page: 1,
      rect: [50, 300, 200, 315],
    });
    doc.annotate.add({
      type: "note",
      page: 1,
      at: { x: 300, y: 350 },
      text: "kept",
    });
    doc.annotate.delete(id);
    const saved = await doc.save();

    const reopened = await loadPdf(saved);
    const list = reopened.annotate.list();
    expect(list.length).toBe(1);
    expect(byType(list, "note")).toBeDefined();
  });

  it("list(page) filters by page and annotations land on the right page", async () => {
    const doc = await loadPdf(await makeBlank(2));
    doc.annotate.add({ type: "highlight", page: 1, rect: [50, 300, 200, 315] });
    doc.annotate.add({ type: "highlight", page: 2, rect: [50, 300, 200, 315] });
    const saved = await doc.save();

    const reopened = await loadPdf(saved);
    expect(reopened.annotate.list(1).length).toBe(1);
    expect(reopened.annotate.list(2).length).toBe(1);
    expect(reopened.annotate.list().length).toBe(2);
  });

  it("a second save with no further edits does not duplicate annotations", async () => {
    const doc = await loadPdf(await makeBlank());
    doc.annotate.add({ type: "highlight", page: 1, rect: [50, 300, 200, 315] });
    await doc.save();
    const saved2 = await doc.save();

    const reopened = await loadPdf(saved2);
    expect(reopened.annotate.list().length).toBe(1);
  });
});
