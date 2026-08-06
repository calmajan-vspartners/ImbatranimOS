import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'

/**
 * The value `useVirtualList` returns — re-exported so add-ons can type the
 * virtualizer as a prop without deep-importing `@tanstack/react-virtual`.
 */
export type VirtualList<TItemElement extends Element = HTMLElement> = Virtualizer<
  HTMLElement,
  TItemElement
>

type UseVirtualListArgs = {
  /** Number of rows in the (already-sorted) source array. */
  count: number
  /** Returns the scroll container element, or null before it mounts. */
  getScrollElement: () => HTMLElement | null
  /** Per-row height estimate; rows are re-measured once mounted. Defaults to 32px. */
  estimateSize?: (index: number) => number
  /** Rows to render beyond the visible window. Defaults to 8. */
  overscan?: number
  /**
   * Pixels of non-virtualized content before the list inside the same scroll
   * container (e.g. a table header). Keeps `scrollToIndex`/positions accurate.
   */
  scrollMargin?: number
}

/**
 * Thin wrapper around TanStack's `useVirtualizer` that pins the two defaults we
 * want everywhere (a sane `estimateSize` and `overscan≈8`) and narrows the
 * option surface to what our lists actually pass. It returns the virtualizer
 * untouched, so consumers get `getVirtualItems`/`getTotalSize` for rendering,
 * `scrollToIndex` for keyboard nav, and `measureElement` for dynamic heights.
 */
export function useVirtualList<TItemElement extends Element = HTMLElement>({
  count,
  getScrollElement,
  estimateSize,
  overscan = 8,
  scrollMargin = 0,
}: UseVirtualListArgs): Virtualizer<HTMLElement, TItemElement> {
  // TanStack's virtualizer manages its own subscriptions and drives re-renders
  // itself; the compiler's "incompatible library" advisory doesn't apply to how
  // we consume it (React Compiler isn't enabled in the build).
  // eslint-disable-next-line react-hooks/incompatible-library
  return useVirtualizer<HTMLElement, TItemElement>({
    count,
    getScrollElement,
    estimateSize: estimateSize ?? (() => 32),
    overscan,
    scrollMargin,
  })
}
