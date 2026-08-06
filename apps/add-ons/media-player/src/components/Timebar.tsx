import { useCallback, useRef, useState } from 'react'
import { cn } from '@imbatranim/ui'
import { formatTime } from '../lib/formatTime'

type TimebarProps = {
  currentTime: number
  duration: number
  /** Buffered ranges as [start, end] pairs, in seconds. */
  buffered: [number, number][]
  disabled: boolean
  onSeek: (time: number) => void
}

/**
 * A VLC-style scrub bar.
 *
 * Replaces a native `<input type="range">`, which could not show what is
 * buffered and gave no read-out of the time under the cursor. Pointer capture
 * means a drag keeps tracking after the pointer leaves the bar — the thing that
 * makes scrubbing feel right, and the thing a range input does not do when the
 * pointer exits vertically.
 *
 * Keeps `role="slider"` semantics so it stays keyboard- and screen-reader
 * usable; the arrow keys are handled by the app's media hotkeys.
 */
export function Timebar({ currentTime, duration, buffered, disabled, onSeek }: TimebarProps) {
  const barRef = useRef<HTMLDivElement>(null)
  // The hover TIME, not the x — computing it during render would mean reading
  // barRef.current there, which React forbids. Pointer handlers may read refs.
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)

  const seekable = duration > 0 && Number.isFinite(duration)
  const pct = seekable ? Math.min(100, (currentTime / duration) * 100) : 0

  const timeAt = useCallback(
    (clientX: number): number => {
      const el = barRef.current
      if (!el || !seekable) return 0
      const r = el.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
      return ratio * duration
    },
    [duration, seekable]
  )

  return (
    <div className="relative flex-1">
      {hoverTime !== null && seekable && (
        <div
          className="border-outline-variant bg-inverse-surface text-inverse-on-surface font-ui pointer-events-none absolute -top-6 z-10 border px-1 py-0.5 text-[10px] tabular-nums"
          style={{
            left: `${Math.min(100, Math.max(0, (hoverTime / duration) * 100))}%`,
            transform: 'translateX(-50%)',
          }}
        >
          {formatTime(hoverTime)}
        </div>
      )}

      <div
        ref={barRef}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={seekable ? duration : 0}
        aria-valuenow={currentTime}
        aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
        aria-disabled={disabled || !seekable}
        tabIndex={disabled || !seekable ? -1 : 0}
        className={cn(
          'group relative h-4 w-full cursor-pointer',
          'focus-visible:ring-primary outline-none focus-visible:ring-2',
          (disabled || !seekable) && 'cursor-default opacity-50'
        )}
        onPointerDown={(e) => {
          if (disabled || !seekable) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setDragging(true)
          onSeek(timeAt(e.clientX))
        }}
        onPointerMove={(e) => {
          if (disabled || !seekable) return
          const t = timeAt(e.clientX)
          setHoverTime(t)
          if (dragging) onSeek(t)
        }}
        onPointerUp={(e) => {
          if (dragging) {
            e.currentTarget.releasePointerCapture(e.pointerId)
            setDragging(false)
          }
        }}
        onPointerLeave={() => setHoverTime(null)}
      >
        {/* track */}
        <div className="bg-surface-container-high absolute top-1/2 h-1.5 w-full -translate-y-1/2">
          {/* buffered ranges sit behind the played range */}
          {seekable &&
            buffered.map(([start, end], i) => (
              <div
                key={`${start}-${end}-${i}`}
                className="bg-outline absolute top-0 h-full"
                style={{
                  left: `${(start / duration) * 100}%`,
                  width: `${((end - start) / duration) * 100}%`,
                }}
              />
            ))}
          <div className="bg-primary absolute top-0 h-full" style={{ width: `${pct}%` }} />
        </div>
        {/* thumb */}
        <div
          className="bg-primary pointer-events-none absolute top-1/2 h-3 w-1.5 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  )
}
