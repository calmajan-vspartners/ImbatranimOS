import { sparklinePoints } from '../lib/history'

/**
 * A history trace, as inline SVG.
 *
 * No charting dependency: this is a `polyline` over a 0–100 series, and pulling in a
 * chart library for three sparklines fails the lightweight test the OS is built on.
 *
 * `preserveAspectRatio="none"` with a fixed viewBox is what lets the same 0–100
 * geometry stretch to whatever width the gauge has, so nothing has to measure the
 * container.
 */
export function Sparkline({
  history,
  label,
}: {
  history: number[]
  /** For the accessible name — a bare trace is meaningless to a screen reader. */
  label: string
}) {
  const W = 200
  const H = 28
  const points = sparklinePoints(history, W, H)

  if (!points) {
    // Not enough samples yet. Said out loud rather than rendering an empty box,
    // which reads as a broken component.
    return (
      <div className="border-outline-variant bg-surface-container-lowest text-on-surface-variant flex h-[28px] items-center justify-center border font-mono text-[9px]">
        collecting…
      </div>
    )
  }

  const latest = history[history.length - 1]
  const peak = Math.max(...history)

  return (
    <div className="border-outline-variant bg-surface-container-lowest relative border">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-[28px] w-full"
        role="img"
        aria-label={`${label} over the last ${history.length} samples: now ${latest.toFixed(0)} percent, peak ${peak.toFixed(0)} percent`}
      >
        {/* A 50% guide, so the eye has a reference without needing axis labels. */}
        <line
          x1="0"
          y1={H / 2}
          x2={W}
          y2={H / 2}
          className="stroke-outline-variant"
          strokeWidth="0.5"
          strokeDasharray="2 3"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={points}
          fill="none"
          className="stroke-primary"
          strokeWidth="1.5"
          // Without this, the horizontal stretch would thin the stroke to nothing on
          // a wide window — the visible symptom of `preserveAspectRatio="none"`.
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="text-on-surface-variant absolute top-0.5 right-1 font-mono text-[8px]">
        peak {peak.toFixed(0)}%
      </span>
    </div>
  )
}
