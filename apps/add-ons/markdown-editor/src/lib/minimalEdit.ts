/**
 * The smallest replacement that turns one string into another.
 *
 * Needed because of how a textarea's undo stack works. Assigning `textarea.value` — which
 * is what a React state update does — **clears the browser's undo history for that
 * element**. So a toolbar that produced its result by setting state would silently cost
 * the user every undo step they had accumulated: press Bold, and Ctrl+Z can no longer
 * take back the paragraph typed a minute ago.
 *
 * Applying the change as a selection plus `insertText` instead keeps the edit inside the
 * browser's own undo stack, so Ctrl+Z undoes the formatting and then keeps going. That
 * requires knowing the exact span that changed, which is what this computes.
 */

export type MinimalEdit = {
  /** Start of the replaced span in the original string. */
  start: number
  /** End of the replaced span in the original string. */
  end: number
  /** Text to put in its place — empty for a pure deletion. */
  insert: string
}

export function minimalEdit(before: string, after: string): MinimalEdit {
  if (before === after) return { start: 0, end: 0, insert: '' }

  let prefix = 0
  const maxPrefix = Math.min(before.length, after.length)
  while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix++

  let suffix = 0
  const maxSuffix = maxPrefix - prefix
  while (
    suffix < maxSuffix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++
  }

  return {
    start: prefix,
    end: before.length - suffix,
    insert: after.slice(prefix, after.length - suffix),
  }
}
