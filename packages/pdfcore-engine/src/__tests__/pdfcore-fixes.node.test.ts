import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  PDFDocument,
  PDFName,
  PDFHexString,
  PDFString,
  PDFDict,
  PDFRef,
  StandardFonts,
  rgb,
} from "pdf-lib";
import {
  loadPdf,
  PdfEngineError,
  EncryptedDocument,
  SignatureInvalidationWarning,
} from "../index.node.js";
import type { PdfBytes } from "../api/types.js";

/**
 * Regression coverage for the 2026-08-06 audit fixes (T0-2 / T0-5 / T1-10 /
 * T1-11 / T1-12 and the Tier-4 batch). Each block maps to one finding.
 */

/** A doc whose N pages have distinct sizes and distinct drawn text. */
async function makeSizedPages(
  specs: { size: [number, number]; text: string }[],
): Promise<PdfBytes> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const { size, text } of specs) {
    const page = doc.addPage(size);
    page.drawText(text, { x: 20, y: 40, size: 12, font, color: rgb(0, 0, 0) });
  }
  return doc.save();
}

async function pageTexts(bytes: PdfBytes): Promise<string[]> {
  const doc = await loadPdf(bytes);
  const out: string[] = [];
  for (let p = 1; p <= doc.pageCount(); p++) {
    const items = await doc.text.extract({ pages: [p] });
    out.push(items.map((i) => i.str).join(" "));
  }
  return out;
}

describe("T0-2 — stale page cache after removePage corrupts documents", () => {
  it("delete keeps pageCount() and pageSizes() in agreement (in-memory)", async () => {
    const doc = await loadPdf(
      await makeSizedPages([
        { size: [300, 300], text: "P1" },
        { size: [400, 400], text: "P2" },
        { size: [500, 500], text: "P3" },
        { size: [600, 600], text: "P4" },
      ]),
    );
    doc.pages.delete(2); // remove the 400×400 page
    // Before the fix, removePage decremented the count but left the page cache
    // stale, so these two disagreed (3 vs 4).
    expect(doc.pageCount()).toBe(3);
    expect(doc.pageSizes()).toHaveLength(3);
    expect(doc.pageSizes().map((s) => s.width)).toEqual([300, 500, 600]);
  });

  it("interleaves delete + reorder + annotate + pageSizes on ONE doc", async () => {
    const doc = await loadPdf(
      await makeSizedPages([
        { size: [300, 300], text: "PAGE_ONE" },
        { size: [400, 400], text: "PAGE_TWO" },
        { size: [500, 500], text: "PAGE_THREE" },
        { size: [600, 600], text: "PAGE_FOUR" },
      ]),
    );

    doc.pages.delete(2); // → [ONE(300), THREE(500), FOUR(600)]
    expect(doc.pageSizes().map((s) => s.width)).toEqual([300, 500, 600]);

    doc.pages.reorder(0, 2); // move ONE to the end → [THREE, FOUR, ONE]
    expect(doc.pageSizes().map((s) => s.width)).toEqual([500, 600, 300]);

    // Annotate what is NOW page 1 (THREE): the cache must reflect the new order
    // so the mark attaches to the right page and not the resurrected/dropped one.
    doc.annotate.add({
      type: "rect",
      page: 1,
      rect: [50, 50, 120, 90],
      color: { r: 1, g: 0, b: 0 },
    });

    const saved = await doc.save();
    const texts = await pageTexts(saved);
    expect(texts).toHaveLength(3);
    expect(texts[0]).toContain("PAGE_THREE");
    expect(texts[1]).toContain("PAGE_FOUR");
    expect(texts[2]).toContain("PAGE_ONE");
    expect(texts.join(" ")).not.toContain("PAGE_TWO");

    const reopened = await loadPdf(saved);
    expect(reopened.pageCount()).toBe(3);
    // The annotation landed on page 1 (THREE) and nowhere else.
    expect(reopened.annotate.list(1).length).toBe(1);
    expect(reopened.annotate.list(2).length).toBe(0);
    expect(reopened.annotate.list(3).length).toBe(0);
  });
});

