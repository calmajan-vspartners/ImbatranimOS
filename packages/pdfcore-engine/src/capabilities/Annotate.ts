import type { Color, PdfBytes, Point, Rect } from "../api/types.js";

/**
 * The annotation subtypes the engine models (DEC-39). Text-markup subtypes
 * (highlight/underline/strikeout) mark existing text; the rest are drawn.
 */
export type AnnotationType =
  | "highlight"
  | "underline"
  | "strikeout"
  | "ink"
  | "rect"
  | "line"
  | "arrow"
  | "freeText"
  | "note"
  | "stamp";

/** Fields common to every annotation spec. Geometry is PDF user space. */
export interface AnnotationBase {
  /** 1-based page index the annotation lives on. */
  page: number;
  /** Stroke / fill / text colour (0–1 RGB). Subtype decides how it is used. */
  color?: Color;
  /** Opacity 0–1. Default 1. */
  opacity?: number;
  /** Optional note/comment text (the annotation's `/Contents`). */
  contents?: string;
  /** Optional author (`/T`). */
  author?: string;
}

/** Text-markup annotations: mark one or more rectangles over existing text. */
export interface MarkupAnnotationSpec extends AnnotationBase {
  type: "highlight" | "underline" | "strikeout";
  /** The marked region(s) in PDF user space. */
  rect: Rect;
  /** Additional rects when the marked text spans lines. */
  rects?: Rect[];
}

/** Freehand ink: one or more polylines of PDF-space points. */
export interface InkAnnotationSpec extends AnnotationBase {
  type: "ink";
  /** Each entry is a stroke: an ordered list of PDF-space points. */
  paths: Point[][];
  /** Stroke width in points. Default 1. */
  width?: number;
}

/** Rectangle (square) shape annotation. */
export interface RectAnnotationSpec extends AnnotationBase {
  type: "rect";
  rect: Rect;
  /** Border width in points. Default 1. */
  width?: number;
  /** Optional interior fill colour. */
  fill?: Color;
}

/** Line or arrow between two PDF-space points. */
export interface LineAnnotationSpec extends AnnotationBase {
  type: "line" | "arrow";
  start: Point;
  end: Point;
  /** Line width in points. Default 1. */
  width?: number;
}

/** Free-text box drawn at a rect. */
export interface FreeTextAnnotationSpec extends AnnotationBase {
  type: "freeText";
  rect: Rect;
  text: string;
  /** Font size in points. Default 12. */
  fontSize?: number;
}

/** Sticky note (text annotation) anchored at a point. */
export interface NoteAnnotationSpec extends AnnotationBase {
  type: "note";
  at: Point;
  text: string;
}

/** Stamp — a raster image (or reused appearance) placed at a rect. */
export interface StampAnnotationSpec extends AnnotationBase {
  type: "stamp";
  rect: Rect;
  /** PNG/JPEG bytes to embed as the stamp appearance. */
  image?: PdfBytes;
  /** A named standard stamp (e.g. "Approved") when no image is supplied. */
  name?: string;
}

/** Any annotation spec accepted by {@link Annotate.add}. */
export type AnnotationSpec =
  | MarkupAnnotationSpec
  | InkAnnotationSpec
  | RectAnnotationSpec
  | LineAnnotationSpec
  | FreeTextAnnotationSpec
  | NoteAnnotationSpec
  | StampAnnotationSpec;

/** A stored annotation — a spec plus the engine-assigned id. */
export type Annotation = AnnotationSpec & {
  /** Engine-assigned stable id (unique within the document session). */
  id: string;
};

/**
 * A partial update applied to an existing annotation via {@link Annotate.update}.
 *
 * The `Omit` is distributed over the {@link AnnotationSpec} union so subtype-
 * specific keys (`rect`, `start`/`end`, `text`, `paths`, …) survive — a plain
 * `Partial<Omit<AnnotationSpec, "type">>` would collapse to only the keys common
 * to every member, making geometry and text unpatchable.
 */
export type AnnotationPatch = AnnotationSpec extends infer S
  ? S extends AnnotationSpec
    ? Partial<Omit<S, "type">>
    : never
  : never;

/**
 * Annotate — CRUD of **real PDF annotation objects** (DEC-39): highlight /
 * underline / strikeout, ink, shapes (rect/line/arrow), free-text, sticky
 * notes, stamps. Committed to the PDF on `save()`; existing annotations load
 * back as editable. Backed by `pdf-lib` where it can write the subtype, and by
 * the `native/` adapter (own annotation dictionaries) where it cannot.
 *
 * Platform: **common**. Implemented by **brief 14**.
 */
export interface Annotate {
  /** Add an annotation to the in-memory model; returns its new id. */
  add(spec: AnnotationSpec): string;

  /** Update an existing annotation by id. */
  update(id: string, patch: AnnotationPatch): void;

  /** Delete an annotation by id. */
  delete(id: string): void;

  /** List annotations, optionally restricted to a 1-based page index. */
  list(page?: number): Annotation[];
}
