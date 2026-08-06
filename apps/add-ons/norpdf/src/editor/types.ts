/**
 * View-model types for the PART B editor surfaces (annotate / forms / organize).
 * PDF data types come from `@pdfcore/engine`; these describe UI state only.
 *
 * Ported from the AtelierPDF editor reference; logic is identical, imports are
 * retargeted to the OS add-on's engine entry point.
 */
import type { AnnotationSpec, Color, SignatureMark } from '@pdfcore/engine'

/** The active annotate tool. `select` = no drawing (text selection + pick marks). */
export type AnnotateTool =
  | 'select'
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'ink'
  | 'rect'
  | 'line'
  | 'arrow'
  | 'freeText'
  | 'note'
  | 'sign'

/** A named swatch offered in the annotate toolbar. */
export interface Swatch {
  name: string
  color: Color
}

/**
 * The editor controller — PART B's counterpart to the reader controller. Holds
 * the active tool, style, the pending signature mark, and the annotation
 * mutation actions. Shared via {@link EditorContext} / `useEditor()`.
 *
 * Display model (see EditorProvider): session-added annotations render in an
 * SVG overlay above each page (tracked by {@link addedIds}); annotations that
 * are already baked into the rasterised page (existing on open, or committed by
 * a save→reload) are NOT overlaid, so nothing double-draws.
 */
export interface EditorController {
  /* ── Toolbar state ──────────────────────────────────────────────────── */
  tool: AnnotateTool
  setTool: (tool: AnnotateTool) => void
  color: Color
  setColor: (color: Color) => void
  opacity: number
  setOpacity: (opacity: number) => void
  strokeWidth: number
  setStrokeWidth: (width: number) => void

  /* ── Signature ──────────────────────────────────────────────────────── */
  /** The captured signature mark, ready to place on the page; null otherwise. */
  signMark: SignatureMark | null
  setSignMark: (mark: SignatureMark | null) => void
  /** Whether the signature capture dialog is open. */
  signDialogOpen: boolean
  /** Open the pad to capture a mark for drag-placing on the page (Sign tool). */
  openSignDialog: () => void
  /** Open the pad to fill a specific AcroForm signature field by name. */
  openSignDialogForField: (name: string) => void
  closeSignDialog: () => void
  /**
   * Apply a captured mark: fills the pending signature field (if opened via
   * {@link openSignDialogForField}) or arms the Sign tool for page placement.
   */
  applySignatureMark: (mark: SignatureMark) => void

  /* ── Selection (of a session-added annotation, for deletion) ────────── */
  selectedId: string | null
  setSelectedId: (id: string | null) => void

  /* ── Annotation mutations ───────────────────────────────────────────── */
  /** Add an annotation (overlay preview); returns its id. */
  addAnnotation: (spec: AnnotationSpec) => string
  /** Delete an annotation by id (re-rasterises if it was already baked). */
  deleteAnnotation: (id: string) => Promise<void>
  /** Ids added this session and not yet baked into the raster. */
  addedIds: ReadonlySet<string>

  /**
   * Commit pending edits to the rasterised page: `doc.save()` +
   * `reloadDocument()`, then clear {@link addedIds} (all marks are now baked).
   * Used after forms edits / organize ops so the canvas reflects them.
   */
  syncRaster: () => Promise<void>
  /**
   * The primary Save: serialise the document and WRITE IT BACK to the OS file it
   * was opened from (`uploadFileBytes`), then reload + clear {@link addedIds} so
   * the overlay and the baked raster stay in sync. Falls back to a download for a
   * document with no OS home. Clears the dirty flag on success.
   */
  saveToDisk: () => Promise<void>
  /** True while {@link syncRaster} / {@link saveToDisk} (or an organize op) is running. */
  busy: boolean
}
