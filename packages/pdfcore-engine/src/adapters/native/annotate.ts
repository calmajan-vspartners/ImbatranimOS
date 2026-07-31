import {
  PDFName,
  PDFRef,
  PDFString,
  type PDFContext,
  type PDFDocument,
} from "pdf-lib";
import type { Color, Point, Rect } from "../../api/types.js";
import type { Annotation } from "../../capabilities/Annotate.js";
import { PdfEngineError } from "../../api/errors.js";
import { normalizeBox, rectToBox } from "../../coords/index.js";
import type { PdfLibDocument } from "../pdf-lib/document.js";

/**
 * Native annotation writer — the first strong own-implementation target
 * (DEC-2/DEC-39). `pdf-lib@1.17` exposes **no** high-level API for creating
 * markup / ink / shape / text / stamp annotations (only form-field widgets),
 * so every v1 subtype's annotation dictionary — and, where a standards viewer
 * needs one to display it, its `/AP` appearance stream — is authored here
 * directly on the shared pdf-lib {@link PDFContext}. pdf-lib is used only as the
 * low-level object store (`context.obj`/`register`, `page.node.addAnnot`) and
 * for image embedding (stamps).
 *
 * Coordinate convention: annotation `/Rect` and appearance geometry are both in
 * **page space** (PDF user space, origin bottom-left). Each appearance form
 * uses `BBox == Rect`, so the PDF appearance matrix is the identity and content
 * operators can be written in the same page coordinates as the spec.
 */
export class NativeAnnotationWriter {
  private readonly doc: PdfLibDocument;

  constructor(doc: PdfLibDocument) {
    this.doc = doc;
  }

  /**
   * Emit `ann` as a real PDF annotation object on its page and return the new
   * object's ref plus the 0-based page index it was attached to. The caller
   * (the Annotate committer) tracks the ref so the annotation can later be
   * rewritten or removed.
   */
  async emit(ann: Annotation): Promise<{ ref: PDFRef; pageIndex: number }> {
    const pdf = this.doc.pdfLibDocument;
    const ctx = pdf.context;
    const pageIndex = ann.page - 1;
    const pages = pdf.getPages();
    const page = pages[pageIndex];
    if (!page) {
      throw new PdfEngineError(
        `annotate: page ${ann.page} out of range (document has ${pages.length} page(s)).`,
      );
    }

    const dict = await this.#build(ctx, pdf, ann);
    const ref = ctx.register(ctx.obj(dict as Parameters<PDFContext["obj"]>[0]));
    page.node.addAnnot(ref);
    return { ref, pageIndex };
  }

