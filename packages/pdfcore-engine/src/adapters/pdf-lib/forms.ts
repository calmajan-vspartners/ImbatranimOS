import {
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFOptionList,
  PDFSignature,
  PDFOperator,
  PDFOperatorNames,
  PDFName,
  PDFNumber,
  PDFDict,
  PDFRef,
} from "pdf-lib";
import type {
  PDFDocument,
  PDFForm,
  PDFField,
  PDFWidgetAnnotation,
  PDFPage,
} from "pdf-lib";
import type {
  Forms,
  FieldInfo,
  FieldType,
  FieldValue,
} from "../../capabilities/Forms.js";
import { PdfEngineError } from "../../api/errors.js";
import type { Rect } from "../../api/types.js";
import type { FormModel } from "../../model/forms.js";
import type { PdfLibDocument } from "./document.js";
import {
  readFormGeometry,
  type WidgetGeometry,
} from "../pdfjs/form-geometry.js";

/**
 * `pdf-lib`-backed Forms adapter — enumerate AcroForm fields, read/set values,
 * and flatten. Writes go through the shared {@link FormModel} (staged intent),
 * which {@link commit} applies to the pdf-lib document at `save()` time, so
 * save→reload reflects the edits (DEC-39).
 *
 * ── Geometry ────────────────────────────────────────────────────────────────
 * `list()`/`get()` are synchronous (the {@link Forms} contract), so widget
 * geometry defaults to pdf-lib's own widget rectangles, which are coordinate-
 * identical to pdf.js (both read the widget `/Rect` in PDF user space). A
 * browser consumer that positions overlays against the pdf.js Render viewport
 * can call {@link primeGeometry} first (async); after that, `list()`/`get()`
 * merge in the pdf.js-sourced rects. See the handoff note in brief 13.
 *
 * Multi-widget fields (a radio group has one widget per option): `FieldInfo`
 * reports the FIRST widget's page + rect. Consumers needing every option box
 * read them from the pdf.js reader ({@link readFormGeometry}) directly.
 */
export class PdfLibForms implements Forms {
  /** pdf.js-sourced widget geometry, populated by {@link primeGeometry}. */
  #geometry: Map<string, WidgetGeometry[]> | undefined;

  private readonly doc: PdfLibDocument;
  private readonly model: FormModel;

  constructor(doc: PdfLibDocument, model: FormModel) {
    this.doc = doc;
    this.model = model;
  }

