import { useCallback, useEffect, useState } from 'react'

/**
 * The pixel top of every source line inside a soft-wrapping textarea.
 *
 * This is the missing half of scroll sync. Mapping the preview's scroll position to a
 * source line is easy — the rendered blocks carry `data-src-line`. Going the other way
 * is not: a textarea exposes `scrollTop` and nothing else. `line * lineHeight` is only
 * right when no line wraps, and in a prose document nearly every paragraph wraps, so
 * that estimate drifts by whole screenfuls halfway down a README.
 *
 * So the lines are measured, using the technique caret-position libraries use: a mirror
 * element that copies the textarea's font, padding and content width, holding one block
 * per source line. Each block wraps exactly as the textarea wraps that line, which makes
 * `child.offsetTop` the line's real top in scroll coordinates.
 *
 * Measuring is O(lines) and only happens on a debounce or a resize, never per keystroke.
 */

/**
 * Above this, sync is turned off instead of measured.
 *
 * A mirror for a 10k-line file means 10k layout boxes rebuilt on every debounce tick,
 * which is exactly the kind of cost that makes an editor feel heavy — and a document
 * that long is being read, not co-edited against a preview.
 */
export const MAX_SYNC_LINES = 4000

/** Properties the mirror must share with the textarea for wrapping to match. */
const COPIED_STYLES = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'textIndent',
  'wordSpacing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'tabSize',
  'overflowWrap',
  'wordBreak',
] as const

function buildMirror(source: HTMLTextAreaElement): HTMLDivElement {
  const mirror = document.createElement('div')
  const computed = window.getComputedStyle(source)
  for (const key of COPIED_STYLES) {
    mirror.style[key] = computed[key]
  }
  mirror.style.position = 'absolute'
  mirror.style.top = '0'
  mirror.style.left = '0'
  mirror.style.visibility = 'hidden'
  mirror.style.pointerEvents = 'none'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.boxSizing = 'border-box'
  mirror.style.border = 'none'
  mirror.setAttribute('aria-hidden', 'true')
  return mirror
}

function measureTops(source: HTMLTextAreaElement, mirror: HTMLDivElement): number[] {
  // `clientWidth` excludes the border AND any scrollbar, so it is the same content box
  // the textarea wraps inside — the one measurement that must not be approximated.
  mirror.style.width = `${source.clientWidth}px`
  const lines = source.value.split('\n')
  mirror.replaceChildren(
    ...lines.map((line) => {
      const block = document.createElement('div')
      // An empty div collapses to zero height; a zero-width space gives it exactly one
      // line box, which is what the textarea shows for a blank line.
      block.textContent = line === '' ? '​' : line
      return block
    })
  )
  return [...mirror.children].map((child) => (child as HTMLElement).offsetTop)
}

/**
 * Measured line tops for `textarea`, or an empty array when sync is off or the document
 * is too long to measure.
 *
 * `text` is a dependency rather than the source of the measurement: the value is read
 * off the DOM node, so a stale render can never measure text the textarea is not
 * actually showing.
 */
export function useLineTops(
  textarea: HTMLTextAreaElement | null,
  text: string,
  enabled: boolean
): number[] {
  const [lineTops, setLineTops] = useState<number[]>([])

  const measure = useCallback(() => {
    if (!textarea || !enabled) return
    if (textarea.value.split('\n').length > MAX_SYNC_LINES) {
      setLineTops((prev) => (prev.length === 0 ? prev : []))
      return
    }
    const mirror = buildMirror(textarea)
    document.body.append(mirror)
    try {
      const next = measureTops(textarea, mirror)
      setLineTops((prev) =>
        prev.length === next.length && prev.every((top, i) => top === next[i]) ? prev : next
      )
    } finally {
      mirror.remove()
    }
  }, [textarea, enabled])

  // Width changes rewrap every line, so the observer is the primary trigger — and it
  // fires once on observe, which covers the initial measurement too. State is written
  // from the observer callback, not from the effect body.
  useEffect(() => {
    if (!textarea || !enabled) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    })
    observer.observe(textarea)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [textarea, enabled, measure])

  // Typing changes the tops of every line below the caret. Debounced, because measuring
  // on each keystroke would rebuild the mirror hundreds of times a minute for a gain
  // nobody can perceive.
  useEffect(() => {
    if (!textarea || !enabled) return
    const timer = setTimeout(measure, 200)
    return () => clearTimeout(timer)
  }, [text, textarea, enabled, measure])

  return lineTops
}