  /** Build the annotation dictionary literal (incl. `/AP`) for `ann`. */
  async #build(
    ctx: PDFContext,
    pdf: PDFDocument,
    ann: Annotation,
  ): Promise<Record<string, unknown>> {
    // Fields common to every subtype. `/C`, `/CA`, `/Contents`, `/T` are set by
    // helpers below only when present so we never emit empty entries.
    const common = (rect: Rect): Record<string, unknown> => {
      const d: Record<string, unknown> = { Type: "Annot", Rect: rect };
      if (ann.contents) d.Contents = PDFString.of(ann.contents);
      if (ann.author) d.T = PDFString.of(ann.author);
      if (ann.opacity !== undefined) d.CA = ann.opacity;
      return d;
    };

    switch (ann.type) {
      case "highlight":
      case "underline":
      case "strikeout":
        return this.#markup(ctx, ann, common);
      case "ink":
        return this.#ink(ctx, ann, common);
      case "rect":
        return this.#square(ctx, ann, common);
      case "line":
      case "arrow":
        return this.#line(ctx, ann, common);
      case "freeText":
        return this.#freeText(ctx, ann, common);
      case "note":
        return this.#note(ann, common);
      case "stamp":
        return this.#stamp(ctx, pdf, ann, common);
    }
  }

  /* ── text markup: highlight / underline / strikeout ───────────────────── */

  #markup(
    ctx: PDFContext,
    ann: Extract<Annotation, { type: "highlight" | "underline" | "strikeout" }>,
    common: (rect: Rect) => Record<string, unknown>,
  ): Record<string, unknown> {
    const rects = ann.rects && ann.rects.length ? ann.rects : [ann.rect];
    const norm = rects.map((r) => rectToBox(r));
    const bounds = unionRect(rects);
    const color =
      ann.color ??
      (ann.type === "highlight" ? { r: 1, g: 1, b: 0 } : { r: 0, g: 0, b: 0 });
    const opacity = ann.opacity ?? 1;

    // QuadPoints: PDF viewer synthesises markup appearance from these; we ALSO
    // bundle an /AP so strict viewers (Chrome) render without re-deriving it.
    const quad: number[] = [];
    for (const b of norm) {
      const n = normalizeBox(b);
      // order: UL, UR, LL, LR
      quad.push(n.x, n.y + n.h, n.x + n.w, n.y + n.h, n.x, n.y, n.x + n.w, n.y);
    }

    const subtype =
      ann.type === "highlight"
        ? "Highlight"
        : ann.type === "underline"
          ? "Underline"
          : "StrikeOut";

    const dict = common(bounds);
    dict.Subtype = subtype;
    dict.QuadPoints = quad;
    dict.C = [color.r, color.g, color.b];

    // Appearance.
    let content: string;
    const resources: Record<string, unknown> = {};
    if (ann.type === "highlight") {
      // Multiply blend so the marked text remains legible under the fill.
      resources.ExtGState = {
        GS0: { Type: "ExtGState", BM: "Multiply", ca: opacity, CA: opacity },
      };
      const ops = [`/GS0 gs`, `${rgb(color)} rg`];
      for (const b of norm) {
        const n = normalizeBox(b);
        ops.push(`${fmt(n.x)} ${fmt(n.y)} ${fmt(n.w)} ${fmt(n.h)} re`);
      }
      ops.push("f");
      content = `q\n${ops.join("\n")}\nQ`;
    } else {
      const ops = [`${fmt(lineWidth(undefined))} w`, `${rgb(color)} RG`];
      for (const b of norm) {
        const n = normalizeBox(b);
        const y = ann.type === "underline" ? n.y + n.h * 0.08 : n.y + n.h * 0.5;
        ops.push(`${fmt(n.x)} ${fmt(y)} m ${fmt(n.x + n.w)} ${fmt(y)} l S`);
      }
      content = `q\n${ops.join("\n")}\nQ`;
    }
    dict.AP = { N: makeForm(ctx, bounds, content, resources) };
    return dict;
  }

  /* ── freehand ink ─────────────────────────────────────────────────────── */

  #ink(
    ctx: PDFContext,
    ann: Extract<Annotation, { type: "ink" }>,
    common: (rect: Rect) => Record<string, unknown>,
  ): Record<string, unknown> {
    const color = ann.color ?? { r: 0, g: 0, b: 0 };
    const width = lineWidth(ann.width);
    const all = ann.paths.flat();
    const bounds = padRect(pointsBounds(all), width + 1);

    const inkList = ann.paths.map((path) => path.flatMap((p) => [p.x, p.y]));

    const dict = common(bounds);
    dict.Subtype = "Ink";
    dict.InkList = inkList;
    dict.C = [color.r, color.g, color.b];
    dict.BS = { W: width };

    const ops: string[] = [`${fmt(width)} w`, "1 J", "1 j", `${rgb(color)} RG`];
    for (const path of ann.paths) {
      if (!path.length) continue;
      ops.push(`${fmt(path[0]!.x)} ${fmt(path[0]!.y)} m`);
      for (let i = 1; i < path.length; i++) {
        ops.push(`${fmt(path[i]!.x)} ${fmt(path[i]!.y)} l`);
      }
      ops.push("S");
    }
    dict.AP = { N: makeForm(ctx, bounds, `q\n${ops.join("\n")}\nQ`) };
    return dict;
  }

  /* ── rectangle (Square) ───────────────────────────────────────────────── */

  #square(
    ctx: PDFContext,
    ann: Extract<Annotation, { type: "rect" }>,
    common: (rect: Rect) => Record<string, unknown>,
  ): Record<string, unknown> {
    const border = ann.color ?? { r: 0, g: 0, b: 0 };
    const width = lineWidth(ann.width);
    const bounds = ann.rect;
    const box = normalizeBox(rectToBox(bounds));

    const dict = common(bounds);
    dict.Subtype = "Square";
    dict.C = [border.r, border.g, border.b];
    dict.BS = { W: width };
    if (ann.fill) dict.IC = [ann.fill.r, ann.fill.g, ann.fill.b];

    // Inset by half the stroke so the border stays inside the rect.
    const h = width / 2;
    const ops: string[] = [`${fmt(width)} w`, `${rgb(border)} RG`];
    let paint = "S";
    if (ann.fill) {
      ops.push(`${rgb(ann.fill)} rg`);
      paint = "B";
    }
    ops.push(
      `${fmt(box.x + h)} ${fmt(box.y + h)} ${fmt(box.w - width)} ${fmt(box.h - width)} re ${paint}`,
    );
    dict.AP = { N: makeForm(ctx, bounds, `q\n${ops.join("\n")}\nQ`) };
    return dict;
  }

  /* ── line / arrow ─────────────────────────────────────────────────────── */

  #line(
    ctx: PDFContext,
    ann: Extract<Annotation, { type: "line" | "arrow" }>,
    common: (rect: Rect) => Record<string, unknown>,
  ): Record<string, unknown> {
    const color = ann.color ?? { r: 0, g: 0, b: 0 };
    const width = lineWidth(ann.width);
    const s = ann.start;
    const e = ann.end;
    const bounds = padRect(
      pointsBounds([s, e]),
      width + (ann.type === "arrow" ? 12 : 2),
    );

    const dict = common(bounds);
    dict.Subtype = "Line";
    dict.L = [s.x, s.y, e.x, e.y];
    dict.C = [color.r, color.g, color.b];
    dict.BS = { W: width };
    if (ann.type === "arrow")
      dict.LE = [PDFName.of("None"), PDFName.of("ClosedArrow")];

    const ops: string[] = [
      `${fmt(width)} w`,
      "1 J",
      `${rgb(color)} RG`,
      `${fmt(s.x)} ${fmt(s.y)} m ${fmt(e.x)} ${fmt(e.y)} l S`,
    ];
    if (ann.type === "arrow") {
      const dx = e.x - s.x;
      const dy = e.y - s.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const al = Math.max(8, width * 3);
      const aw = al * 0.5;
      const bx = e.x - ux * al;
      const by = e.y - uy * al;
      const px = -uy * aw;
      const py = ux * aw;
      ops.push(`${rgb(color)} rg`);
      ops.push(
        `${fmt(e.x)} ${fmt(e.y)} m ${fmt(bx + px)} ${fmt(by + py)} l ${fmt(bx - px)} ${fmt(by - py)} l f`,
      );
    }
    dict.AP = { N: makeForm(ctx, bounds, `q\n${ops.join("\n")}\nQ`) };
    return dict;
  }

  /* ── free text ────────────────────────────────────────────────────────── */

  #freeText(
    ctx: PDFContext,
    ann: Extract<Annotation, { type: "freeText" }>,
    common: (rect: Rect) => Record<string, unknown>,
  ): Record<string, unknown> {
    const color = ann.color ?? { r: 0, g: 0, b: 0 };
    const size = ann.fontSize ?? 12;
    const bounds = ann.rect;
    const box = normalizeBox(rectToBox(bounds));

    const dict = common(bounds);
    dict.Subtype = "FreeText";
    dict.Contents = PDFString.of(ann.text);
    dict.DA = PDFString.of(`/Helv ${fmt(size)} Tf ${rgb(color)} rg`);
    dict.C = [color.r, color.g, color.b];

    const lines = ann.text.split(/\r\n|\r|\n/);
    const leading = size * 1.2;
    const x = box.x + 2;
    const y = box.y + box.h - size; // first baseline near the top edge
    const body: string[] = [
      "BT",
      `/Helv ${fmt(size)} Tf`,
      `${fmt(leading)} TL`,
      `${rgb(color)} rg`,
      `${fmt(x)} ${fmt(y)} Td`,
    ];
    lines.forEach((ln, i) => {
      body.push(
        i === 0 ? `(${escapeText(ln)}) Tj` : `T* (${escapeText(ln)}) Tj`,
      );
    });
    body.push("ET");
    const resources = {
      Font: { Helv: { Type: "Font", Subtype: "Type1", BaseFont: "Helvetica" } },
    };
    dict.AP = {
      N: makeForm(ctx, bounds, `q\n${body.join("\n")}\nQ`, resources),
    };
    return dict;
  }

  /* ── sticky note (Text) ───────────────────────────────────────────────── */

  #note(
    ann: Extract<Annotation, { type: "note" }>,
    common: (rect: Rect) => Record<string, unknown>,
  ): Record<string, unknown> {
    // Text annotations render as a viewer-drawn icon; no /AP is authored.
    const size = 20;
    const bounds: Rect = [ann.at.x, ann.at.y, ann.at.x + size, ann.at.y + size];
    const dict = common(bounds);
    dict.Subtype = "Text";
    dict.Contents = PDFString.of(ann.text);
    dict.Name = PDFName.of("Note");
    dict.Open = false;
    if (ann.color) dict.C = [ann.color.r, ann.color.g, ann.color.b];
    return dict;
  }

  /* ── stamp ────────────────────────────────────────────────────────────── */

  async #stamp(
    ctx: PDFContext,
    pdf: PDFDocument,
    ann: Extract<Annotation, { type: "stamp" }>,
    common: (rect: Rect) => Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const bounds = ann.rect;
    const box = normalizeBox(rectToBox(bounds));
    const dict = common(bounds);
    dict.Subtype = "Stamp";

    if (ann.image) {
      const image = isPng(ann.image)
        ? await pdf.embedPng(ann.image)
        : await pdf.embedJpg(ann.image);
      const content = `q ${fmt(box.w)} 0 0 ${fmt(box.h)} ${fmt(box.x)} ${fmt(box.y)} cm /Im0 Do Q`;
      const resources = { XObject: { Im0: image.ref } };
      dict.AP = { N: makeForm(ctx, bounds, content, resources) };
      dict.Name = PDFName.of(ann.name ?? "Image");
    } else {
      // No image: fall back to a named standard stamp (viewer-drawn).
      dict.Name = PDFName.of(ann.name ?? "Draft");
    }
    return dict;
  }
}

