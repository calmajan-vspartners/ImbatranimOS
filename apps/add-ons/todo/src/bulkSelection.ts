/**
 * The bulk selection, confined to what the user can currently see.
 *
 * Bulk Delete / Complete run over a Set of selected todo ids. A filter or list
 * switch (or a reload) changes which rows are visible, so a selection made under
 * one view can carry ids for rows the user can no longer see — and a bulk Delete
 * would then destroy tasks off-screen, which is the data-loss this guards against
 * (M2). Pruning the selection to the visible ids keeps the actions, and the
 * "N selected" count, honest.
 */

/** The selection with every id that is not currently visible removed. */
export function pruneSelection(
  selected: ReadonlySet<number>,
  visibleIds: ReadonlySet<number>
): Set<number> {
  const next = new Set<number>()
  for (const id of selected) if (visibleIds.has(id)) next.add(id)
  return next
}

/** True when the selection holds at least one id that is no longer visible. */
export function hasHiddenSelection(
  selected: ReadonlySet<number>,
  visibleIds: ReadonlySet<number>
): boolean {
  for (const id of selected) if (!visibleIds.has(id)) return true
  return false
}
