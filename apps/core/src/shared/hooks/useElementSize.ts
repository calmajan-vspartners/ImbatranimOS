import { useCallback, useState } from 'react'

export type ElementSize = { width: number; height: number }

/**
 * Measure an element's content box, live.
 *
 * Returns `[size, ref]` — spread the ref onto the element you want measured:
 *
 * ```tsx
 * const [viewport, attachViewport] = useElementSize()
 * return <div ref={attachViewport} />
 * ```
 *
 * ## Why this is a hook and not four copies of a `useEffect`
 *
 * Three apps had written the same thing by hand, and **all three were broken the
 * same way**:
 *
 * ```tsx
 * useEffect(() => {
 *   const el = scrollRef.current
 *   if (!el) return              // ← on the first commit it IS null…
 *   observer.observe(el)
 * }, [])                         // ← …and `[]` means this never runs again
 * ```
 *
 * Every one of those apps early-returns an "Nothing open" tree while its open
 * intent is still being drained (`useOpenIntent` consumes it in an effect, so the
 * first render always has no source). The measured element therefore does not
 * exist on the first commit, the effect bails, and with `[]` deps it is never
 * retried. The size stayed at its initial value for the window's entire life.
 *
 * That was not cosmetic in any of the three:
 *
 * - **Image Viewer** — "Fit to window" never fit anything; every image displayed
 *   at 100% and a large photo was cropped by the frame. A 1×1 GIF also reported
 *   itself pannable, since anything is wider than a zero-width viewport.
 * - **PDF Viewer** — `containerWidth` stayed `null`, so `fitWidth && containerWidth`
 *   was falsy and "Fit width" silently fell back to 100% zoom.
 * - **Slides** — the fit target was `{0, 0}`, so its Fit button was a no-op.
 *
 * A **ref callback** fixes the class outright: React invokes it whenever the node
 * attaches, however many renders later that is, and runs the returned cleanup when
 * it detaches. There is no dependency array to get wrong.
 *
 * The box is also seeded synchronously from `getBoundingClientRect()` on attach.
 * `ResizeObserver` does fire once on `observe()`, but that lands a frame later —
 * seeding means the very first paint is already at the right scale instead of
 * flashing at the fallback one.
 */
/**
 * The ref callback's own type. It really does return a cleanup — typing it as
 * `void` would compile at the call site (React accepts either) but would silently
 * drop the `disconnect()` for anyone composing it with a second ref, which Slides
 * does.
 */
export type ElementSizeRef = (el: HTMLElement | null) => void | (() => void)

export function useElementSize(): [ElementSize, ElementSizeRef] {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 })

  /**
   * Write only on a real change.
   *
   * Not an optimisation — it is what stops an unstable ref identity from freezing
   * the app. React re-runs a ref callback (cleanup, then attach) on **every render**
   * when the callback is a fresh closure, e.g. an inline `ref={(el) => …}` composing
   * this with another ref. If attach unconditionally set state, that state change
   * would trigger the next render, which would re-run the ref, which would set state
   * again: an infinite loop, and React 19 reports it only as minified error #185
   * from a blank screen. Measured — it happened in the File Manager.
   *
   * A stable identity is still the right thing for callers to pass (wrap a composed
   * ref in `useCallback`), but the hook must not be a footgun when they don't.
   */
  const apply = useCallback((next: ElementSize) => {
    setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next))
  }, [])

  const ref = useCallback<ElementSizeRef>(
    (el) => {
      if (!el) {
        // Deliberately keeps the last known box rather than zeroing. Zeroing was
        // the original behaviour and it is worse twice over: it is half of the
        // render loop described above, and on a detach-then-reattach (a view-mode
        // switch that remounts the pane) it makes every consumer flash through its
        // "not measured yet" fallback scale for a frame.
        return
      }
      const rect = el.getBoundingClientRect()
      apply({ width: rect.width, height: rect.height })
      const observer = new ResizeObserver((entries) => {
        const box = entries[0]?.contentRect
        if (box) apply({ width: box.width, height: box.height })
      })
      observer.observe(el)
      return () => observer.disconnect()
    },
    [apply]
  )

  return [size, ref]
}