describe("T0-5 — annotation text must not corrupt the file", () => {
  it("round-trips /Contents containing ) and \\ and non-ASCII chars", async () => {
    const blank = await makeSizedPages([{ size: [400, 400], text: "x" }]);
    const doc = await loadPdf(blank);
    doc.annotate.add({
      type: "freeText",
      page: 1,
      rect: [20, 200, 380, 260],
      text: "smile :) done\\path",
    });
    doc.annotate.add({
      type: "freeText",
      page: 1,
      rect: [20, 100, 380, 160],
      text: "café ☺ résumé 日本語",
    });
    const saved = await doc.save();

    // The file must still parse (unbalanced/unescaped literals would break it).
    const reopened = await loadPdf(saved);
    const texts = reopened.annotate
      .list()
      .filter((a) => a.type === "freeText")
      .map((a) => (a as { text: string }).text)
      .sort();
    expect(texts).toEqual(
      ["café ☺ résumé 日本語", "smile :) done\\path"].sort(),
    );
  });
});

describe("T1-10 — editing a seeded annotation keeps its other keys", () => {
  it("preserves an unrecognized /NM key and drops the orphaned /Popup", async () => {
    // 1. Emit a real highlight with the engine.
    const seed = await loadPdf(
      await makeSizedPages([{ size: [400, 400], text: "x" }]),
    );
    seed.annotate.add({
      type: "highlight",
      page: 1,
      rect: [50, 300, 200, 315],
      contents: "original",
    });
    const emitted = await seed.save();

    // 2. Graft third-party keys onto it: a /NM the engine does not model, plus a
    //    /Popup that points back at the annotation.
    const lib = await PDFDocument.load(emitted);
    const annots = lib.getPage(0).node.Annots()!;
    const annotDict = lib.context.lookup(annots.get(0) as PDFRef, PDFDict);
    annotDict.set(PDFName.of("NM"), PDFHexString.fromText("third-party-id"));
    const popupRef = lib.context.register(
      lib.context.obj({
        Type: "Annot",
        Subtype: "Popup",
        Rect: [0, 0, 10, 10],
      }),
    );
    annotDict.set(PDFName.of("Popup"), popupRef);
    const withExtras = await lib.save();

    // 3. Load via the engine, edit the annotation, save.
    const doc = await loadPdf(withExtras);
    const id = doc.annotate.list()[0]!.id;
    doc.annotate.update(id, { contents: "edited" });
    const saved = await doc.save();

    // 4. The /NM must have survived onto the re-emitted object; the orphaned
    //    /Popup must be gone.
    const check = await PDFDocument.load(saved);
    const checkAnnots = check.getPage(0).node.Annots()!;
    let found: PDFDict | undefined;
    for (let i = 0; i < checkAnnots.size(); i++) {
      const d = check.context.lookup(checkAnnots.get(i) as PDFRef, PDFDict);
      if (
        d.lookupMaybe(PDFName.of("Subtype"), PDFName)?.decodeText() ===
        "Highlight"
      ) {
        found = d;
        break;
      }
    }
    expect(found).toBeDefined();
    const nm = found!.get(PDFName.of("NM"));
    expect(nm instanceof PDFHexString ? nm.decodeText() : undefined).toBe(
      "third-party-id",
    );
    expect(found!.get(PDFName.of("Popup"))).toBeUndefined();
  });
});

