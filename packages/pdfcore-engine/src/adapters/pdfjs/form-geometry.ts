import type { PdfBytes, Rect } from "../../api/types.js";
import { withPdfjsDoc } from "./document.js";

/**
 * The geometry of a single form-field widget: the 1-based page it sits on and
 * its rectangle in PDF user space (`[x1,y1,x2,y2]`, origin bottom-left).
 */
export interface WidgetGeometry {
  /** 1-based page index the widget is on. */
  page: number;
  /** Widget rectangle in PDF user space. */
  rect: Rect;
}

/**
 * Read widget geometry for every AcroForm field via pdf.js `getAnnotations()`.
 *
 * pdf.js is the geometry source (not pdf-lib) because a browser consumer aligns
 * form overlays against the same pdf.js viewport the Render layer uses, so the
 * rectangles agree without a second coordinate model. Each widget annotation
 * carries `fieldName` and a `rect` already in PDF user space (`[x1,y1,x2,y2]`);
 * we normalise the corners to lower-left → upper-right so callers get a
 * canonical {@link Rect} regardless of how the source ordered them.
 *
 * A field may own several widgets (e.g. a radio group has one per option), so
 * the map values are arrays in page/appearance order. The Forms adapter merges
 * the FIRST widget's page + rect into `FieldInfo` (documented there).
 *
 * @param bytes current PDF bytes (the Forms adapter serialises the working
 *   pdf-lib document to obtain these so geometry reflects unsaved edits).
 * @returns field name → its widget geometries, in document order.
 */
export async function readFormGeometry(
  bytes: PdfBytes,
): Promise<Map<string, WidgetGeometry[]>> {
  return withPdfjsDoc(bytes, async (doc) => {
  const byField = new Map<string, WidgetGeometry[]>();

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const annotations = await page.getAnnotations();
    for (const annot of annotations) {
      const a = annot as {
        subtype?: string;
        fieldName?: string;
        rect?: number[];
      };
      if (a.subtype !== "Widget") continue;
      if (typeof a.fieldName !== "string" || a.fieldName === "") continue;
      const rect = normalizeRect(a.rect);
      if (!rect) continue;
      const list = byField.get(a.fieldName);
      const geom: WidgetGeometry = { page: pageNumber, rect };
      if (list) list.push(geom);
      else byField.set(a.fieldName, [geom]);
    }
  }

  return byField;
  });
}

/** Coerce a pdf.js `rect` ([x1,y1,x2,y2]) into a canonical lower-left→upper-right {@link Rect}. */
function normalizeRect(rect: number[] | undefined): Rect | undefined {
  if (!rect || rect.length < 4) return undefined;
  const [a, b, c, d] = rect as [number, number, number, number];
  if (![a, b, c, d].every((n) => Number.isFinite(n))) return undefined;
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}