  list(): FieldInfo[] {
    const form = this.#readForm();
    if (!form) return [];
    return form.getFields().map((field) => this.#toFieldInfo(field));
  }

  get(name: string): FieldInfo | undefined {
    const field = this.#readForm()?.getFieldMaybe(name);
    return field ? this.#toFieldInfo(field) : undefined;
  }

  set(name: string, value: FieldValue): void {
    const field = this.#readForm()?.getFieldMaybe(name);
    if (!field) {
      throw new PdfEngineError(`Forms.set: unknown field "${name}".`);
    }
    const type = classify(field);
    this.#validate(name, type, value, field);
    // Stage the edit; commit() applies it to the pdf-lib document at save().
    this.model.set(name, value);
  }

  flatten(names?: string[]): void {
    this.model.queueFlatten(names);
  }

  /**
   * Load pdf.js widget geometry into the adapter so subsequent `list()`/`get()`
   * calls report pdf.js-sourced rectangles (aligned with the Render viewport).
   * Optional: without it, geometry comes from pdf-lib (coordinate-identical).
   * Serialises the working pdf-lib document to obtain current bytes, so it
   * reflects any structural edits made so far.
   */
  async primeGeometry(): Promise<void> {
    const bytes = await this.doc.pdfLibDocument.save();
    this.#geometry = await readFormGeometry(bytes);
  }

  /**
   * Apply the staged model edits (field values + queued flattens) to the
   * pdf-lib document before it is serialised. Called by {@link PdfDoc.save};
   * only runs when the Forms accessor was touched, so an empty model is a
   * genuine no-op.
   */
  async commit(): Promise<void> {
    // Nothing staged ⇒ genuine no-op. Crucially, do NOT call getForm() here: on
    // a formless PDF it would create an empty /AcroForm and mutate a document
    // the caller only read from.
    if (!this.model.hasWork()) return;
    const form = this.#form();

    // 1. Apply staged values. Fields validated at set() time; skip any that
    //    vanished (e.g. removed by a prior flatten commit).
    const staged: PDFField[] = [];
    for (const [name, value] of this.model.entries()) {
      const field = form.getFieldMaybe(name);
      if (field) {
        applyValue(field, value);
        staged.push(field);
      }
    }

    // 2. Regenerate appearance streams ONLY for the fields we actually staged,
    //    so the new values are visible on reload/print. pdf-lib's own
    //    form.updateFieldAppearances() (and the default save() path) regenerate
    //    EVERY field and throw on the first non-WinAnsi value, failing the
    //    whole save; save() is called with { updateFieldAppearances: false } to
    //    suppress that second pass (see PdfLibDocument.save()).
    const font = form.getDefaultFont();
    for (const field of staged) {
      try {
        field.defaultUpdateAppearances(font);
      } catch (err) {
        throw new PdfEngineError(
          `Forms.commit: could not render appearance for field "${field.getName()}" with the default font (value may contain characters outside WinAnsi) — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 3. Flatten. flatten() (all) is pdf-lib native; a named subset is baked
    //    field-by-field so the rest stay interactive.
    if (this.model.flattenAll) {
      form.flatten();
    } else {
      const subset = form
        .getFields()
        .filter((f) => this.model.shouldFlatten(f.getName()));
      if (subset.length > 0) this.#flattenSubset(form, subset);
    }
  }

  /* ─────────────────────────────── internals ──────────────────────────── */

  /** Creating form handle for the write/commit path. */
  #form(): PDFForm {
    return this.doc.pdfLibDocument.getForm();
  }

  /**
   * Non-creating form handle for reads. Returns `undefined` when the document
   * has no `/AcroForm`, so `list()`/`get()` never synthesise one (getForm()
   * calls getOrCreateAcroForm(), which mutates a formless document).
   */
  #readForm(): PDFForm | undefined {
    const doc = this.doc.pdfLibDocument;
    if (!doc.catalog.AcroForm()) return undefined;
    return doc.getForm();
  }

  #toFieldInfo(field: PDFField): FieldInfo {
    const name = field.getName();
    const type = classify(field);
    const geom = this.#geometryFor(name, field);
    const info: FieldInfo = {
      name,
      type,
      page: geom.page,
      rect: geom.rect,
      value: this.#currentValue(name, field, type),
      readonly: field.isReadOnly(),
      required: field.isRequired(),
    };
    const options = optionsFor(field, type);
    if (options) info.options = options;
    return info;
  }

  /** Current value: a staged (pending) edit wins over the on-disk value. */
  #currentValue(name: string, field: PDFField, type: FieldType): FieldValue {
    const pending = this.model.pending(name);
    if (pending !== undefined) return pending;
    return readValue(field, type);
  }

  /** First widget's geometry: pdf.js when primed, else pdf-lib (identical coords). */
  #geometryFor(name: string, field: PDFField): WidgetGeometry {
    const cached = this.#geometry?.get(name)?.[0];
    if (cached) return cached;
    return widgetGeometryFromPdfLib(this.doc.pdfLibDocument, field);
  }

  #validate(
    name: string,
    type: FieldType,
    value: FieldValue,
    field: PDFField,
  ): void {
    switch (type) {
      case "text": {
        if (typeof value !== "string") {
          throw new PdfEngineError(
            `Forms.set: text field "${name}" expects a string.`,
          );
        }
        return;
      }
      case "checkbox": {
        if (typeof value !== "boolean") {
          throw new PdfEngineError(
            `Forms.set: checkbox "${name}" expects a boolean.`,
          );
        }
        return;
      }
      case "radio": {
        if (typeof value !== "string") {
          throw new PdfEngineError(
            `Forms.set: radio group "${name}" expects a string option (or "" to clear).`,
          );
        }
        if (value !== "") {
          assertOption(name, value, (field as PDFRadioGroup).getOptions());
        }
        return;
      }
      case "dropdown": {
        if (typeof value !== "string") {
          throw new PdfEngineError(
            `Forms.set: dropdown "${name}" expects a string option (or "" to clear).`,
          );
        }
        const dropdown = field as PDFDropdown;
        // Editable (combo) dropdowns accept free text; otherwise enforce options.
        if (value !== "" && !dropdown.isEditable()) {
          assertOption(name, value, dropdown.getOptions());
        }
        return;
      }
      case "listbox": {
        if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
          throw new PdfEngineError(
            `Forms.set: listbox "${name}" expects an array of string options.`,
          );
        }
        const options = (field as PDFOptionList).getOptions();
        for (const v of value) assertOption(name, v, options);
        return;
      }
      case "signature": {
        throw new PdfEngineError(
          `Forms.set: cannot set a value on signature field "${name}" (use Sign — brief 15).`,
        );
      }
    }
  }

  /**
   * Flatten a named subset: bake each widget's appearance onto its page, then
   * remove the field. Mirrors pdf-lib's own `flatten()` loop but scoped to the
   * subset (pdf-lib's public `flatten()` is all-or-nothing). Assumes unrotated
   * widgets (the common case); page rotation is handled by pdf.js on render.
   */
  #flattenSubset(form: PDFForm, fields: PDFField[]): void {
    const doc = this.doc.pdfLibDocument;
    for (const field of fields) {
      for (const widget of field.acroField.getWidgets()) {
        const page = widgetPage(doc, widget);
        const ref = widgetAppearanceRef(field, widget);
        if (!page || !ref) continue;
        const xObjectKey = page.node.newXObject("FlatWidget", ref);
        const { x, y } = widget.getRectangle();
        page.pushOperators(
          PDFOperator.of(PDFOperatorNames.PushGraphicsState),
          PDFOperator.of(PDFOperatorNames.ConcatTransformationMatrix, [
            PDFNumber.of(1),
            PDFNumber.of(0),
            PDFNumber.of(0),
            PDFNumber.of(1),
            PDFNumber.of(x),
            PDFNumber.of(y),
          ]),
          PDFOperator.of(PDFOperatorNames.DrawObject, [xObjectKey]),
          PDFOperator.of(PDFOperatorNames.PopGraphicsState),
        );
      }
      form.removeField(field);
    }
  }
}

/* ────────────────────────────── module helpers ────────────────────────── */

/** Map a pdf-lib field instance to our {@link FieldType}. */
function classify(field: PDFField): FieldType {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFDropdown) return "dropdown";
  if (field instanceof PDFOptionList) return "listbox";
  if (field instanceof PDFSignature) return "signature";
  throw new PdfEngineError(
    `Forms: unsupported field type for "${field.getName()}".`,
  );
}

/** Read the on-disk value of a field, typed by {@link FieldType}. */
function readValue(field: PDFField, type: FieldType): FieldValue {
  switch (type) {
    case "text":
      return (field as PDFTextField).getText() ?? "";
    case "checkbox":
      return (field as PDFCheckBox).isChecked();
    case "radio":
      return (field as PDFRadioGroup).getSelected() ?? "";
    case "dropdown":
      return (field as PDFDropdown).getSelected()[0] ?? "";
    case "listbox":
      return [...(field as PDFOptionList).getSelected()];
    case "signature":
      return "";
  }
}

/** Allowed options for choice fields; `undefined` for the rest. */
function optionsFor(field: PDFField, type: FieldType): string[] | undefined {
  switch (type) {
    case "radio":
      return (field as PDFRadioGroup).getOptions();
    case "dropdown":
      return (field as PDFDropdown).getOptions();
    case "listbox":
      return (field as PDFOptionList).getOptions();
    default:
      return undefined;
  }
}

/** Write a staged value onto a pdf-lib field, honouring per-type clear semantics. */
function applyValue(field: PDFField, value: FieldValue): void {
  if (field instanceof PDFTextField) {
    field.setText(typeof value === "string" ? value : String(value));
  } else if (field instanceof PDFCheckBox) {
    if (value === true) field.check();
    else field.uncheck();
  } else if (field instanceof PDFRadioGroup) {
    if (value === "" || value === undefined) field.clear();
    else field.select(String(value));
  } else if (field instanceof PDFDropdown) {
    if (value === "") field.clear();
    else field.select(String(value));
  } else if (field instanceof PDFOptionList) {
    const values = Array.isArray(value) ? value : [String(value)];
    if (values.length === 0) field.clear();
    else field.select(values);
  }
}

/** Throw a clear error when `value` is not among a choice field's options. */
function assertOption(name: string, value: string, options: string[]): void {
  if (!options.includes(value)) {
    throw new PdfEngineError(
      `Forms.set: "${value}" is not a valid option for "${name}" (options: ${options
        .map((o) => `"${o}"`)
        .join(", ")}).`,
    );
  }
}

/** First-widget geometry from pdf-lib: `/Rect` → {@link Rect} + 1-based page. */
function widgetGeometryFromPdfLib(
  doc: PDFDocument,
  field: PDFField,
): WidgetGeometry {
  const widget = field.acroField.getWidgets()[0];
  if (!widget) return { page: 1, rect: [0, 0, 0, 0] };
  const { x, y, width, height } = widget.getRectangle();
  const rect: Rect = [x, y, x + width, y + height];
  const page = widgetPage(doc, widget);
  const index = page ? doc.getPages().indexOf(page) : -1;
  return { page: index >= 0 ? index + 1 : 1, rect };
}

/** Locate the page a widget lives on (via `/P`, else the page `/Annots` list). */
function widgetPage(
  doc: PDFDocument,
  widget: PDFWidgetAnnotation,
): PDFPage | undefined {
  const pages = doc.getPages();
  const pageRef = widget.P();
  if (pageRef) {
    const byRef = pages.find((p) => p.ref === pageRef);
    if (byRef) return byRef;
  }
  const widgetRef = doc.context.getObjectRef(widget.dict);
  if (widgetRef) {
    const found = doc.findPageForAnnotationRef(widgetRef);
    if (found) return found;
  }
  return pages[0];
}

/**
 * The normal-appearance stream ref for a widget. For checkbox/radio widgets the
 * appearance is a dict keyed by on-state; pick the entry matching the field's
 * current value (else the `Off` state). Mirrors pdf-lib's private resolver.
 */
function widgetAppearanceRef(
  field: PDFField,
  widget: PDFWidgetAnnotation,
): PDFRef | undefined {
  let refOrDict = widget.getNormalAppearance();
  if (
    refOrDict instanceof PDFDict &&
    (field instanceof PDFCheckBox || field instanceof PDFRadioGroup)
  ) {
    const value = (
      field.acroField as unknown as { getValue(): PDFName }
    ).getValue();
    const ref = refOrDict.get(value) ?? refOrDict.get(PDFName.of("Off"));
    if (ref instanceof PDFRef) refOrDict = ref;
  }
  return refOrDict instanceof PDFRef ? refOrDict : undefined;
}
