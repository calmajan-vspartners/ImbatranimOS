import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { loadPdf } from "../index.node.js";

/**
 * Fixture: a 2-page document.
 *  - page 1: "Hello World" and, lower on the page, a decoy "HelloThere" (to
 *    exercise wholeWord), plus an accented "café" (to exercise
 *    ignoreDiacritics). Also a second, standalone "Hello" occurrence.
 *  - page 2: a word split across two drawText calls with NO gap between them
 *    ("Data" in Helvetica immediately followed by "Base" in Helvetica-Bold) —
 *    the font change forces pdf.js to keep them as two adjacent text items
 *    (touching runs of the SAME font get coalesced into one item, which
 *    defeats the point of this fixture); this is the "match spans multiple
 *    items" case brief 16 calls out.
 */
async function makeFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const size = 18;

  const page1 = doc.addPage([612, 792]);
  page1.drawText("Hello World", {
    x: 72,
    y: 700,
    size,
    font,
    color: rgb(0, 0, 0),
  });
  page1.drawText("HelloThere", {
    x: 72,
    y: 650,
    size,
    font,
    color: rgb(0, 0, 0),
  });
  page1.drawText("Hello", { x: 72, y: 600, size, font, color: rgb(0, 0, 0) });
  page1.drawText("café", { x: 72, y: 550, size, font, color: rgb(0, 0, 0) });

  const page2 = doc.addPage([612, 792]);
  const firstWidth = font.widthOfTextAtSize("Data", size);
  page2.drawText("Data", { x: 72, y: 700, size, font, color: rgb(0, 0, 0) });
  page2.drawText("Base", {
    x: 72 + firstWidth,
    y: 700,
    size,
    font: boldFont,
    color: rgb(0, 0, 0),
  });

  return doc.save();
}

describe("Text.search (pdf.js adapter)", () => {
  it("finds a simple occurrence with a rect anchored at the item's origin", async () => {
    const doc = await loadPdf(await makeFixture());
    const items = await doc.text.extract({ pages: [1] });
    const helloWorld = items.find((i) => i.str === "Hello World");
    expect(helloWorld).toBeDefined();

    const hits = await doc.text.search("Hello World");
    const onPage1 = hits.filter((h) => h.page === 1);
    expect(onPage1.length).toBeGreaterThanOrEqual(1);
    const hit = onPage1[0]!;
    expect(hit.rects).toHaveLength(1);
    const [x1, y1, x2, y2] = hit.rects[0]!;
    expect(x1).toBeCloseTo(helloWorld!.x, 1);
    expect(x2).toBeCloseTo(helloWorld!.x + helloWorld!.w, 1);
    expect(y1).toBeCloseTo(helloWorld!.y, 1);
    expect(y2).toBeCloseTo(helloWorld!.y + helloWorld!.h, 1);
    expect(hit.context).toContain("Hello World");
  });

  it("prorates a sub-item match's rect to the matched characters only", async () => {
    const doc = await loadPdf(await makeFixture());
    const items = await doc.text.extract({ pages: [1] });
    const helloWorld = items.find((i) => i.str === "Hello World")!;

    const hits = await doc.text.search("World");
    const hit = hits.find((h) => h.page === 1)!;
    expect(hit.rects).toHaveLength(1);
    const [x1, , x2] = hit.rects[0]!;

    const fullLen = "Hello World".length;
    const startChar = "Hello World".indexOf("World");
    const expectedLeft = helloWorld.x + (startChar / fullLen) * helloWorld.w;
    const expectedRight = helloWorld.x + helloWorld.w; // "World" runs to the end

    expect(x1).toBeCloseTo(expectedLeft, 1);
    expect(x2).toBeCloseTo(expectedRight, 1);
    // Left edge of the "World" match must be strictly right of the full
    // item's left edge — proof this isn't just returning the whole item box.
    expect(x1).toBeGreaterThan(helloWorld.x + 1);
  });

  it("case-insensitive by default; caseSensitive option excludes a differently-cased match", async () => {
    const doc = await loadPdf(await makeFixture());
    const insensitive = await doc.text.search("hello world");
    expect(insensitive.some((h) => h.page === 1)).toBe(true);

    const sensitive = await doc.text.search("hello world", {
      caseSensitive: true,
    });
    expect(sensitive.some((h) => h.page === 1)).toBe(false);

    const sensitiveMatch = await doc.text.search("Hello World", {
      caseSensitive: true,
    });
    expect(sensitiveMatch.some((h) => h.page === 1)).toBe(true);
  });

  it("wholeWord excludes a substring match inside a longer word", async () => {
    const doc = await loadPdf(await makeFixture());
    const anySubstring = await doc.text.search("Hello");
    // "Hello World", "HelloThere", and standalone "Hello" all contain "Hello".
    expect(
      anySubstring.filter((h) => h.page === 1).length,
    ).toBeGreaterThanOrEqual(3);

    const wholeWordOnly = await doc.text.search("Hello", { wholeWord: true });
    const page1Hits = wholeWordOnly.filter((h) => h.page === 1);
    // Only "Hello World" (standalone word) and the standalone "Hello" qualify;
    // "HelloThere" must NOT match as a whole word.
    expect(page1Hits.length).toBe(2);
  });

  it("ignoreDiacritics folds accents so 'cafe' matches 'café'", async () => {
    const doc = await loadPdf(await makeFixture());
    const withoutOption = await doc.text.search("cafe");
    expect(withoutOption.some((h) => h.page === 1)).toBe(false);

    const withOption = await doc.text.search("cafe", {
      ignoreDiacritics: true,
    });
    expect(withOption.some((h) => h.page === 1)).toBe(true);
  });

  it("finds a match spanning two adjacent text items with one unioned rect", async () => {
    const doc = await loadPdf(await makeFixture());
    const items = await doc.text.extract({ pages: [2] });
    // Confirm the fixture actually produced two separate items (the case this
    // test exists to cover) rather than pdf.js merging them into one.
    expect(items.length).toBe(2);
    const [first, second] = items;

    const hits = await doc.text.search("DataBase");
    const hit = hits.find((h) => h.page === 2);
    expect(hit).toBeDefined();
    expect(hit!.rects).toHaveLength(1);
    const [x1, , x2] = hit!.rects[0]!;
    expect(x1).toBeCloseTo(first!.x, 1);
    expect(x2).toBeCloseTo(second!.x + second!.w, 1);
  });

  it("restricts search to the requested pages", async () => {
    const doc = await loadPdf(await makeFixture());
    const onlyPage2 = await doc.text.search("Hello", { pages: [2] });
    expect(onlyPage2).toHaveLength(0);

    const onlyPage1 = await doc.text.search("Data", { pages: [1] });
    expect(onlyPage1).toHaveLength(0);
  });

  it("returns hits ordered by page then reading order", async () => {
    const doc = await loadPdf(await makeFixture());
    const hits = await doc.text.search("Hello");
    const pages = hits.map((h) => h.page);
    expect(pages).toEqual([...pages].sort((a, b) => a - b));
  });

  it("returns no hits for an empty query", async () => {
    const doc = await loadPdf(await makeFixture());
    expect(await doc.text.search("")).toEqual([]);
  });
});
