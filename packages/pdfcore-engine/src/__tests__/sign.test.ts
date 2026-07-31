import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { loadPdf } from "../index.node.js";
import { PdfEngineError } from "../api/errors.js";
import type { PdfBytes, Point } from "../api/types.js";
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

/** Minimal 1x1 PNG (red) for the signature-image path. */
const RED_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

/**
 * Build a fixture carrying one real AcroForm **signature** field. pdf-lib's
 * high-level `PDFForm` has no `createSignature`, so we author a merged
 * field/widget dict (`/FT /Sig`, `/Subtype /Widget`) directly: register it,
 * add it to the AcroForm `/Fields`, and to the page `/Annots`. On reload the
 * Forms adapter classifies it as `type: "signature"` with the given rect/page.
 */
async function makeSignatureFieldFixture(
  name = "sigField",
  rect: [number, number, number, number] = [100, 100, 300, 160],
): Promise<PdfBytes> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const ctx = doc.context;

  const fieldDict = ctx.obj({
    Type: "Annot",
    Subtype: "Widget",
    FT: "Sig",
    T: PDFString.of(name),
    Rect: rect,
    P: page.ref,
    F: 4,
  });
  const fieldRef = ctx.register(fieldDict);

  page.node.addAnnot(fieldRef);
  const acroForm = doc.getForm().acroForm;
  acroForm.addField(fieldRef);
  // Signature-bearing docs advertise SigFlags; harmless for our visual fill.
  acroForm.dict.set(PDFName.of("SigFlags"), ctx.obj(3));

  return doc.save();
}

function byType(list: Annotation[], type: string): Annotation | undefined {
  return list.find((a) => a.type === type);
}

function rectOf(a: Annotation | undefined): number[] {
  return (a as unknown as { rect: number[] }).rect;
}

describe("Sign capability (composes Annotate + Forms)", () => {
  it("place(image) lands a stamp at the requested rect and survives save→reload", async () => {
    const doc = await loadPdf(await makeBlank());
    doc.sign.place({
      page: 1,
      rect: [80, 200, 260, 260],
      mark: { kind: "image", image: RED_PNG },
    });
    const saved = await doc.save();

    const reloaded = await loadPdf(saved);
    const list = reloaded.annotate.list(1);
    const stamp = byType(list, "stamp");
    expect(stamp).toBeDefined();
    const rect = rectOf(stamp);
    expect(rect[0]).toBeCloseTo(80);
    expect(rect[1]).toBeCloseTo(200);
    expect(rect[2]).toBeCloseTo(260);
    expect(rect[3]).toBeCloseTo(260);
  });

  it("place(vector) adds an ink annotation whose strokes fill the requested rect", async () => {
    const doc = await loadPdf(await makeBlank());
    // Capture-space strokes in an arbitrary box (0..10 x 0..5).
    const paths: Point[][] = [
      [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 10, y: 0 },
      ],
    ];
    doc.sign.place({
      page: 1,
      rect: [100, 100, 300, 200],
      mark: { kind: "vector", paths, width: 2 },
    });

    // The staged ink is visible immediately via list() (before save).
    const ink = byType(doc.annotate.list(1), "ink") as
      | { paths: Point[][]; width?: number }
      | undefined;
    expect(ink).toBeDefined();
    expect(ink!.width).toBe(2);
    expect(ink!.paths).toHaveLength(1);
    // bbox of mapped points fills the target rect exactly.
    const pts = ink!.paths[0]!;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(100);
    expect(Math.max(...xs)).toBeCloseTo(300);
    expect(Math.min(...ys)).toBeCloseTo(100);
    expect(Math.max(...ys)).toBeCloseTo(200);
    // Midpoint x=5 maps to rect midpoint x=200; apex y=5 maps to top y=200.
    expect(pts[1]!.x).toBeCloseTo(200);
    expect(pts[1]!.y).toBeCloseTo(200);
  });

  it("place(vector) round-trips as an ink annotation through save→reload", async () => {
    const doc = await loadPdf(await makeBlank());
    doc.sign.place({
      page: 1,
      rect: [50, 50, 150, 120],
      mark: {
        kind: "vector",
        paths: [
          [
            { x: 0, y: 0 },
            { x: 1, y: 2 },
            { x: 2, y: 0 },
          ],
        ],
      },
    });
    const saved = await doc.save();

    const reloaded = await loadPdf(saved);
    const ink = byType(reloaded.annotate.list(1), "ink");
    expect(ink).toBeDefined();
  });

  it("place respects the 1-based page index", async () => {
    const doc = await loadPdf(await makeBlank(2));
    doc.sign.place({
      page: 2,
      rect: [80, 200, 260, 260],
      mark: { kind: "image", image: RED_PNG },
    });
    const saved = await doc.save();

    const reloaded = await loadPdf(saved);
    expect(byType(reloaded.annotate.list(1), "stamp")).toBeUndefined();
    expect(byType(reloaded.annotate.list(2), "stamp")).toBeDefined();
  });

  it("fillSignatureField(image) places a stamp over a signature field's rect", async () => {
    const doc = await loadPdf(
      await makeSignatureFieldFixture("sigField", [100, 100, 300, 160]),
    );
    // Sanity: Forms sees it as a signature field.
    expect(doc.forms.get("sigField")?.type).toBe("signature");

    doc.sign.fillSignatureField("sigField", { kind: "image", image: RED_PNG });
    const saved = await doc.save();

    const reloaded = await loadPdf(saved);
    const stamp = byType(reloaded.annotate.list(1), "stamp");
    expect(stamp).toBeDefined();
    const rect = rectOf(stamp);
    expect(rect[0]).toBeCloseTo(100, 0);
    expect(rect[1]).toBeCloseTo(100, 0);
    expect(rect[2]).toBeCloseTo(300, 0);
    expect(rect[3]).toBeCloseTo(160, 0);
  });

  it("fillSignatureField(vector) places ink over the signature field's rect", async () => {
    const doc = await loadPdf(
      await makeSignatureFieldFixture("mySig", [40, 400, 240, 460]),
    );
    doc.sign.fillSignatureField("mySig", {
      kind: "vector",
      paths: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
      ],
      width: 3,
    });
    const ink = byType(doc.annotate.list(), "ink") as
      | { paths: Point[][] }
      | undefined;
    expect(ink).toBeDefined();
    const pts = ink!.paths[0]!;
    expect(Math.min(...pts.map((p) => p.x))).toBeCloseTo(40);
    expect(Math.max(...pts.map((p) => p.x))).toBeCloseTo(240);
    expect(Math.min(...pts.map((p) => p.y))).toBeCloseTo(400);
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(460);
  });

  it("fillSignatureField throws a clear error when the field is absent", async () => {
    const doc = await loadPdf(await makeSignatureFieldFixture());
    expect(() =>
      doc.sign.fillSignatureField("ghost", { kind: "image", image: RED_PNG }),
    ).toThrow(PdfEngineError);
    expect(() =>
      doc.sign.fillSignatureField("ghost", { kind: "image", image: RED_PNG }),
    ).toThrow(/ghost/);
  });

  it("fillSignatureField throws when the named field is not a signature field", async () => {
    // A blank doc with a text field: fill should reject it.
    const src = await PDFDocument.create();
    const page = src.addPage([600, 800]);
    const form = src.getForm();
    const tf = form.createTextField("notASig");
    tf.addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
    const bytes = await src.save();

    const doc = await loadPdf(bytes);
    expect(() =>
      doc.sign.fillSignatureField("notASig", { kind: "image", image: RED_PNG }),
    ).toThrow(/not a signature field/);
  });
});
