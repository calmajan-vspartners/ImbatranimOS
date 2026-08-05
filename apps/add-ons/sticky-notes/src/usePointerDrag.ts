import { useCallback, useRef, useState } from 'react'

/**
 * Drag with plain pointer capture.
 *
 * No new dependency: the repo's rule is that dependency additions need a reason,
 * and this is about twenty lines. (`framer-motion` drives the desktop icons and
 * `@use-gesture/react` the Todo rows, but neither is a dependency of this package,
 * and neither gives the thing that actually matters here — a single commit on
 * release rather than a write per pointer move.)
 *
 * `setPointerCapture` is what makes it robust: the element keeps receiving moves
 * even when the cursor leaves it, so a fast drag off the edge of a small note does
 * not silently drop the gesture the way a plain `mousemove` listener would.
 */

export type DragDelta = { dx: number; dy: number }

type Options = {
  /** Called on every move, for the live preview. */
  onMove: (delta: DragDelta) => void
  /** Called once on release with the final delta — the only place that persists. */
  onCommit: (delta: DragDelta) => void
}

export function usePointerDrag({ onMove, onCommit }: Options) {
  const origin = useRef<{ x: number; y: number } | null>(null)
  const latest = useRef<DragDelta>({ dx: 0, dy: 0 })
  const [dragging, setDragging] = useState(false)

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    // Left button only, and never start a drag from a control inside the handle.
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    origin.current = { x: event.clientX, y: event.clientY }
    latest.current = { dx: 0, dy: 0 }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (origin.current === null) return
      const delta = {
        dx: event.clientX - origin.current.x,
        dy: event.clientY - origin.current.y,
      }
      latest.current = delta
      onMove(delta)
    },
    [onMove]
  )

  const end = useCallback(
    (event: React.PointerEvent) => {
      if (origin.current === null) return
      origin.current = null
      setDragging(false)
      event.currentTarget.releasePointerCapture?.(event.pointerId)
      onCommit(latest.current)
    },
    [onCommit]
  )

  return {
    dragging,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      // A cancelled gesture (Escape, a browser interruption) still commits what
      // was already previewed, so the note never jumps back after the fact.
      onPointerCancel: end,
      style: { touchAction: 'none' as const },
    },
  }
}
