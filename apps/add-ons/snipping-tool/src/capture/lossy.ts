/**
 * Detecting what a DOM rasterization cannot see.
 *
 * `html-to-image` serialises the DOM into an SVG `foreignObject` and draws that to a
 * canvas. It is a genuinely different thing from a screenshot: the pixels come from
 * re-rendering the markup, not from the compositor. Three kinds of content therefore do
 * not survive it —
 *
 * - **`<canvas>`** — its bitmap is not part of the DOM, so it serialises as an empty box.
 * - **`<video>`** — the current frame is not markup either.
 * - **cross-origin `<img>`** — drawing one taints the canvas, so the rasterizer omits it.
 * - **scrolled panes** — `html-to-image` does not carry a pane's scroll offset onto its
 *   clone, so a scrolled area is re-rendered from its top and the shot shows the wrong rows.
 *
 * A screenshot tool that silently drops part of the screen is worse than one that says so,
 * which is why this exists: the region is scanned, and the capture is annotated with what
 * may be missing from it.
 *
 * Everything below the `scan` function is pure geometry, so the rules are testable without
 * a DOM.
 */

export type Rect = { x: number; y: number; width: number; height: number }

export type LossyKind = 'canvas' | 'video' | 'crossOriginImage' | 'scrolled'

/** One element that may not have survived the raster. */
export type LossyElement = { kind: LossyKind; rect: Rect }

/** Human labels, because "2 canvass" is not a word. */
const LABELS: Record<LossyKind, [singular: string, plural: string]> = {
  canvas: ['1 canvas element', 'canvas elements'],
  video: ['1 video', 'videos'],
  crossOriginImage: ['1 cross-origin image', 'cross-origin images'],
  scrolled: ['1 scrolled area', 'scrolled areas'],
}

/** Do two rects share any area? Touching edges do not count. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** Is this rect big enough to be worth mentioning? */
function isVisible(rect: Rect): boolean {
  return rect.width >= 4 && rect.height >= 4
}

/** The lossy elements that fall inside `region`, with a count per kind. */
export function summarize(
  elements: readonly LossyElement[],
  region: Rect
): { total: number; byKind: Partial<Record<LossyKind, number>> } {
  const byKind: Partial<Record<LossyKind, number>> = {}
  let total = 0
  for (const element of elements) {
    if (!isVisible(element.rect) || !rectsOverlap(element.rect, region)) continue
    byKind[element.kind] = (byKind[element.kind] ?? 0) + 1
    total++
  }
  return { total, byKind }
}

/**
 * A sentence naming what may be missing, or `null` when the region is clean.
 *
 * Phrased as "may not" rather than "did not" on purpose: whether a given element survives
 * depends on the browser and on how the element draws itself. The Terminal is the case that
 * matters here — xterm's DOM renderer serialises fine, and it would stop doing so the day
 * anyone adds `@xterm/addon-webgl`. Claiming certainty either way would be wrong.
 */
export function describeLossy(summary: {
  total: number
  byKind: Partial<Record<LossyKind, number>>
}): string | null {
  if (summary.total === 0) return null
  const parts = Object.entries(summary.byKind).map(([kind, count]) => {
    const [singular, plural] = LABELS[kind as LossyKind]
    return count === 1 ? singular : `${count} ${plural}`
  })
  const list =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
  // A scrolled pane is a different failure from an empty box: the pixels are
  // there, just from the wrong offset, so it gets its own sentence.
  const scrollNote = summary.byKind.scrolled
    ? ' A scrolled area is re-rendered from its top, so rows below the fold may appear in place of what is on screen.'
    : ''
  return `This region contained ${list}. Their content may not appear in the image — a DOM capture re-renders the markup rather than reading the screen.${scrollNote}`
}

/** True for an image served by another origin, which taints the raster canvas. */
function isCrossOrigin(src: string): boolean {
  if (src === '' || src.startsWith('data:') || src.startsWith('blob:')) return false
  try {
    return new URL(src, window.location.href).origin !== window.location.origin
  } catch {
    return false
  }
}

/**
 * Find the lossy elements currently on screen.
 *
 * Skips anything inside the tool's own overlay — it is filtered out of the raster anyway,
 * and the annotation canvas is itself a `<canvas>`, so a naive scan would warn about the
 * screenshot it is warning about.
 */
export function scanLossyElements(root: ParentNode = document): LossyElement[] {
  const out: LossyElement[] = []
  for (const node of root.querySelectorAll<HTMLElement>('canvas, video, img')) {
    if (node.closest('[data-snip-overlay]')) continue
    const box = node.getBoundingClientRect()
    const rect = { x: box.x, y: box.y, width: box.width, height: box.height }
    if (node.tagName === 'CANVAS') out.push({ kind: 'canvas', rect })
    else if (node.tagName === 'VIDEO') out.push({ kind: 'video', rect })
    else if (
      isCrossOrigin((node as HTMLImageElement).currentSrc || (node as HTMLImageElement).src)
    ) {
      out.push({ kind: 'crossOriginImage', rect })
    }
  }
  // Scrolled panes: `html-to-image` renders them from their top, so anything a
  // user scrolled to is captured wrong with no other signal. The page's own
  // root scroll is excluded — the region is in viewport coordinates, so the
  // document scroll is already accounted for.
  for (const node of root.querySelectorAll<HTMLElement>('*')) {
    if (node === document.documentElement || node === document.body) continue
    if (node.closest('[data-snip-overlay]')) continue
    if (node.scrollTop > 0 || node.scrollLeft > 0) {
      const box = node.getBoundingClientRect()
      out.push({
        kind: 'scrolled',
        rect: { x: box.x, y: box.y, width: box.width, height: box.height },
      })
    }
  }
  return out
}