describe("T1-11 — load does not rewrite metadata; signatures are surfaced", () => {
  it("warns (does not throw) when the document carries a /ByteRange signature", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const sigRef = doc.context.register(
      doc.context.obj({
        Type: "Sig",
        Filter: "Adobe.PPKLite",
        ByteRange: [0, 1, 2, 3],
        Contents: PDFHexString.of("00"),
      }),
    );
    doc.catalog.set(PDFName.of("Perms"), doc.context.obj({ DocMDP: sigRef }));
    const bytes = await doc.save();

    const loaded = await loadPdf(bytes);
    expect(
      loaded.warnings().some((w) => w instanceof SignatureInvalidationWarning),
    ).toBe(true);
    // A clean document has no such warning.
    const clean = await loadPdf(
      await makeSizedPages([{ size: [100, 100], text: "x" }]),
    );
    expect(clean.warnings()).toHaveLength(0);
  });
});

describe("encrypted view refusal is a typed engine error", () => {
  it("maps pdf-lib's EncryptedPDFError to EncryptedDocument", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    const encRef = doc.context.register(
      doc.context.obj({
        Filter: "Standard",
        V: 1,
        R: 2,
        O: PDFString.of("O".repeat(32)),
        U: PDFString.of("U".repeat(32)),
        P: -44,
      }),
    );
    doc.context.trailerInfo.Encrypt = encRef;
    const bytes = await doc.save({ useObjectStreams: false });

    await expect(loadPdf(bytes)).rejects.toBeInstanceOf(EncryptedDocument);
  });
});

describe("T1-12 — package exports route Node vs browser", () => {
  it("declares node/browser conditions and ./node ./browser subpaths", () => {
    const url = new URL("../../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(url, "utf8"));
    const dot = pkg.exports["."];
    expect(dot.node.default).toBe("./src/index.node.ts");
    expect(dot.browser.default).toBe("./src/index.browser.ts");
    // The bare "." default must still be the browser entry (the Vite app).
    expect(dot.default.default).toBe("./src/index.browser.ts");
    expect(pkg.exports["./node"].default).toBe("./src/index.node.ts");
    expect(pkg.exports["./browser"].default).toBe("./src/index.browser.ts");
  });
});

describe("forms — reads never mutate; save never re-encodes every field", () => {
  it("list()/get() on a formless PDF return empty and do not create /AcroForm", async () => {
    const blank = await makeSizedPages([{ size: [200, 200], text: "x" }]);
    const doc = await loadPdf(blank);
    expect(doc.forms.list()).toEqual([]);
    expect(doc.forms.get("anything")).toBeUndefined();

    // Saving after merely reading the (empty) form must not synthesise one.
    const saved = await doc.save();
    const lib = await PDFDocument.load(saved);
    expect(lib.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict)).toBe(
      undefined,
    );
  });

  it("a value the default font cannot encode fails with a typed engine error", async () => {
    const base = await PDFDocument.create();
    const page = base.addPage([300, 200]);
    const form = base.getForm();
    const field = form.createTextField("greeting");
    field.addToPage(page, { x: 20, y: 100, width: 200, height: 20 });
    const bytes = await base.save();

    const doc = await loadPdf(bytes);
    doc.forms.set("greeting", "日本語のテキスト");
    await expect(doc.save()).rejects.toBeInstanceOf(PdfEngineError);
  });
});

describe("T2-10 — pdf.js read caches are disposable", () => {
  it("dispose() is idempotent and the doc re-parses on next use", async () => {
    const bytes = await makeSizedPages([{ size: [200, 200], text: "HELLO" }]);
    const doc = await loadPdf(bytes);
    const before = await doc.text.plain();
    expect(before).toContain("HELLO");
    // Two disposes in a row must not throw (idempotent), and a read afterward
    // must still work (the adapter re-parses lazily from the current bytes).
    doc.dispose();
    doc.dispose();
    const after = await doc.text.plain();
    expect(after).toContain("HELLO");
  });

  it("save() disposes the stale read caches without breaking later reads", async () => {
    const bytes = await makeSizedPages([{ size: [200, 200], text: "WORLD" }]);
    const doc = await loadPdf(bytes);
    await doc.text.plain();
    await doc.save();
    const after = await doc.text.plain();
    expect(after).toContain("WORLD");
  });
});
