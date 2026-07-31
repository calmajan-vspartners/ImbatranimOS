import { describe, it, expect, beforeAll } from "vitest";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { PdfDoc } from "../api/PdfDoc.js";
import { PdfEngineError } from "../api/errors.js";
import type { PdfBytes } from "../api/types.js";

/**
 * Build an N-page fixture where each page carries a unique text marker
 * (`${label}-p${n}`), so merge/split order and content can be verified by
 * extracting text rather than trusting byte layout.
 */
async function makeFixture(
  label: string,
  pageCount: number,
): Promise<PdfBytes> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pageCount; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`${label}-p${i}`, {
      x: 72,
      y: 700,
      size: 18,
      font,
      color: rgb(0, 0, 0),
    });
  }
  return doc.save();
}

async function markersOf(bytes: PdfBytes): Promise<string[]> {
  const doc = await PdfDoc.load(bytes);
  const items = await doc.text.extract();
  const byPage = new Map<number, string>();
  for (const item of items) {
    byPage.set(item.page, (byPage.get(item.page) ?? "") + item.str);
  }
  const count = doc.pageCount();
  const out: string[] = [];
  for (let p = 1; p <= count; p++) out.push(byPage.get(p) ?? "");
  return out;
}

describe("Assemble (pdf-lib adapter)", () => {
  let a: PdfBytes; // 2 pages: A-p1, A-p2
  let b: PdfBytes; // 3 pages: B-p1, B-p2, B-p3

  beforeAll(async () => {
    a = await makeFixture("A", 2);
    b = await makeFixture("B", 3);
  });

  it("merge appends every source's pages, in order, preserving size", async () => {
    const doc = await PdfDoc.load(a);
    await doc.assemble.merge(b);

    expect(doc.pageCount()).toBe(5);
    const markers = await markersOf(await doc.save());
    expect(markers).toEqual(["A-p1", "A-p2", "B-p1", "B-p2", "B-p3"]);

    for (let p = 1; p <= 5; p++) {
      expect(doc.pageSize(p)).toEqual({ width: 612, height: 792 });
    }
  });

  it("merge accepts multiple sources in a single call, appended in argument order", async () => {
    const c = await makeFixture("C", 1);
    const doc = await PdfDoc.load(a);
    await doc.assemble.merge(b, c);

    expect(doc.pageCount()).toBe(6);
    const markers = await markersOf(await doc.save());
    expect(markers).toEqual(["A-p1", "A-p2", "B-p1", "B-p2", "B-p3", "C-p1"]);
  });

  it("merge round-trips through save/reload", async () => {
    const doc = await PdfDoc.load(a);
    await doc.assemble.merge(b);
    const saved = await doc.save();

    const reloaded = await PdfDoc.load(saved);
    expect(reloaded.pageCount()).toBe(5);
    expect(await markersOf(saved)).toEqual([
      "A-p1",
      "A-p2",
      "B-p1",
      "B-p2",
      "B-p3",
    ]);
  });

  it("split by explicit ranges produces matching page counts/content", async () => {
    const doc = await PdfDoc.load(a);
    await doc.assemble.merge(b); // 5 pages total: A-p1,A-p2,B-p1,B-p2,B-p3

    const parts = await doc.assemble.split({
      ranges: [
        [1, 2],
        [3, 5],
      ],
    });

    expect(parts).toHaveLength(2);

    const first = await PdfDoc.load(parts[0]!);
    expect(first.pageCount()).toBe(2);
    expect(await markersOf(parts[0]!)).toEqual(["A-p1", "A-p2"]);

    const second = await PdfDoc.load(parts[1]!);
    expect(second.pageCount()).toBe(3);
    expect(await markersOf(parts[1]!)).toEqual(["B-p1", "B-p2", "B-p3"]);
  });

  it("split does not mutate the source document", async () => {
    const doc = await PdfDoc.load(a);
    await doc.assemble.merge(b);
    expect(doc.pageCount()).toBe(5);

    await doc.assemble.split({ ranges: [[1, 1]] });

    expect(doc.pageCount()).toBe(5);
    expect(await markersOf(await doc.save())).toEqual([
      "A-p1",
      "A-p2",
      "B-p1",
      "B-p2",
      "B-p3",
    ]);
  });

  it("split by chunk size ({every}) on a 5-page doc yields [2,2,1]", async () => {
    const doc = await PdfDoc.load(a);
    await doc.assemble.merge(b);

    const parts = await doc.assemble.split({ every: 2 });
    expect(parts).toHaveLength(3);

    const counts = await Promise.all(
      parts.map(async (p) => (await PdfDoc.load(p)).pageCount()),
    );
    expect(counts).toEqual([2, 2, 1]);

    expect(await markersOf(parts[0]!)).toEqual(["A-p1", "A-p2"]);
    expect(await markersOf(parts[1]!)).toEqual(["B-p1", "B-p2"]);
    expect(await markersOf(parts[2]!)).toEqual(["B-p3"]);
  });

  it("split rejects an out-of-range or malformed range", async () => {
    const doc = await PdfDoc.load(a);

    await expect(doc.assemble.split({ ranges: [[1, 3]] })).rejects.toThrow(
      PdfEngineError,
    );
    await expect(doc.assemble.split({ ranges: [[0, 1]] })).rejects.toThrow(
      PdfEngineError,
    );
    await expect(doc.assemble.split({ ranges: [[2, 1]] })).rejects.toThrow(
      PdfEngineError,
    );
  });

  it("split rejects a non-positive chunk size", async () => {
    const doc = await PdfDoc.load(a);
    await expect(doc.assemble.split({ every: 0 })).rejects.toThrow(
      PdfEngineError,
    );
  });
});
