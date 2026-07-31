import type { PageViewport, Rect, TextItem } from "../api/types.js";
import {
  pdfBoxToScreen,
  pdfRectToScreenBox,
  type ViewTransform,
} from "../coords/index.js";

/**
 * Browser selection layer (brief 16) — the one genuinely browser-only surface
 * over Text (DEC-34): a positioned, selectable/copyable set of `<span>`s laid
 * over a rendered canvas, plus a "highlight these rects" helper the reader
 * shell (brief 17) drives with `Text.search` hits.
 *
 * ── Own layer vs pdf.js `TextLayerBuilder` (decision, recorded for the wiki) ─
 * We build our OWN lean layer rather than reusing pdf.js's `TextLayerBuilder`.
 * Why:
 *   - `TextLayerBuilder` takes a real pdf.js `PageViewport` instance (not our
 *     engine's structural `PageViewport` in api/types.ts) and pulls in more of
 *     pdf.js's internal API (`TextHighlighter`, `EventBus`) than we want as a
 *     surface dependency for something this small.
 *   - This package deliberately keeps every type DOM/backend-structural (see
 *     `RenderTarget` in api/types.ts) so `packages/engine`'s own typecheck runs
 *     with no `dom` lib at all (tsconfig `lib: ["ES2023"]`). Adopting
 *     `TextLayerBuilder` would mean depending on lib.dom types we don't carry.
 *   - Our own version is ~100 lines, has a pure (DOM-free, unit-testable)
 *     layout core, and stays in the engine's own `Rect`/`PageViewport`
 *     vocabulary end to end — no separate coordinate system to reconcile.
 *   - Trade-off accepted: we don't inherit pdf.js's glyph-level selection
 *     fidelity/RTL nuances. Fine for v1 (DEC-34's "lean browser layer" stance).
 *
 * ── DOM typing note ──────────────────────────────────────────────────────
 * No `dom` lib in this package's tsconfig (see above), so `Dom*Like` below are
 * minimal structural shapes — not `HTMLElement`/`Document`. A real DOM
 * `Element`/`Document` satisfies them at runtime; callers pass the real thing.
 */

/** Minimal structural surface of a DOM element the text layer touches. */
export interface DomElementLike {
  appendChild(node: DomElementLike): unknown;
  removeChild(node: DomElementLike): unknown;
  remove(): void;
  setAttribute(name: string, value: string): void;
  textContent: string | null;
  readonly style: DomStyleLike;
}

/** Minimal structural surface of `CSSStyleDeclaration`. */
export interface DomStyleLike {
  setProperty(name: string, value: string): void;
}

/** Minimal structural surface of `Document` (just element creation). */
export interface DomDocumentLike {
  createElement(tagName: string): DomElementLike;
}

/** One text span's screen-space layout, in CSS px (top-left origin). */
export interface TextSpanLayout {
  str: string;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Approximate CSS `font-size` (px) for this span. */
  fontSizePx: number;
}

/** Build a `ViewTransform` (the `coords/` currency) from a Render viewport. */
export function toViewTransform(viewport: PageViewport): ViewTransform {
  return {
    page: { width: viewport.pageWidth, height: viewport.pageHeight },
    scale: viewport.scale,
    rotation: normalizeRotation(viewport.rotation),
  };
}

function normalizeRotation(deg: number): 0 | 90 | 180 | 270 {
  const r = ((deg % 360) + 360) % 360;
  return r === 90 || r === 180 || r === 270 ? r : 0;
}

/**
 * Pure layout: map a page's `TextItem[]` (PDF user space) to screen-space span
 * boxes for a given viewport/scale. DOM-free — unit-testable under Node.
 */
export function layoutTextItems(
  items: TextItem[],
  viewport: PageViewport,
): TextSpanLayout[] {
  const t = toViewTransform(viewport);
  return items.map((item) => {
    const box = pdfBoxToScreen(
      { x: item.x, y: item.y, w: item.w, h: item.h },
      t,
    );
    return {
      str: item.str,
      left: box.x,
      top: box.y,
      width: box.w,
      height: box.h,
      // item.h is ≈ font size in PDF points (see TextItem docblock); box.h is
      // that same measurement already scaled to px, so it doubles as a
      // reasonable CSS font-size for the invisible selectable span.
      fontSizePx: box.h,
    };
  });
}

