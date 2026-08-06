import type { Color, PdfBytes, Point, Rect } from "../../api/types.js";
import type { AnnotationSpec } from "../../capabilities/Annotate.js";
import { withPdfjsDoc } from "./document.js";

/**
 * Read existing PDF annotations back into engine specs so a loaded document's
 * annotations are re-editable (DEC-39, brief 14).
 *
 * Two things live here:
 *
 *  1. {@link rawToSpec} — the canonical mapping from a backend-neutral
 *     {@link RawAnnotation} to an {@link AnnotationSpec}. Both readers funnel
 *     through it, so the round-trip semantics are defined in exactly one place.
 *  2. {@link readAnnotationsWithPdfjs} — reads a document's annotations via
 *     pdf.js `page.getAnnotations()`, normalises each into a
 *     {@link RawAnnotation}, and maps it with `rawToSpec`.
 *
 * NOTE ON THE LIVE SEED PATH: the {@link import("../../capabilities/Annotate.js").Annotate}
 * interface is **synchronous** (`add`/`update`/`delete`/`list` return
 * immediately), so the adapter cannot await pdf.js on first access. The live
 * re-editability seed therefore reads annotation dictionaries synchronously
 * from pdf-lib (see `adapters/pdf-lib/annotate.ts` `seedFromDocument`), reusing
 * `rawToSpec` here so both paths agree. `readAnnotationsWithPdfjs` is the
 * pdf.js counterpart, exercised in tests to confirm what a standards reader
 * sees in the bytes we emit.
 *
 * Subtypes that round-trip on read: highlight, underline, strikeout, ink,
 * rect (Square), line, arrow (Line + arrow line-ending), freeText, note (Text)
 * and stamp (geometry + name; the embedded image is not decoded back to bytes).
 */

/**
 * A backend-neutral view of one PDF annotation, produced by either reader
 * (pdf.js or pdf-lib) and consumed by {@link rawToSpec}. Geometry is PDF user
 * space; `color`/`fill` are 0–1 RGB.
 */
export interface RawAnnotation {
  /** PDF `/Subtype` name without the leading slash, e.g. `"Highlight"`. */
  subtype: string;
  /** 1-based page index. */
  page: number;
  /** `/Rect` in PDF user space. */
  rect: Rect;
  /** Primary colour (`/C`) as 0–1 RGB. */
  color?: Color;
  /** Interior/fill colour (`/IC`) as 0–1 RGB. */
  fill?: Color;
  /** Opacity (`/CA`). */
  opacity?: number;
  /** `/Contents` text. */
  contents?: string;
  /** `/T` author/title. */
  author?: string;
  /** Border/stroke width (`/BS /W`). */
  width?: number;
  /** Flattened `/QuadPoints` (groups of 8). */
  quadPoints?: number[];
  /** `/InkList` — one flat number array per stroke. */
  inkList?: number[][];
  /** `/L` line coordinates `[x1,y1,x2,y2]`. */
  line?: [number, number, number, number];
  /** True when a `/LE` line ending denotes an arrowhead. */
  arrow?: boolean;
  /** `/Name` (stamp / note icon name). */
  name?: string;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Bounding rect of a group-of-8 quad `[x1,y1,x2,y2,x3,y3,x4,y4]`. */
function quadBounds(q: number[]): Rect {
  const xs = [q[0]!, q[2]!, q[4]!, q[6]!];
  const ys = [q[1]!, q[3]!, q[5]!, q[7]!];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Split a flat point array `[x0,y0,x1,y1,…]` into {@link Point}s. */
function toPoints(flat: number[]): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    pts.push({ x: flat[i]!, y: flat[i + 1]! });
  }
  return pts;
}

/**
 * Map a {@link RawAnnotation} to an {@link AnnotationSpec}, or `undefined` when
 * the subtype is not one the engine models (widgets, links, popups, …). This is
 * the single definition of read round-trip semantics.
 */
