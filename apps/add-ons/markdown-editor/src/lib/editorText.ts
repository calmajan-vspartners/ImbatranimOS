/** Small shared bits of editor bookkeeping. */

/**
 * 1-based line number for a caret offset.
 *
 * 1-based because every heading position, mdast node and compiler error is — mixing the
 * two bases is how an outline highlights the entry above the one you are typing in.
 */
export function caretLineOf(text: string, caret: number): number {
  const clamped = Math.max(0, Math.min(text.length, Number.isFinite(caret) ? caret : 0))
  let line = 1
  for (let i = 0; i < clamped; i++) {
    if (text[i] === '\n') line++
  }
  return line
}

/** Image types the insert-image picker offers, matching File Manager's routing table. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'] as const
