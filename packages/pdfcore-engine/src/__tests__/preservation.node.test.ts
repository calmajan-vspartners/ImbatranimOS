import { describe, it, expect, beforeAll } from "vitest";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { loadPdf } from "../index.node.js";

/**
 * Brief 66's highest-value ask: prove that a write does not damage what it was
 * not asked to touch.
 *
 * The existing `roundtrip.node.test.ts` proves the intended change lands. This
 * file proves the other half, which is the half that costs a user their file:
 * after annotating, signing, filling a form or reordering pages, is the *rest* of
 * the document still there? Metadata, pre-existing form fields, pre-existing
 * annotations, the other pages' text, the page count.
 *
 * That failure mode is not hypothetical in this repo. SuperDoc silently exported
 * the original bytes for a docx missing an optional part (brief 20), the ExcelJS
 * bridge corrupted shared formulas (2026-07-17 review), and it wrote a merged
 * range back as N copies of its value (brief 63). norPDF writes over the user's
 * original PDF, so it gets the same scrutiny before anyone trusts it.
 *
 * The fixture is deliberately rich: three pages with distinct text, full Info
 * metadata, and two filled AcroForm text fields. A write that quietly rebuilds
 * the document from scratch — the easy mistake — passes a page-count check and
 * fails almost everything here.
 */

const PAGE_TEXT = ["ALPHA_PAGE_ONE", "BRAVO_PAGE_TWO", "CHARLIE_PAGE_THREE"];

async function makeRichFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const text of PAGE_TEXT) {
    const page = doc.addPage([612, 792]);
    page.drawText(text, { x: 72, y: 700, size: 18, font, color: rgb(0, 0, 0) });
  }

  doc.setTitle("Preservation Fixture");
  doc.setAuthor("Brief 66");
  doc.setSubject("Write-path preservation");
  doc.setKeywords(["pdfcore", "preservation"]);
  doc.setCreator("ImbatranimOS tests");

  // Two AcroForm fields on page 1, with values, so a write can be shown not to
  // drop the form dictionary or reset what the user typed.
  const form = doc.getForm();
  const first = form.createTextField("applicant.name");
  first.setText("Ada Lovelace");
  first.addToPage(doc.getPage(0), { x: 72, y: 600, width: 200, height: 20 });
  const second = form.createTextField("applicant.city");
  second.setText("London");
  second.addToPage(doc.getPage(0), { x: 72, y: 560, width: 200, height: 20 });

  return doc.save();
}

/**
 * Text of every page, via the engine's own extractor, one entry per page.
 *
 * `extract` takes `{ pages }` — passing a bare number is silently accepted as an
 * options object with no `pages`, which extracts the WHOLE document. An earlier
 * draft of this file did exactly that, so every per-page assertion was reading
 * all three pages and passing for the wrong reason. Typecheck caught it.
 */
async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const doc = await loadPdf(bytes);
  const out: string[] = [];
  for (let p = 1; p <= doc.pageCount(); p++) {
    const items = await doc.text.extract({ pages: [p] });
    out.push(items.map((i) => i.str).join(" "));
  }
  return out;
}