export function rawToSpec(raw: RawAnnotation): AnnotationSpec | undefined {
  const base = {
    page: raw.page,
    ...(raw.color ? { color: raw.color } : {}),
    ...(raw.opacity !== undefined ? { opacity: raw.opacity } : {}),
    ...(raw.contents ? { contents: raw.contents } : {}),
    ...(raw.author ? { author: raw.author } : {}),
  };

  switch (raw.subtype) {
    case "Highlight":
    case "Underline":
    case "StrikeOut": {
      const type =
        raw.subtype === "Highlight"
          ? "highlight"
          : raw.subtype === "Underline"
            ? "underline"
            : "strikeout";
      let rects: Rect[] | undefined;
      if (raw.quadPoints && raw.quadPoints.length >= 8) {
        rects = [];
        for (let i = 0; i + 8 <= raw.quadPoints.length; i += 8) {
          rects.push(quadBounds(raw.quadPoints.slice(i, i + 8)));
        }
      }
      const rect = rects?.[0] ?? raw.rect;
      return {
        ...base,
        type,
        rect,
        ...(rects && rects.length > 1 ? { rects } : {}),
      };
    }
    case "Ink":
      return {
        ...base,
        type: "ink",
        paths: (raw.inkList ?? []).map(toPoints),
        ...(raw.width !== undefined ? { width: raw.width } : {}),
      };
    case "Square":
      return {
        ...base,
        type: "rect",
        rect: raw.rect,
        ...(raw.width !== undefined ? { width: raw.width } : {}),
        ...(raw.fill ? { fill: raw.fill } : {}),
      };
    case "Line": {
      const l = raw.line ?? [
        raw.rect[0],
        raw.rect[1],
        raw.rect[2],
        raw.rect[3],
      ];
      return {
        ...base,
        type: raw.arrow ? "arrow" : "line",
        start: { x: l[0]!, y: l[1]! },
        end: { x: l[2]!, y: l[3]! },
        ...(raw.width !== undefined ? { width: raw.width } : {}),
      };
    }
    case "FreeText":
      return {
        ...base,
        type: "freeText",
        rect: raw.rect,
        text: raw.contents ?? "",
      };
    case "Text":
      return {
        ...base,
        type: "note",
        at: { x: raw.rect[0], y: raw.rect[1] },
        text: raw.contents ?? "",
      };
    case "Stamp":
      return {
        ...base,
        type: "stamp",
        rect: raw.rect,
        ...(raw.name ? { name: raw.name } : {}),
      };
    default:
      return undefined;
  }
}

/** Colour from a pdf.js `Uint8ClampedArray`/array (0–255) → 0–1 RGB. */
function colorFrom(
  c: Uint8ClampedArray | number[] | null | undefined,
): Color | undefined {
  if (!c || c.length < 3) return undefined;
  return {
    r: clamp01(c[0]! / 255),
    g: clamp01(c[1]! / 255),
    b: clamp01(c[2]! / 255),
  };
}

/**
 * Read every annotation from `bytes` via pdf.js and map to engine specs. Used
 * in tests as the standards-reader cross-check of what we emit. The live
 * re-editability seed is synchronous (pdf-lib) — see the module note above.
 */
export async function readAnnotationsWithPdfjs(
  bytes: PdfBytes,
): Promise<AnnotationSpec[]> {
  return withPdfjsDoc(bytes, async (pdf) => {
    const out: AnnotationSpec[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anns = (await page.getAnnotations()) as any[];
      for (const a of anns) {
        const endings: string[] = Array.isArray(a.lineEndings)
          ? a.lineEndings
          : [];
        const raw: RawAnnotation = {
          subtype: a.subtype,
          page: p,
          rect: [a.rect[0], a.rect[1], a.rect[2], a.rect[3]],
          color: colorFrom(a.color),
          fill: colorFrom(a.interiorColor),
          contents: a.contentsObj?.str || undefined,
          author: a.titleObj?.str || undefined,
          width:
            typeof a.borderStyle?.width === "number"
              ? a.borderStyle.width
              : undefined,
          quadPoints: a.quadPoints
            ? Array.from(a.quadPoints as ArrayLike<number>)
            : undefined,
          inkList: a.inkLists
            ? (a.inkLists as ArrayLike<number>[]).map((l) => Array.from(l))
            : undefined,
          line: a.lineCoordinates
            ? [
                a.lineCoordinates[0],
                a.lineCoordinates[1],
                a.lineCoordinates[2],
                a.lineCoordinates[3],
              ]
            : undefined,
          arrow: endings.some((e) => /Arrow/i.test(e)),
          name: a.name || undefined,
        };
        const spec = rawToSpec(raw);
        if (spec) out.push(spec);
      }
    }
    return out;
  });
}
