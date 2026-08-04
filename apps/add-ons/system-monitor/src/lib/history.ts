/**
 * A fixed-size history of samples, and the SVG path for drawing it.
 *
 * ## Why history at all
 *
 * Every gauge in the app rendered a single instant, so the Overview could not answer
 * the one question anyone opens a system monitor to ask: *is this getting worse?* A
 * spike between two 1.5s polls was invisible.
 *
 * ## Why client-side and ephemeral
 *
 * 120 samples at 1.5s is about three minutes, held in the window and gone when it
 * closes. That is the honest scope: nothing is recording while the app is shut, so
 * persisting would imply a continuity that does not exist. It also needs no backend
 * storage and no charting dependency — a `polyline` is enough for a sparkline, and
 * adding a chart library for three of them fails the lightweight test.
 */

export const HISTORY_LENGTH = 120

/** Append to a bounded history, dropping the oldest sample when full. */
export function pushSample(history: number[], value: number, limit = HISTORY_LENGTH): number[] {
  // A non-finite reading would render as a gap in the path and then poison the
  // scale; treat it as 0, which is what an unreadable gauge means here.
  const safe = Number.isFinite(value) ? value : 0
  const next = history.length >= limit ? history.slice(history.length - limit + 1) : history.slice()
  next.push(safe)
  return next
}

/**
 * `points` for an SVG `<polyline>` over a 0–100 series.
 *
 * Returns an empty string for fewer than two samples: a one-point polyline draws
 * nothing anyway, and emitting a degenerate path makes a blank sparkline look like a
 * rendering bug rather than "not enough data yet".
 *
 * The y axis is inverted (SVG grows downward) and the scale is fixed to 0–100 rather
 * than auto-fitted. Auto-fitting is the tempting choice and the wrong one: it makes
 * idle noise look like a crisis, because a series wobbling between 0.1% and 0.4%
 * would fill the whole box. A fixed scale means the shape of the line carries real
 * information.
 */
export function sparklinePoints(history: number[], width: number, height: number): string {
  if (history.length < 2 || width <= 0 || height <= 0) return ''
  const stepX = width / (history.length - 1)
  return history
    .map((value, i) => {
      const clamped = Math.max(0, Math.min(100, value))
      const x = i * stepX
      const y = height - (clamped / 100) * height
      // Two decimals: enough for sub-pixel smoothness, short enough that a
      // 120-point path stays a reasonable attribute length.
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

/** Bytes/sec as a short human string, for the network row. */
export function formatRate(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec < 0) return '—'
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
}

/**
 * Does this process name or pid match the filter?
 *
 * Case-insensitive on the name, and a pure-digit query also matches a pid prefix so
 * typing `12` finds pid 1234 — which is how you use a pid you half-remember from a
 * log line.
 */
export function matchesFilter(process: { name: string; pid: number }, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (process.name.toLowerCase().includes(q)) return true
  return /^\d+$/.test(q) && String(process.pid).startsWith(q)
}
