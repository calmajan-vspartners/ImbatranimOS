import { useEffect, useRef } from 'react'
import { cn } from '@imbatranim/ui'

/**
 * A rail of real slide thumbnails.
 *
 * The thumbnails are **clones of the rendered slides**, scaled with a CSS
 * transform. That is exact by construction — a thumbnail cannot disagree with
 * the slide it stands for — and it costs no second parse of the deck, which is
 * the expensive part (pptx-preview rebuilds everything from OpenXML on each
 * `preview()` call).
 *
 * Cloned nodes are inert: `pointer-events: none` and `aria-hidden`, so a link or
 * a form control inside a slide cannot be reached from the rail, and screen
 * readers announce the button rather than a duplicate of the slide's whole text.
 */
export function ThumbnailRail({
  count,
  getSlide,
  current,
  onSelect,
  width = 132,
}: {
  /** How many slides the deck has. */
  count: number
  /**
   * The live rendered element for a slide, or undefined if it is not there.
   *
   * A getter rather than an array of nodes: the elements live in a ref (they are
   * DOM owned by the renderer, not React state), and reading a ref during render
   * — including to pass it as a prop — is exactly what React forbids. Asking for
   * the node inside the cloning effect is both legal and the more honest
   * contract: the rail wants it at the moment it is about to use it.
   */
  getSlide: (index: number) => HTMLElement | undefined
  current: number
  onSelect: (index: number) => void
  width?: number
}) {
  return (
    <div className="border-outline-variant bg-surface-container-low w-[152px] shrink-0 overflow-y-auto border-r">
      <div className="flex flex-col gap-2 p-2">
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Slide ${i + 1}`}
            aria-current={i === current}
            onClick={() => onSelect(i)}
            className={cn(
              'group relative block w-full overflow-hidden border text-left',
              'focus-visible:ring-primary outline-none focus-visible:ring-2',
              i === current
                ? 'border-primary'
                : 'border-outline-variant hover:border-on-surface-variant'
            )}
          >
            <Thumb index={i} getSlide={getSlide} width={width} />
            <span
              className={cn(
                'font-ui absolute right-0 bottom-0 px-1 text-[10px] tabular-nums',
                i === current
                  ? 'bg-primary text-on-primary'
                  : 'bg-inverse-surface text-inverse-on-surface'
              )}
            >
              {i + 1}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * One scaled clone.
 *
 * Cloned in an effect rather than during render: it touches the DOM of a node
 * this component does not own, which is exactly what effects are for. Re-cloned
 * when `getSlide` changes identity — i.e. when a new deck is rendered — and not
 * on every scroll or selection.
 */
function Thumb({
  index,
  getSlide,
  width,
}: {
  index: number
  getSlide: (index: number) => HTMLElement | undefined
  width: number
}) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    const slide = getSlide(index)
    if (!host || !slide) return
    const naturalWidth = slide.offsetWidth || slide.scrollWidth || width
    const naturalHeight = slide.offsetHeight || slide.scrollHeight || Math.round(width * 0.5625)
    const scale = width / naturalWidth

    const clone = slide.cloneNode(true) as HTMLElement
    clone.setAttribute('aria-hidden', 'true')
    clone.style.transform = `scale(${scale})`
    clone.style.transformOrigin = 'top left'
    clone.style.pointerEvents = 'none'
    host.style.height = `${Math.round(naturalHeight * scale)}px`
    host.replaceChildren(clone)

    return () => host.replaceChildren()
  }, [index, getSlide, width])

  return <div ref={hostRef} className="bg-surface-container-lowest w-full overflow-hidden" />
}