/** Pure layout: map search-hit rects (PDF user space) to screen-space boxes. */
export function layoutHighlightRects(
  rects: Rect[],
  viewport: PageViewport,
): Array<{ x: number; y: number; w: number; h: number }> {
  const t = toViewTransform(viewport);
  return rects.map((r) => pdfRectToScreenBox(r, t));
}

/** A built text layer instance — what brief 17's reader shell drives. */
export interface TextLayerHandle {
  /** The layer's root element (already appended into `container`). */
  readonly root: DomElementLike;
  /** Replace any current highlight overlay with one covering `rects`. */
  highlightRects(rects: Rect[], opts?: { className?: string }): void;
  /** Remove the current highlight overlay, if any. */
  clearHighlights(): void;
  /** Remove the whole layer (spans + highlights) from `container`. */
  destroy(): void;
}

export interface BuildTextLayerOptions {
  /** The real `document` (or a structurally-compatible stand-in). */
  document: DomDocumentLike;
  /** Parent element sized to the rendered canvas (should be positioned). */
  container: DomElementLike;
  /** This page's text items (e.g. `Text.extract({ pages: [n] })`). */
  items: TextItem[];
  /** The viewport the canvas was rendered at (`Render.viewport`). */
  viewport: PageViewport;
  /** Root layer class. Default `"pdfcore-text-layer"`. */
  className?: string;
  /** Highlight mark class. Default `"pdfcore-text-highlight"`. */
  highlightClassName?: string;
}

/**
 * Build a positioned, selectable text layer over a rendered page and append it
 * to `container`. Spans are absolutely positioned/sized to align with the
 * canvas at `viewport`'s scale; text is real (selectable/copyable) but painted
 * transparent so the rasterised canvas glyphs show through.
 *
 * Caller owns re-building on zoom/page change: call `destroy()` on the old
 * handle and `buildTextLayer` again with the new `viewport`/`items`.
 */
export function buildTextLayer(opts: BuildTextLayerOptions): TextLayerHandle {
  const { document: doc, container, items, viewport } = opts;
  const rootClass = opts.className ?? "pdfcore-text-layer";
  const highlightClass = opts.highlightClassName ?? "pdfcore-text-highlight";

  const root = doc.createElement("div");
  root.setAttribute("class", rootClass);
  setStyles(root, {
    position: "absolute",
    inset: "0",
    overflow: "hidden",
    "line-height": "1",
    "user-select": "text",
  });

  const spansLayer = doc.createElement("div");
  spansLayer.setAttribute("class", `${rootClass}__spans`);
  setStyles(spansLayer, { position: "absolute", inset: "0" });
  root.appendChild(spansLayer);

  const highlightLayer = doc.createElement("div");
  highlightLayer.setAttribute("class", `${rootClass}__highlights`);
  setStyles(highlightLayer, {
    position: "absolute",
    inset: "0",
    "pointer-events": "none",
  });
  root.appendChild(highlightLayer);

  for (const span of layoutTextItems(items, viewport)) {
    const el = doc.createElement("span");
    el.textContent = span.str;
    setStyles(el, {
      position: "absolute",
      left: `${span.left}px`,
      top: `${span.top}px`,
      width: `${span.width}px`,
      height: `${span.height}px`,
      "font-size": `${span.fontSizePx}px`,
      "line-height": `${span.height}px`,
      "white-space": "pre",
      "transform-origin": "0 0",
      color: "transparent",
    });
    spansLayer.appendChild(el);
  }

  container.appendChild(root);

  let highlightNodes: DomElementLike[] = [];

  function highlightRects(rects: Rect[], hOpts?: { className?: string }): void {
    clearHighlights();
    const cls = hOpts?.className ?? highlightClass;
    for (const box of layoutHighlightRects(rects, viewport)) {
      const mark = doc.createElement("div");
      mark.setAttribute("class", cls);
      setStyles(mark, {
        position: "absolute",
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${box.w}px`,
        height: `${box.h}px`,
      });
      highlightLayer.appendChild(mark);
      highlightNodes.push(mark);
    }
  }

  function clearHighlights(): void {
    for (const node of highlightNodes) highlightLayer.removeChild(node);
    highlightNodes = [];
  }

  function destroy(): void {
    clearHighlights();
    container.removeChild(root);
  }

  return { root, highlightRects, clearHighlights, destroy };
}

function setStyles(el: DomElementLike, styles: Record<string, string>): void {
  for (const [prop, value] of Object.entries(styles)) {
    el.style.setProperty(prop, value);
  }
}
