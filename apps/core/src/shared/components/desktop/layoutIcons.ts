export const ICON_WIDTH = 64
export const ICON_HEIGHT = 80
export const GRID_GAP = 16
export const PADDING = 16

export type Point = { x: number; y: number }

/**
 * Place desktop icons in columns, top to bottom, wrapping into a new column.
 *
 * Replaces a fixed `Math.floor(index / 8)`, which assumed eight rows always
 * fit. Eight rows need 8 × (80 + 16) = 768px, but the desktop layer is only
 * `viewportHeight - 44` tall and is `overflow-hidden`, so on a 577px-tall
 * viewport rows six through eight were simply gone — and with them the only way
 * to launch those apps.
 *
 * Two further rules matter:
 *
 * - Placement is driven by the list of icons **actually rendered**. The old
 *   code enumerated the whole registry, including `settings`, which is never
 *   drawn on the desktop — so its index left a permanent hole in the grid.
 * - Cells occupied by pinned (user-dragged) icons are skipped, so auto-placed
 *   icons can never be laid on top of one.
 *
 * Pure, so it is testable without a DOM.
 */
export function layoutIcons(
  appIds: string[],
  pinned: Record<string, Point>,
  viewport: { width: number; height: number }
): Record<string, Point> {
  const stride = ICON_HEIGHT + GRID_GAP
  const usableHeight = Math.max(0, viewport.height - PADDING * 2)
  const rows = Math.max(1, Math.floor((usableHeight + GRID_GAP) / stride))

  // Cells already claimed by a user-placed icon, so auto placement skips them.
  const taken = new Set<string>()
  for (const pos of Object.values(pinned)) {
    const col = Math.round((pos.x - PADDING) / (ICON_WIDTH + GRID_GAP))
    const row = Math.round((pos.y - PADDING) / stride)
    if (col >= 0 && row >= 0) taken.add(`${col},${row}`)
  }

  const out: Record<string, Point> = {}
  let cursor = 0
  for (const appId of appIds) {
    if (pinned[appId]) continue
    let col = Math.floor(cursor / rows)
    let row = cursor % rows
    while (taken.has(`${col},${row}`)) {
      cursor++
      col = Math.floor(cursor / rows)
      row = cursor % rows
    }
    taken.add(`${col},${row}`)
    out[appId] = {
      x: PADDING + col * (ICON_WIDTH + GRID_GAP),
      y: PADDING + row * stride,
    }
    cursor++
  }
  return out
}
