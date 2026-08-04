/**
 * Find and replace over a plain string, plus the caret maths for the status bar.
 *
 * Deliberately NOT an editor engine. Code Editor already exists for anything
 * richer; Notepad's whole value is that it is instant and dependency-free, and
 * find/replace over `value` + `selectionStart` is a contained amount of work.
 *
 * Pure functions with tests because every one of these has an off-by-one or an
 * infinite loop waiting in it, and the failure modes are silent: a replace-all that
 * misses the last match, or a search that hangs the tab.
 */

export type Match = { start: number; end: number }

/**
 * Every occurrence of `query` in `text`.
 *
 * Plain substring search, not regex: the query comes from a text input, and a user
 * typing `(` into a find box must not get a syntax error — nor should `.` match
 * every character. Code Editor is where regex search belongs.
 *
 * The empty query returns nothing rather than "a match at every position", which is
 * what a naive `indexOf('')` loop produces — and which would report
 * `text.length + 1` matches the instant the find bar opens.
 */
export function findMatches(text: string, query: string, caseSensitive: boolean): Match[] {
  if (!query) return []
  const haystack = caseSensitive ? text : text.toLowerCase()
  const needle = caseSensitive ? query : query.toLowerCase()
  const out: Match[] = []
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) break
    out.push({ start: at, end: at + needle.length })
    // Advance by the needle length, so matches do not overlap: searching "aa" in
    // "aaaa" finds 2, not 3. Advancing by 1 would also make a 1-char query O(n²).
    from = at + needle.length
  }
  return out
}

/**
 * The index of the match to jump to from a caret position.
 *
 * Wraps in both directions — a find bar that stops at the last match and does
 * nothing more looks broken. Returns -1 when there is nothing to jump to.
 */
export function matchIndexFrom(matches: Match[], caret: number, direction: 1 | -1): number {
  if (matches.length === 0) return -1
  if (direction === 1) {
    const at = matches.findIndex((m) => m.start >= caret)
    return at === -1 ? 0 : at
  }
  for (let i = matches.length - 1; i >= 0; i--) {
    if (matches[i].end <= caret) return i
  }
  return matches.length - 1
}

/** Replace one span, returning the new text and where the caret should land. */
export function replaceRange(
  text: string,
  match: Match,
  replacement: string
): { text: string; caret: number } {
  return {
    text: text.slice(0, match.start) + replacement + text.slice(match.end),
    // After the inserted text, so a subsequent "find next" moves forward rather
    // than finding the replacement again (which, if the replacement contains the
    // query, is an infinite replace loop).
    caret: match.start + replacement.length,
  }
}

/**
 * Replace every occurrence, and report how many.
 *
 * Built by scanning the ORIGINAL string and assembling a new one, rather than
 * repeatedly replacing in place. In-place replacement re-searches text that already
 * contains the replacement, so replacing `a` with `aa` never terminates.
 */
export function replaceAll(
  text: string,
  query: string,
  replacement: string,
  caseSensitive: boolean
): { text: string; count: number } {
  const matches = findMatches(text, query, caseSensitive)
  if (matches.length === 0) return { text, count: 0 }
  let out = ''
  let cursor = 0
  for (const m of matches) {
    out += text.slice(cursor, m.start) + replacement
    cursor = m.end
  }
  out += text.slice(cursor)
  return { text: out, count: matches.length }
}

/**
 * 1-based line and column for a caret offset.
 *
 * 1-based because that is what every editor and every compiler error says; a status
 * bar reading "Ln 0, Col 0" would not match anything the user could cross-reference.
 */
export function caretPosition(text: string, caret: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(text.length, Number.isFinite(caret) ? caret : 0))
  const before = text.slice(0, clamped)
  const lastBreak = before.lastIndexOf('\n')
  return {
    line: before.split('\n').length,
    // The caret sits AFTER the newline that starts the line, so column 1 is the
    // first character of that line.
    column: clamped - lastBreak,
  }
}

/** Character and word counts for the status bar. */
export function textStats(text: string): { chars: number; words: number; lines: number } {
  const trimmed = text.trim()
  return {
    // Code points, not UTF-16 units, so an emoji counts as one character rather
    // than two — the same reasoning as Docs' word count.
    chars: [...text].length,
    words: trimmed === '' ? 0 : trimmed.split(/\s+/).length,
    lines: text === '' ? 1 : text.split('\n').length,
  }
}
