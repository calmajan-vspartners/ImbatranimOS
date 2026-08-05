/**
 * The maths behind scroll sync: piecewise-linear mapping between source lines and
 * pixel offsets, in both directions.
 *
 * Why not the obvious `scrollTop / scrollHeight` ratio: the two panes have wildly
 * different heights per source line. A 12-line table renders as one compact block and a
 * one-line image tag renders as several hundred pixels of picture. Proportional scrolling
 * is exact at the very top and the very bottom and wrong in between, by an amount that
 * grows with how unlike the two panes are.
 *
 * Measured in a browser on a ~2800px document containing one full-width image: the
 * proportional answer was 140px away from the anchored one — a fifth of the viewport, so
 * the heading being edited is not the heading shown. On a document of nothing but prose
 * the two agree closely, which is exactly why this is easy to get wrong by testing on the
 * wrong document.
 *
 * Instead both panes are described as **anchors**: `(source line, pixel top)` pairs.
 * The editor's anchors come from measuring its own wrapped lines; the preview's come
 * from `data-src-line` stamped on every rendered block. Mapping a scroll position is
 * then: invert one pane's anchors to a fractional line, interpolate that line through
 * the other pane's anchors.
 */

export type Anchor = { line: number; top: number }

/**
 * Anchors sorted by line, with duplicates and non-monotonic tops dropped.
 *
 * Both are real: several blocks can report the same source line (a list and its first
 * item), and a rendered element inside a `position: relative` wrapper can report a
 * `top` below one that follows it. An unsorted or non-monotonic array makes the
 * interpolation below run backwards, which shows up as a preview that jumps upward
 * while the editor scrolls down.
 */
export function normalizeAnchors(anchors: Anchor[]): Anchor[] {
  const sorted = [...anchors].sort((a, b) => a.line - b.line || a.top - b.top)
  const out: Anchor[] = []
  for (const anchor of sorted) {
    const last = out[out.length - 1]
    if (last && last.line === anchor.line) continue
    if (last && anchor.top < last.top) continue
    out.push(anchor)
  }
  return out
}

/**
 * Pixel top for a (possibly fractional) source line.
 *
 * Outside the anchor range the nearest anchor's top is returned rather than an
 * extrapolation: extrapolating past the last heading of a long document produces
 * offsets far beyond `scrollHeight`, and the browser clamps them, so the pane sticks
 * at the bottom instead of tracking.
 */
export function topForLine(anchors: Anchor[], line: number): number {
  if (anchors.length === 0) return 0
  if (line <= anchors[0].line) return anchors[0].top
  const last = anchors[anchors.length - 1]
  if (line >= last.line) return last.top
  for (let i = 1; i < anchors.length; i++) {
    const b = anchors[i]
    if (b.line < line) continue
    const a = anchors[i - 1]
    const span = b.line - a.line
    if (span <= 0) return a.top
    return a.top + ((line - a.line) / span) * (b.top - a.top)
  }
  return last.top
}

/** The inverse: a fractional source line for a pixel top. */
export function lineForTop(anchors: Anchor[], top: number): number {
  if (anchors.length === 0) return 1
  if (top <= anchors[0].top) return anchors[0].line
  const last = anchors[anchors.length - 1]
  if (top >= last.top) return last.line
  for (let i = 1; i < anchors.length; i++) {
    const b = anchors[i]
    if (b.top < top) continue
    const a = anchors[i - 1]
    const span = b.top - a.top
    if (span <= 0) return a.line
    return a.line + ((top - a.top) / span) * (b.line - a.line)
  }
  return last.line
}

/**
 * Translate one pane's scroll position into the other's.
 *
 * The trailing clamp matters: the last screenful of a document has no anchors below
 * it, so a mapped offset would park the passive pane with content still hidden below
 * the fold. Clamping to `scrollHeight - clientHeight` means reaching the bottom of one
 * pane reaches the bottom of the other, which is the behaviour that makes the feature
 * feel like sync rather than like an approximation.
 */
export function mapScroll(
  from: { anchors: Anchor[]; scrollTop: number },
  to: { anchors: Anchor[]; scrollHeight: number; clientHeight: number }
): number {
  const line = lineForTop(from.anchors, from.scrollTop)
  const target = topForLine(to.anchors, line)
  return Math.max(0, Math.min(target, Math.max(0, to.scrollHeight - to.clientHeight)))
}

/**
 * Anchors for a textarea, from the measured pixel top of every source line.
 *
 * `lineTops[i]` is the top of line `i + 1` — lines are 1-based everywhere else in this
 * module because that is what mdast positions use, and mixing the two bases is the
 * kind of bug that shows up as "sync is off by one screenful near the end".
 */
export function anchorsFromLineTops(lineTops: number[]): Anchor[] {
  return lineTops.map((top, index) => ({ line: index + 1, top }))
}
