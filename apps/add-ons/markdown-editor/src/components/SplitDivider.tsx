import { useCallback, useState } from 'react'
import { cn } from '@imbatranim/core'
import { MAX_RATIO, MIN_RATIO } from '../store/markdownViewStore'

/**
 * The draggable boundary between editor and preview.
 *
 * Listeners go on `window`, not on the handle: a mouse moving faster than the handle
 * follows leaves the element, and a handle-scoped `mousemove` would drop the drag
 * mid-gesture — the classic "the divider stops following the pointer if you move
 * quickly" bug.
 *
 * It is also a real `separator` widget: focusable, with arrow keys moving it in 2%
 * steps. A divider that only responds to a precise 4-pixel drag is not usable by
 * everyone, and the keyboard path costs six lines.
 */
export function SplitDivider({
  ratio,
  containerWidth,
  onDrag,
  onCommit,
}: {
  ratio: number
  /** Width of the pane container, to turn pixel deltas into a ratio. */
  containerWidth: number
  onDrag: (ratio: number) => void
  onCommit: () => void
}) {
  const [dragging, setDragging] = useState(false)

  const onMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      if (containerWidth <= 0) return
      const startX = event.clientX
      const startRatio = ratio
      setDragging(true)

      const onMove = (move: MouseEvent) => {
        onDrag(startRatio + (move.clientX - startX) / containerWidth)
      }
      const onUp = () => {
        setDragging(false)
        onCommit()
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [containerWidth, onCommit, onDrag, ratio]
  )

  const nudge = useCallback(
    (delta: number) => {
      onDrag(ratio + delta)
      onCommit()
    },
    [onCommit, onDrag, ratio]
  )

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize editor and preview"
      aria-valuemin={Math.round(MIN_RATIO * 100)}
      aria-valuemax={Math.round(MAX_RATIO * 100)}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      onMouseDown={onMouseDown}
      onDoubleClick={() => nudge(0.5 - ratio)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          nudge(-0.02)
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          nudge(0.02)
        }
        if (event.key === 'Home') {
          event.preventDefault()
          nudge(0.5 - ratio)
        }
      }}
      className={cn(
        'border-outline-variant w-[5px] shrink-0 cursor-col-resize border-x',
        'focus:outline-primary focus:outline focus:outline-1',
        dragging ? 'bg-primary' : 'bg-surface-container-low hover:bg-surface-container-high'
      )}
    />
  )
}
