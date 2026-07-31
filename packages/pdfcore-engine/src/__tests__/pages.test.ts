import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { loadPdf } from "../index.node.js";

/**
 * Build an N-page fixture using pdf-lib directly (the engine's Generate
 * capability is out of scope here). Each page carries a distinct one-word
 * text marker at a known baseline so page identity survives reorder/delete/
 * insert/extract and can be asserted via `Text.extract()`.
 */
async function makeFixture(
  markers: string[],
  size: [number, number] = [612, 792],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const marker of markers) {
    const page = doc.addPage(size);
    page.drawText(marker, {
      x: 72,
      y: 700,
      size: 18,
      font,
      color: rgb(0, 0, 0),
    });
  }
  return doc.save();
}

/** Read back the per-page marker order via positional text extraction. */
async function markerOrder(
  bytes: Uint8Array,
  pageCount: number,
): Promise<(string | undefined)[]> {
  const doc = await loadPdf(bytes);
  const items = await doc.text.extract();
  return Array.from({ length: pageCount }, (_, i) => i + 1).map(
    (page) => items.find((it) => it.page === page)?.str,
  );
}

describe("Pages capability (pdf-lib adapter)", () => {
  it("rotate composes with existing rotation, normalizes to 0-270, and survives save→reload", async () => {
    const fixture = await makeFixture(["A"]);

    const doc1 = await loadPdf(fixture);
    doc1.pages.rotate(1, 90);
    const saved1 = await doc1.save();
    expect(
      (await PDFDocument.load(saved1)).getPage(0).getRotation().angle,
    ).toBe(90);

    const doc2 = await loadPdf(saved1);
    doc2.pages.rotate(1, 180); // 90 + 180 = 270
    const saved2 = await doc2.save();
    expect(
      (await PDFDocument.load(saved2)).getPage(0).getRotation().angle,
    ).toBe(270);

    const doc3 = await loadPdf(saved2);
    doc3.pages.rotate(1, -270); // 270 - 270 = 0, normalized
    const saved3 = await doc3.save();
    expect(
      (await PDFDocument.load(saved3)).getPage(0).getRotation().angle,
    ).toBe(0);
  });

  it("delete accepts a single 1-based page number", async () => {
    const fixture = await makeFixture(["A", "B"]);
    const doc = await loadPdf(fixture);
    doc.pages.delete(1);
    expect(doc.pageCount()).toBe(1);

    const saved = await doc.save();
    expect(await markerOrder(saved, 1)).toEqual(["B"]);
  });

  it("delete accepts multiple 1-based page numbers (order-independent) and survives save→reload", async () => {
    const fixture = await makeFixture(["A", "B", "C", "D"]);
    const doc = await loadPdf(fixture);
    doc.pages.delete([2, 4]); // remove B and D, in ascending order in the call
    expect(doc.pageCount()).toBe(2);

    const saved = await doc.save();
    expect(await markerOrder(saved, 2)).toEqual(["A", "C"]);
  });

  it("reorder moves a page (0-based) and survives save→reload", async () => {
    const fixture = await makeFixture(["A", "B", "C"]);
    const doc = await loadPdf(fixture);
    doc.pages.reorder(0, 2); // A moves to the end: B, C, A
    expect(doc.pageCount()).toBe(3);

    const saved = await doc.save();
    expect(await markerOrder(saved, 3)).toEqual(["B", "C", "A"]);
  });

  it("reorder moving forward-to-back and back-to-front both land correctly", async () => {
    const fixture = await makeFixture(["A", "B", "C", "D"]);
    const doc = await loadPdf(fixture);
    doc.pages.reorder(3, 0); // D moves to the front: D, A, B, C
    const saved = await doc.save();
    expect(await markerOrder(saved, 4)).toEqual(["D", "A", "B", "C"]);
  });

  it("insert blank page increases count, uses the requested size, and survives save→reload", async () => {
    const fixture = await makeFixture(["A", "B"]);
    const doc = await loadPdf(fixture);
    await doc.pages.insert(1, {
      kind: "blank",
      size: { width: 300, height: 400 },
    });
    expect(doc.pageCount()).toBe(3);
    expect(doc.pageSize(2)).toEqual({ width: 300, height: 400 });

    const saved = await doc.save();
    const reloaded = await loadPdf(saved);
    expect(reloaded.pageCount()).toBe(3);
    expect(reloaded.pageSize(2)).toEqual({ width: 300, height: 400 });
    expect(await markerOrder(saved, 3)).toEqual(["A", undefined, "B"]);
  });

  it("insert blank page defaults to US Letter (612x792) when size is omitted", async () => {
    const fixture = await makeFixture(["A"]);
    const doc = await loadPdf(fixture);
    await doc.pages.insert(0, { kind: "blank" });
    expect(doc.pageSize(1)).toEqual({ width: 612, height: 792 });
  });

  it("insert bytes copies only the requested (1-based) source pages, in the given order", async () => {
    const fixtureA = await makeFixture(["A", "B"]);
    const fixtureX = await makeFixture(["X", "Y", "Z"]);
    const doc = await loadPdf(fixtureA);
    await doc.pages.insert(1, {
      kind: "bytes",
      bytes: fixtureX,
      pages: [3, 1],
    }); // Z then X
    expect(doc.pageCount()).toBe(4);

    const saved = await doc.save();
    expect(await markerOrder(saved, 4)).toEqual(["A", "Z", "X", "B"]);
  });

  it("insert bytes with no `pages` copies the whole source document, in order", async () => {
    const fixtureA = await makeFixture(["A"]);
    const fixtureX = await makeFixture(["X", "Y"]);
    const doc = await loadPdf(fixtureA);
    await doc.pages.insert(1, { kind: "bytes", bytes: fixtureX });
    expect(doc.pageCount()).toBe(3);

    const saved = await doc.save();
    expect(await markerOrder(saved, 3)).toEqual(["A", "X", "Y"]);
  });

  it("extract returns a NEW document with only the requested pages, in order, without mutating the source", async () => {
    const fixture = await makeFixture(["A", "B", "C"]);
    const doc = await loadPdf(fixture);
    const extractedBytes = await doc.pages.extract([3, 1]);

    // Source document is untouched.
    expect(doc.pageCount()).toBe(3);
    expect(await markerOrder(await doc.save(), 3)).toEqual(["A", "B", "C"]);

    const extracted = await loadPdf(extractedBytes);
    expect(extracted.pageCount()).toBe(2);
    expect(await markerOrder(extractedBytes, 2)).toEqual(["C", "A"]);
  });

  it("composes: delete then reorder without corrupting the doc", async () => {
    const fixture = await makeFixture(["A", "B", "C", "D", "E"]);
    const doc = await loadPdf(fixture);
    doc.pages.delete([2, 4]); // remove B, D -> A, C, E
    doc.pages.reorder(0, 2); // move A to the end -> C, E, A
    expect(doc.pageCount()).toBe(3);

    const saved = await doc.save();
    expect(await markerOrder(saved, 3)).toEqual(["C", "E", "A"]);
  });

  it("composes: insert then rotate then extract without corrupting the doc", async () => {
    const fixture = await makeFixture(["A", "B"]);
    const doc = await loadPdf(fixture);
    await doc.pages.insert(1, {
      kind: "blank",
      size: { width: 200, height: 200 },
    }); // A, blank, B
    doc.pages.rotate(2, 90);
    expect(doc.pageCount()).toBe(3);

    const saved = await doc.save();
    const reloaded = await PDFDocument.load(saved);
    expect(reloaded.getPageCount()).toBe(3);
    expect(reloaded.getPage(1).getRotation().angle).toBe(90);

    const extractedBytes = await (await loadPdf(saved)).pages.extract([1, 3]);
    expect(await markerOrder(extractedBytes, 2)).toEqual(["A", "B"]);
  });

  it("rotate/delete/reorder/insert/extract throw on out-of-range indices", async () => {
    const fixture = await makeFixture(["A", "B"]);
    const doc = await loadPdf(fixture);
    expect(() => doc.pages.rotate(5, 90)).toThrow();
    expect(() => doc.pages.delete(0)).toThrow();
    expect(() => doc.pages.delete(3)).toThrow();
    expect(() => doc.pages.reorder(0, 5)).toThrow();
    expect(() => doc.pages.reorder(-1, 0)).toThrow();
    await expect(doc.pages.insert(10, { kind: "blank" })).rejects.toThrow();
    await expect(doc.pages.extract([9])).rejects.toThrow();
  });
});
