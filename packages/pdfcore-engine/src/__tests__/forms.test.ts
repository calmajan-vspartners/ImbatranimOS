import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { loadPdf } from "../index.node.js";
import { PdfLibDocument } from "../adapters/pdf-lib/document.js";
import { PdfLibForms } from "../adapters/pdf-lib/forms.js";
import { FormModel } from "../model/forms.js";
import { readFormGeometry } from "../adapters/pdfjs/form-geometry.js";
import { PdfEngineError } from "../api/errors.js";

/**
 * Build an AcroForm fixture programmatically with pdf-lib — one widget per
 * field type, at known rectangles on a single page, so type/geometry/value/
 * options/flags can all be asserted.
 */
async function makeFormFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();

  const fullName = form.createTextField("fullName");
  fullName.setText("Ada");
  fullName.enableRequired();
  fullName.addToPage(page, { x: 50, y: 700, width: 200, height: 20 });

  const locked = form.createTextField("locked");
  locked.setText("LOCKED");
  locked.enableReadOnly();
  locked.addToPage(page, { x: 50, y: 660, width: 200, height: 20 });

  const subscribe = form.createCheckBox("subscribe");
  subscribe.addToPage(page, { x: 50, y: 630, width: 15, height: 15 });

  const plan = form.createRadioGroup("plan");
  plan.addOptionToPage("free", page, { x: 50, y: 600, width: 15, height: 15 });
  plan.addOptionToPage("pro", page, { x: 120, y: 600, width: 15, height: 15 });
  plan.select("free");

  const country = form.createDropdown("country");
  country.addOptions(["US", "UK", "RO"]);
  country.select("US");
  country.addToPage(page, { x: 50, y: 560, width: 100, height: 20 });

  const langs = form.createOptionList("langs");
  langs.addOptions(["en", "fr", "de", "ro"]);
  langs.enableMultiselect();
  langs.select(["en"]);
  langs.addToPage(page, { x: 50, y: 480, width: 100, height: 60 });

  return doc.save();
}

/** Reload saved bytes through pdf-lib and return its form. */
async function reloadForm(bytes: Uint8Array) {
  return (await PDFDocument.load(bytes)).getForm();
}

/**
 * Assert a rect is within `tol` points of the expected placement, per corner.
 * pdf-lib stores the widget `/Rect` expanded by ~0.5pt for the default border
 * (pdf.js reads back the same expanded rect), so we compare with a tolerance.
 */
function expectRectNear(
  actual: readonly number[] | undefined,
  expected: readonly [number, number, number, number],
  tol = 1,
): void {
  expect(actual).toBeDefined();
  expect(actual).toHaveLength(4);
  for (let i = 0; i < 4; i++) {
    expect(
      Math.abs((actual as number[])[i]! - expected[i]!),
    ).toBeLessThanOrEqual(tol);
  }
}

