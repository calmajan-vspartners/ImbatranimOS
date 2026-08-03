/**
 * The one rule that decides whether a document stops being dirty.
 *
 * It is extracted from the save handler on purpose. "Never clear the dirty flag
 * unless the write actually succeeded" (brief 62) is the difference between the
 * user being told they lost work and the user losing it silently, and an
 * invariant that important should be a function with tests rather than the shape
 * of a try/catch — which is easy to refactor into a `finally` by accident, and
 * that one-line mistake clears the flag on failure.
 *
 * Two conditions, both required:
 *
 * 1. **The upload resolved.** A rejected write means the bytes are not on disk,
 *    so the document still differs from it and the close guard must stay armed.
 * 2. **No edit landed mid-flight.** Export runs before upload, so an edit made
 *    while the request is in flight is not in the bytes that were sent. The
 *    document is genuinely still dirty even though the save succeeded.
 */
export function shouldClearDirty(outcome: {
  /** True only when the upload promise resolved. */
  uploaded: boolean
  /** Engine edit counter sampled before the export. */
  editCountBefore: number
  /** Engine edit counter sampled after the upload resolved. */
  editCountAfter: number
}): boolean {
  if (!outcome.uploaded) return false
  return outcome.editCountAfter === outcome.editCountBefore
}
