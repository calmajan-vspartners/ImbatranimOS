/**
 * Coordinates — THE single shared, unit-tested transform (architecture.md
 * "Coordinates — one shared transform"; the most bug-prone area, carried over
 * from the Studio era). Render, the selection text layer (brief 16), Annotate
 * hit-testing (brief 14) and Forms widget geometry (brief 13) all convert
 * through THIS module and no other. If two consumers disagree, marks mis-land
 * silently — so there is exactly one implementation here.
 *
 * Conventions
 * -----------
 * - **PDF user space**: origin BOTTOM-LEFT, +x right, +y up, units = points.
 *   A page is `{ width, height }` in points. This is what the engine exposes on
 *   every public capability signature (see api/types.ts).
 * - **Screen space**: origin TOP-LEFT, +x right, +y DOWN, units = CSS px of the
 *   rendered canvas. Canvas pixel size = page size × `scale`.
 * - `scale = 1` ⇒ 1 pt = 1 px (pdf.js renders 1 px/pt at scale 1).
 *
 * Page rotation is threaded through {@link ViewTransform.rotation}; at rotation
 * 0 the transforms reduce to a pure y-flip + scale. Rotation-aware mapping is
 * kept minimal in v1 (0 is the common case) and extended by later briefs.
 */

import type { Box, Point, Rect } from "../api/types.js";

/** A page's intrinsic size in PDF points. */
export interface PageSizePt {
  width: number;
  height: number;
}

/**
 * The render context tying a page to its on-screen canvas: the page's point
 * dimensions, the zoom `scale` and the page rotation it is drawn at.
 */
export interface ViewTransform {
  /** Page size in PDF points (unrotated). */
  page: PageSizePt;
  /** Render scale (zoom). 1 = 100% (1 px per pt). Must be > 0. */
  scale: number;
  /** Clockwise page rotation in degrees. Default 0. */
  rotation?: 0 | 90 | 180 | 270;
}

/* ───────────────────────────────────────────── rect ↔ box conversions ──── */

/** `[x1,y1,x2,y2]` rect (PDF space) → `{x,y,w,h}` box (bottom-left origin). */
export function rectToBox(r: Rect): Box {
  const [x1, y1, x2, y2] = r;
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

/** `{x,y,w,h}` box (bottom-left origin) → `[x1,y1,x2,y2]` rect (PDF space). */
export function boxToRect(b: Box): Rect {
  return [b.x, b.y, b.x + b.w, b.y + b.h];
}

/* ───────────────────────────────────────────────────────── points ─────── */

/**
 * Screen point (top-left origin, px) → PDF point (bottom-left origin, pt).
 *
 * Honours {@link ViewTransform.rotation}: the screen axes are those of the
 * page *as drawn* (pdf.js rotates the canvas clockwise by `rotation`), so the
 * inverse mapping un-rotates before the y-flip. At rotation 0 this reduces to a
 * pure y-flip + scale.
 */
export function screenToPdfPoint(p: Point, t: ViewTransform): Point {
  const { width: w, height: h } = t.page;
  const sx = p.x / t.scale;
  const sy = p.y / t.scale;
  switch (t.rotation ?? 0) {
    case 90:
      return { x: sy, y: sx };
    case 180:
      return { x: w - sx, y: sy };
    case 270:
      return { x: w - sy, y: h - sx };
    default:
      return { x: sx, y: h - sy };
  }
}

/**
 * PDF point (bottom-left origin, pt) → screen point (top-left origin, px).
 * Inverse of {@link screenToPdfPoint}; rotation-aware (see there).
 */
export function pdfToScreenPoint(p: Point, t: ViewTransform): Point {
  const { width: w, height: h } = t.page;
  let x: number;
  let y: number;
  switch (t.rotation ?? 0) {
    case 90:
      x = p.y;
      y = p.x;
      break;
    case 180:
      x = w - p.x;
      y = p.y;
      break;
    case 270:
      x = h - p.y;
      y = w - p.x;
      break;
    default:
      x = p.x;
      y = h - p.y;
      break;
  }
  return { x: x * t.scale, y: y * t.scale };
}

/* ───────────────────────────────────────────────────────── boxes ──────── */

/**
 * Screen box (top-left origin, px) → PDF box (bottom-left origin, pt).
 *
 * Rotation-aware: the two diagonal corners are mapped through
 * {@link screenToPdfPoint} and re-bounded, so a 90/270 rotation correctly swaps
 * width and height. At rotation 0 this reduces to the y-flip + scale.
 */
export function screenBoxToPdf(b: Box, t: ViewTransform): Box {
  const p1 = screenToPdfPoint({ x: b.x, y: b.y }, t);
  const p2 = screenToPdfPoint({ x: b.x + b.w, y: b.y + b.h }, t);
  return {
    x: Math.min(p1.x, p2.x),
    y: Math.min(p1.y, p2.y),
    w: Math.abs(p2.x - p1.x),
    h: Math.abs(p2.y - p1.y),
  };
}

/** PDF box (bottom-left origin, pt) → screen box (top-left origin, px). Inverse of {@link screenBoxToPdf}; rotation-aware. */
export function pdfBoxToScreen(b: Box, t: ViewTransform): Box {
  const p1 = pdfToScreenPoint({ x: b.x, y: b.y }, t);
  const p2 = pdfToScreenPoint({ x: b.x + b.w, y: b.y + b.h }, t);
  return {
    x: Math.min(p1.x, p2.x),
    y: Math.min(p1.y, p2.y),
    w: Math.abs(p2.x - p1.x),
    h: Math.abs(p2.y - p1.y),
  };
}

/** Screen box → PDF `[x1,y1,x2,y2]` rect. */
export function screenBoxToPdfRect(b: Box, t: ViewTransform): Rect {
  return boxToRect(screenBoxToPdf(b, t));
}

/** PDF `[x1,y1,x2,y2]` rect → screen box. */
export function pdfRectToScreenBox(r: Rect, t: ViewTransform): Box {
  return pdfBoxToScreen(rectToBox(r), t);
}

/* ───────────────────────────────────────────────────── helpers ────────── */

/** Snap a value to the nearest multiple of `grid` (grid <= 0 ⇒ no-op). */
export function snap(value: number, grid: number): number {
  if (grid <= 0) return value;
  return Math.round(value / grid) * grid;
}

/** Normalise a possibly-inverted box (negative w/h) to positive extents. */
export function normalizeBox(b: Box): Box {
  return {
    x: b.w < 0 ? b.x + b.w : b.x,
    y: b.h < 0 ? b.y + b.h : b.y,
    w: Math.abs(b.w),
    h: Math.abs(b.h),
  };
}

/** True if a PDF-space point lies inside a PDF-space rect (hit-testing). */
export function pointInRect(p: Point, r: Rect): boolean {
  const b = rectToBox(r);
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
}