describe("@pdfcore/engine — a write preserves what it did not touch", () => {
  let fixture: Uint8Array;
  beforeAll(async () => {
    fixture = await makeRichFixture();
  });

  it("the fixture itself is rich enough for these tests to mean anything", async () => {
    // A test suite whose fixture quietly lost its form fields would pass every
    // preservation assertion below while proving nothing.
    const doc = await loadPdf(fixture);
    expect(doc.pageCount()).toBe(3);
    expect(doc.metadata().title).toBe("Preservation Fixture");
    expect(
      doc.forms
        .list()
        .map((f) => f.name)
        .sort(),
    ).toEqual(["applicant.city", "applicant.name"]);
    const texts = await pageTexts(fixture);
    expect(texts[0]).toContain(PAGE_TEXT[0]);
    expect(texts[2]).toContain(PAGE_TEXT[2]);
  });

  describe("annotate", () => {
    it("adds the annotation and keeps metadata, fields, pages and text", async () => {
      const doc = await loadPdf(fixture);
      doc.annotate.add({
        type: "rect",
        page: 2,
        rect: [100, 100, 220, 160],
        color: { r: 1, g: 0, b: 0 },
        contents: "a note",
      });
      const saved = await doc.save();

      const after = await loadPdf(saved);
      expect(after.annotate.list(2).length).toBeGreaterThan(0);

      // …and everything it was not asked to touch:
      expect(after.pageCount()).toBe(3);
      expect(after.metadata().title).toBe("Preservation Fixture");
      expect(after.metadata().author).toBe("Brief 66");
      expect(after.forms.get("applicant.name")?.value).toBe("Ada Lovelace");
      expect(after.forms.get("applicant.city")?.value).toBe("London");
      const texts = await pageTexts(saved);
      expect(texts[0]).toContain(PAGE_TEXT[0]);
      expect(texts[1]).toContain(PAGE_TEXT[1]);
      expect(texts[2]).toContain(PAGE_TEXT[2]);
    });

    it("does not put the annotation on a page it was not asked about", async () => {
      const doc = await loadPdf(fixture);
      const before = doc.annotate.list(1).length;
      doc.annotate.add({
        type: "rect",
        page: 3,
        rect: [10, 10, 30, 30],
      });
      const after = await loadPdf(await doc.save());
      expect(after.annotate.list(1).length).toBe(before);
      expect(after.annotate.list(3).length).toBeGreaterThan(0);
    });

    it("a second save with no further edits does not double the annotations", async () => {
      // The model documents this as a genuine no-op; a commit that re-applies its
      // whole change set would duplicate every mark on every save.
      const doc = await loadPdf(fixture);
      doc.annotate.add({
        type: "rect",
        page: 1,
        rect: [10, 10, 30, 30],
      });
      await doc.save();
      const twice = await loadPdf(await doc.save());
      expect(twice.annotate.list(1).length).toBe(1);
    });
  });

  describe("forms", () => {
    it("sets one field without disturbing the other, or anything else", async () => {
      const doc = await loadPdf(fixture);
      doc.forms.set("applicant.city", "Edinburgh");
      const after = await loadPdf(await doc.save());

      expect(after.forms.get("applicant.city")?.value).toBe("Edinburgh");
      // The field the user did not edit keeps its value.
      expect(after.forms.get("applicant.name")?.value).toBe("Ada Lovelace");
      expect(after.forms.list()).toHaveLength(2);
      expect(after.pageCount()).toBe(3);
      expect(after.metadata().subject).toBe("Write-path preservation");
    });
  });

  describe("pages", () => {
    it("reorder moves the page and keeps every page's content", async () => {
      const doc = await loadPdf(fixture);
      doc.pages.reorder(0, 2);
      const saved = await doc.save();

      const texts = await pageTexts(saved);
      expect(texts).toHaveLength(3);
      // Page one moved to the end; nothing was dropped or blanked.
      expect(texts[2]).toContain(PAGE_TEXT[0]);
      expect(texts.join(" ")).toContain(PAGE_TEXT[1]);
      expect(texts.join(" ")).toContain(PAGE_TEXT[2]);

      const after = await loadPdf(saved);
      expect(after.metadata().title).toBe("Preservation Fixture");
    });

    it("delete removes exactly the page asked for and keeps the rest", async () => {
      const doc = await loadPdf(fixture);
      doc.pages.delete(2);
      const saved = await doc.save();

      const texts = await pageTexts(saved);
      expect(texts).toHaveLength(2);
      const all = texts.join(" ");
      expect(all).toContain(PAGE_TEXT[0]);
      expect(all).not.toContain(PAGE_TEXT[1]);
      expect(all).toContain(PAGE_TEXT[2]);
    });

    it("rotate changes the page box without losing its text", async () => {
      const doc = await loadPdf(fixture);
      doc.pages.rotate(1, 90);
      const saved = await doc.save();
      const texts = await pageTexts(saved);
      expect(texts[0]).toContain(PAGE_TEXT[0]);
      expect((await loadPdf(saved)).pageCount()).toBe(3);
    });

    it("extract returns only the pages asked for, as a valid document", async () => {
      const doc = await loadPdf(fixture);
      const extracted = await doc.pages.extract([1, 3]);
      const texts = await pageTexts(extracted);
      expect(texts).toHaveLength(2);
      expect(texts[0]).toContain(PAGE_TEXT[0]);
      expect(texts[1]).toContain(PAGE_TEXT[2]);
    });
  });

  describe("sign", () => {
    it("places a vector mark and keeps the form values and other pages", async () => {
      // Sign is built on Annotate + Forms, so it is the one capability that
      // touches two stores at once — the most likely place for one to clobber
      // the other.
      const doc = await loadPdf(fixture);
      doc.sign.place({
        page: 1,
        rect: [300, 100, 500, 160],
        mark: {
          kind: "vector",
          paths: [
            [
              { x: 300, y: 110 },
              { x: 360, y: 150 },
              { x: 420, y: 110 },
            ],
          ],
        },
      });
      const saved = await doc.save();

      const after = await loadPdf(saved);
      expect(after.annotate.list(1).length).toBeGreaterThan(0);
      expect(after.forms.get("applicant.name")?.value).toBe("Ada Lovelace");
      expect(after.forms.get("applicant.city")?.value).toBe("London");
      expect(after.pageCount()).toBe(3);
      const texts = await pageTexts(saved);
      expect(texts[1]).toContain(PAGE_TEXT[1]);
      expect(texts[2]).toContain(PAGE_TEXT[2]);
    });
  });

  describe("the save → reload contract", () => {
    it("a saved document reloads to a document that saves again cleanly", async () => {
      // The controller must call reloadDocument() after save because the read
      // caches (render/text/outline) are stale. This asserts the bytes themselves
      // survive a second generation, which is what makes that safe.
      const first = await loadPdf(fixture);
      first.annotate.add({
        type: "rect",
        page: 1,
        rect: [10, 10, 30, 30],
      });
      const gen1 = await first.save();
      const second = await loadPdf(gen1);
      const gen2 = await second.save();

      const after = await loadPdf(gen2);
      expect(after.pageCount()).toBe(3);
      expect(after.metadata().title).toBe("Preservation Fixture");
      expect(after.forms.list()).toHaveLength(2);
      expect(after.annotate.list(1).length).toBeGreaterThan(0);
      const texts = await pageTexts(gen2);
      expect(texts[1]).toContain(PAGE_TEXT[1]);
    });

    it("saving an untouched document does not damage it", async () => {
      // The cheapest way to lose a file: open it, change nothing, save.
      const doc = await loadPdf(fixture);
      const saved = await doc.save();
      const after = await loadPdf(saved);
      expect(after.pageCount()).toBe(3);
      expect(after.metadata().title).toBe("Preservation Fixture");
      expect(after.metadata().author).toBe("Brief 66");
      expect(after.forms.get("applicant.name")?.value).toBe("Ada Lovelace");
      expect(await pageTexts(saved)).toEqual(await pageTexts(fixture));
    });
  });
});
