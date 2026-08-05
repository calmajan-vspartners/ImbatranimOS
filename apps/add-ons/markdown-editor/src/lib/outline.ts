/**
 * Heading extraction from markdown source, for the outline rail and for anchor links.
 *
 * Parsed from the source rather than read out of the rendered DOM: the outline has to
 * work in editor-only mode, where nothing is rendered at all, and it has to know the
 * *source* line of each heading to scroll the textarea to it.
 *
 * The one thing a naive `/^#+ /` scan gets wrong — and it gets it wrong on almost
 * every real README — is `#` inside a fenced code block. A shell snippet full of
 * comments would fill the outline with garbage.
 */

export type Heading = {
  /** 1–6. */
  level: number
  /** Display text, with inline markup flattened. */
  title: string
  /** 1-based source line, matching mdast positions. */
  line: number
  /** Character offset of the start of the line, for caret placement. */
  offset: number
  /** GitHub-style anchor slug, so `[](#some-heading)` links resolve. */
  slug: string
}

/** Opening/closing fence, allowing the ≤3 spaces of indent CommonMark permits. */
const FENCE = /^ {0,3}(```+|~~~+)(.*)$/

/**
 * Flatten inline markup so the outline reads as words.
 *
 * Link *labels* are kept and their URLs dropped — an outline entry reading
 * `See [the spec](https://…)` would be mostly punctuation.
 */
export function plainTitle(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .trim()
}

/**
 * GitHub's heading anchor rule: lowercase, drop anything that is not a word
 * character, space or hyphen, then spaces become hyphens.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]+/gu, '')
    .trim()
    .replace(/\s+/g, '-')
}

/** Make repeated slugs unique the way GitHub does: `-1`, `-2`, … */
function uniqueSlug(base: string, seen: Map<string, number>): string {
  const used = seen.get(base)
  if (used === undefined) {
    seen.set(base, 0)
    return base
  }
  const next = used + 1
  seen.set(base, next)
  return `${base}-${next}`
}

/** Every ATX heading outside fenced code, in source order. */
export function parseHeadings(text: string): Heading[] {
  const out: Heading[] = []
  const seen = new Map<string, number>()
  let offset = 0
  // The open fence's marker character and length. Length matters: CommonMark closes a
  // fence only with one at least as long, so the ``` inside a ```` block is content.
  let fence: { char: string; length: number } | null = null

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fenceMatch = FENCE.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (fence === null) {
        // An opening fence carries an info string; a closing one must not.
        fence = { char: marker[0], length: marker.length }
      } else if (
        marker[0] === fence.char &&
        marker.length >= fence.length &&
        fenceMatch[2].trim() === ''
      ) {
        fence = null
      }
    } else if (fence === null) {
      const heading = /^ {0,3}(#{1,6})(?:\s+(.*))?$/.exec(line)
      if (heading) {
        // Closed ATX headings (`## Title ##`) carry trailing hashes that are
        // syntax, not text.
        const raw = (heading[2] ?? '').replace(/\s+#+\s*$/, '')
        const title = plainTitle(raw)
        if (title !== '') {
          out.push({
            level: heading[1].length,
            title,
            line: i + 1,
            offset,
            slug: uniqueSlug(slugify(title), seen),
          })
        }
      }
    }
    offset += line.length + 1
  }
  return out
}
