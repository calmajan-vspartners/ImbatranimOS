/**
 * Shared public surface for `@pdfcore/engine` — everything identical across
 * platforms. The platform entry points (index.node.ts / index.browser.ts)
 * re-export this and register their platform binding so `PdfDoc.load(bytes)`
 * works with no explicit platform.
 *
 * Only OUR types are exported here. No backend library type (pdf-lib /
 * pdfjs-dist) appears in this surface or its `.d.ts` (DEC-1).
 */

// Facade + errors + our types.
export { PdfDoc } from "./api/PdfDoc.js";
export {
  PdfEngineError,
  NotImplemented,
  UnsupportedPlatform,
  EncryptedDocument,
  PdfEngineWarning,
  SignatureInvalidationWarning,
} from "./api/errors.js";
export type {
  PdfBytes,
  Point,
  Rect,
  Box,
  PageSize,
  Color,
  StandardFont,
  RenderTarget,
  RenderOptions,
  RenderResult,
  PageViewport,
  TextItem,
  TextExtractOptions,
  TextSearchOptions,
  TextHit,
  OutlineNode,
  NamedDestination,
  DocumentMetadata,
  CreateDocOptions,
  DrawTextOptions,
} from "./api/types.js";

// The ten capability interfaces + their supporting types.
export type {
  Document,
  Render,
  Text,
  Outline,
  Annotate,
  AnnotationType,
  AnnotationBase,
  AnnotationSpec,
  Annotation,
  AnnotationPatch,
  MarkupAnnotationSpec,
  InkAnnotationSpec,
  RectAnnotationSpec,
  LineAnnotationSpec,
  FreeTextAnnotationSpec,
  NoteAnnotationSpec,
  StampAnnotationSpec,
  Forms,
  FieldInfo,
  FieldType,
  FieldValue,
  Sign,
  SignatureMark,
  PlaceSignatureOptions,
  Pages,
  PageInsert,
  Assemble,
  SplitSpec,
  Generate,
} from "./capabilities/index.js";

// Platform seam (references only our types — no backend leak). Exposed so
// consumers can pass an explicit platform to PdfDoc.load if they mix
// environments.
export type { Platform } from "./platform/types.js";

// The shared coordinate transform (briefs 14/16 reuse; the one transform).
export {
  rectToBox,
  boxToRect,
  screenToPdfPoint,
  pdfToScreenPoint,
  screenBoxToPdf,
  pdfBoxToScreen,
  screenBoxToPdfRect,
  pdfRectToScreenBox,
  snap,
  normalizeBox,
  pointInRect,
} from "./coords/index.js";
export type { ViewTransform, PageSizePt } from "./coords/index.js";