/* ── shared appearance / geometry helpers ───────────────────────────────── */

/**
 * Register a `/Type /XObject /Subtype /Form` appearance stream whose BBox
 * equals the annotation rect (identity appearance matrix) so `content` can be
 * written in page coordinates.
 */
function makeForm(
  ctx: PDFContext,
  bbox: Rect,
  content: string,
  resources: Record<string, unknown> = {},
): PDFRef {
  const dict = {
    Type: "XObject",
    Subtype: "Form",
    FormType: 1,
    BBox: [bbox[0], bbox[1], bbox[2], bbox[3]],
    Resources: resources,
  };
  const stream = ctx.stream(
    content,
    dict as Parameters<PDFContext["stream"]>[1],
  );
  return ctx.register(stream);
}

/** Format a number for a content stream (trim needless precision). */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");
}

/** `r g b` operands (0–1) for a colour. */
function rgb(c: Color): string {
  return `${fmt(c.r)} ${fmt(c.g)} ${fmt(c.b)}`;
}

/** Effective stroke width (default 1, min 0.1). */
function lineWidth(w: number | undefined): number {
  return Math.max(0.1, w ?? 1);
}

/** Escape text for a literal PDF string in a content stream. */
function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Axis-aligned bounds of a set of points as a Rect. */
function pointsBounds(pts: Point[]): Rect {
  if (!pts.length) return [0, 0, 0, 0];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return [minX, minY, maxX, maxY];
}

/** Union of several rects. */
function unionRect(rects: Rect[]): Rect {
  const pts: Point[] = [];
  for (const r of rects) {
    pts.push({ x: r[0], y: r[1] }, { x: r[2], y: r[3] });
  }
  return pointsBounds(pts);
}

/** Grow a rect outward by `pad` on all sides. */
function padRect(r: Rect, pad: number): Rect {
  return [r[0] - pad, r[1] - pad, r[2] + pad, r[3] + pad];
}

/** PNG magic number check (else treat as JPEG). */
function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x89 && bytes[1] === 0x50;
}