describe("Forms capability (pdf-lib adapter + pdf.js geometry)", () => {
  it("lists fields with correct types, values, options and flags", async () => {
    const doc = await loadPdf(await makeFormFixture());
    const byName = new Map(doc.forms.list().map((f) => [f.name, f]));

    expect([...byName.keys()].sort()).toEqual(
      ["country", "fullName", "langs", "locked", "plan", "subscribe"].sort(),
    );

    expect(byName.get("fullName")).toMatchObject({
      type: "text",
      value: "Ada",
      required: true,
      readonly: false,
    });
    expect(byName.get("locked")).toMatchObject({
      type: "text",
      value: "LOCKED",
      readonly: true,
    });
    expect(byName.get("subscribe")).toMatchObject({
      type: "checkbox",
      value: false,
    });
    expect(byName.get("plan")).toMatchObject({
      type: "radio",
      value: "free",
      options: ["free", "pro"],
    });
    expect(byName.get("country")).toMatchObject({
      type: "dropdown",
      value: "US",
      options: ["US", "UK", "RO"],
    });
    expect(byName.get("langs")).toMatchObject({
      type: "listbox",
      value: ["en"],
      options: ["en", "fr", "de", "ro"],
    });
  });

  it("reports widget geometry (pdf-lib) as the /Rect in PDF user space", async () => {
    const doc = await loadPdf(await makeFormFixture());
    const name = doc.forms.get("fullName");
    expect(name?.page).toBe(1);
    expectRectNear(name?.rect, [50, 700, 250, 720]);
  });

  it("get() returns undefined for an unknown field", async () => {
    const doc = await loadPdf(await makeFormFixture());
    expect(doc.forms.get("nope")).toBeUndefined();
  });

  it("pdf.js geometry reader returns widget rects per field (radio has one per option)", async () => {
    const geom = await readFormGeometry(await makeFormFixture());
    const name = geom.get("fullName");
    expect(name).toHaveLength(1);
    expect(name?.[0]?.page).toBe(1);
    expectRectNear(name?.[0]?.rect, [50, 700, 250, 720]);
    // Radio group: one widget per option, in placement order.
    const plan = geom.get("plan");
    expect(plan).toHaveLength(2);
    expectRectNear(plan?.[0]?.rect, [50, 600, 65, 615]);
    expectRectNear(plan?.[1]?.rect, [120, 600, 135, 615]);
  });

  it("primeGeometry() merges pdf.js rects into list() (matches the reader)", async () => {
    const fixture = await makeFormFixture();
    const pdoc = await PdfLibDocument.load(fixture);
    const forms = new PdfLibForms(pdoc, new FormModel());
    await forms.primeGeometry();

    const fromReader = await readFormGeometry(fixture);
    const name = forms.get("fullName");
    expect(name?.rect).toEqual(fromReader.get("fullName")?.[0]?.rect);
    expect(name?.page).toBe(fromReader.get("fullName")?.[0]?.page);
  });

  it("set() values of every type survive save → reload", async () => {
    const doc = await loadPdf(await makeFormFixture());
    doc.forms.set("fullName", "Grace Hopper");
    doc.forms.set("subscribe", true);
    doc.forms.set("plan", "pro");
    doc.forms.set("country", "RO");
    doc.forms.set("langs", ["fr", "de"]);

    // Staged values are visible immediately via get() (before save).
    expect(doc.forms.get("plan")?.value).toBe("pro");

    const saved = await doc.save();
    const reloaded = await loadPdf(saved);
    const byName = new Map(reloaded.forms.list().map((f) => [f.name, f]));

    expect(byName.get("fullName")?.value).toBe("Grace Hopper");
    expect(byName.get("subscribe")?.value).toBe(true);
    expect(byName.get("plan")?.value).toBe("pro");
    expect(byName.get("country")?.value).toBe("RO");
    expect(byName.get("langs")?.value).toEqual(["fr", "de"]);
  });

  it("set() rejects unknown names, invalid options, and signature fields", async () => {
    const doc = await loadPdf(await makeFormFixture());
    expect(() => doc.forms.set("nope", "x")).toThrow(PdfEngineError);
    expect(() => doc.forms.set("plan", "enterprise")).toThrow(
      /not a valid option/,
    );
    expect(() => doc.forms.set("country", "FR")).toThrow(/not a valid option/);
    expect(() => doc.forms.set("langs", ["en", "xx"])).toThrow(
      /not a valid option/,
    );
    // Type mismatches.
    expect(() =>
      doc.forms.set("subscribe", "yes" as unknown as boolean),
    ).toThrow(/expects a boolean/);
    expect(() => doc.forms.set("fullName", true as unknown as string)).toThrow(
      /expects a string/,
    );
  });

  it("flatten() bakes values and removes all interactive fields on reload", async () => {
    const doc = await loadPdf(await makeFormFixture());
    doc.forms.set("fullName", "Baked Value");
    doc.forms.flatten();
    const saved = await doc.save();

    const form = await reloadForm(saved);
    expect(form.getFields()).toHaveLength(0);

    // The baked text is drawn into page content (extractable via pdf.js).
    const text = await (await loadPdf(saved)).text.plain();
    expect(text).toContain("Baked Value");
  });

  it("flatten(subset) removes only the named fields; the rest stay interactive", async () => {
    const doc = await loadPdf(await makeFormFixture());
    doc.forms.set("fullName", "Only Me");
    doc.forms.flatten(["fullName"]);
    const saved = await doc.save();

    const form = await reloadForm(saved);
    const names = form.getFields().map((f) => f.getName());
    expect(names).not.toContain("fullName");
    expect(names).toContain("subscribe");
    expect(names).toContain("plan");
    expect(names.sort()).toEqual(
      ["country", "langs", "locked", "plan", "subscribe"].sort(),
    );

    const text = await (await loadPdf(saved)).text.plain();
    expect(text).toContain("Only Me");
  });
});
