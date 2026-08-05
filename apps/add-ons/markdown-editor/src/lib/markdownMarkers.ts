/**
 * Selection-aware markdown formatting, as pure functions over `(text, selection)`.
 *
 * These exist as pure functions and not as textarea manipulation because every one
 * of them is an off-by-one waiting to happen, and the failure is silent: a bold
 * button that leaves the caret one character inside the marker feels broken without
 * ever throwing. The component does exactly two things with the result — assign
 * `value` and restore `selectionStart/End`.
 *
 * The rule that shapes all of them: **applying a marker to text that already has it
 * removes it**. A toolbar where bold only ever adds `**` produces `****text****`
 * within about four clicks.
 */

export type Selection = { start: number; end: number }

/** New text plus where the selection should land after the edit. */
export type EditResult = { text: string; start: number; end: number }

/** The selection with surrounding whitespace excluded. */
function trimSelection(text: string, sel: Selection): Selection {
  let { start, end } = sel
  while (start < end && /\s/.test(text[start])) start++
  while (end > start && /\s/.test(text[end - 1])) end--
  return { start, end }
}

/**
 * Wrap or unwrap the selection with an inline marker (`**`, `*`, `` ` ``, `~~`).
 *
 * Two unwrap cases, because the markers can be either side of the selection
 * boundary depending on how the user selected: `**|word|**` (double-click selects
 * the word, markers outside) and `|**word**|` (drag-selected the lot).
 *
 * An empty selection inserts the pair and puts the caret between them, so typing
 * continues inside the emphasis. It deliberately does NOT expand to the word under
 * the caret: silently formatting text the user never selected is worse than the one
 * extra double-click.
 */
export function toggleInline(text: string, sel: Selection, marker: string): EditResult {
  const { start, end } = trimSelection(text, sel)
  const len = marker.length

  if (start === end) {
    return {
      text: text.slice(0, start) + marker + marker + text.slice(start),
      start: start + len,
      end: start + len,
    }
  }

  // Markers sit just outside the selection.
  if (text.slice(start - len, start) === marker && text.slice(end, end + len) === marker) {
    return {
      text: text.slice(0, start - len) + text.slice(start, end) + text.slice(end + len),
      start: start - len,
      end: end - len,
    }
  }

  // Markers are inside the selection.
  const inner = text.slice(start, end)
  if (inner.length >= len * 2 && inner.startsWith(marker) && inner.endsWith(marker)) {
    const stripped = inner.slice(len, inner.length - len)
    return {
      text: text.slice(0, start) + stripped + text.slice(end),
      start,
      end: start + stripped.length,
    }
  }

  return {
    text: text.slice(0, start) + marker + inner + marker + text.slice(end),
    start: start + len,
    end: end + len,
  }
}

/** Character range of the whole lines covered by `sel`. */
function lineSpan(text: string, sel: Selection): { from: number; to: number } {
  const from = text.lastIndexOf('\n', Math.max(0, sel.start - 1)) + 1
  const nextBreak = text.indexOf('\n', sel.end)
  return { from, to: nextBreak === -1 ? text.length : nextBreak }
}

/**
 * Rewrite every line the selection touches, keeping the selection over the same
 * lines afterwards.
 *
 * `transform` receives each line and its 0-based index within the block; returning
 * the line unchanged is fine. Blank lines are passed through untouched — prefixing
 * them adds trailing `- ` and `> ` markers the user then has to delete.
 */
function mapLines(
  text: string,
  sel: Selection,
  transform: (line: string, index: number) => string
): EditResult {
  const { from, to } = lineSpan(text, sel)
  const lines = text.slice(from, to).split('\n')
  let index = 0
  const next = lines.map((line) => (line.trim() === '' ? line : transform(line, index++)))
  const joined = next.join('\n')
  return {
    text: text.slice(0, from) + joined + text.slice(to),
    start: from,
    end: from + joined.length,
  }
}

/** Leading whitespace of a line, preserved so nested list items stay nested. */
function indentOf(line: string): string {
  return /^\s*/.exec(line)?.[0] ?? ''
}

const BULLET = /^(\s*)[-*+] (.*)$/
const TASK = /^(\s*)[-*+] \[[ xX]\] (.*)$/
const ORDERED = /^(\s*)\d+\. (.*)$/
const QUOTE = /^(\s*)> ?(.*)$/
const HEADING = /^(#{1,6}) (.*)$/

/** `- ` on every line, or off it if every line already has it. */
export function toggleBullet(text: string, sel: Selection): EditResult {
  const { from, to } = lineSpan(text, sel)
  const body = text
    .slice(from, to)
    .split('\n')
    .filter((l) => l.trim() !== '')
  // A task list is a bullet list too, so "already bulleted" must not match one —
  // otherwise the bullet button silently strips the checkbox.
  const allBulleted = body.length > 0 && body.every((l) => BULLET.test(l) && !TASK.test(l))
  return mapLines(text, sel, (line) => {
    if (allBulleted) return line.replace(BULLET, '$1$2')
    const stripped = stripListMarkers(line)
    return `${indentOf(line)}- ${stripped}`
  })
}

/** `1.`, `2.`, … renumbered from one, or off. */
export function toggleOrdered(text: string, sel: Selection): EditResult {
  const { from, to } = lineSpan(text, sel)
  const body = text
    .slice(from, to)
    .split('\n')
    .filter((l) => l.trim() !== '')
  const allOrdered = body.length > 0 && body.every((l) => ORDERED.test(l))
  return mapLines(text, sel, (line, index) => {
    if (allOrdered) return line.replace(ORDERED, '$1$2')
    // Numbered from 1 rather than reusing whatever numbers were there: markdown
    // renumbers on render anyway, and `4. 5. 6.` in the source reads as a mistake.
    return `${indentOf(line)}${index + 1}. ${stripListMarkers(line)}`
  })
}

/** `- [ ] ` on every line, or off. Already-checked items keep their state. */
export function toggleTask(text: string, sel: Selection): EditResult {
  const { from, to } = lineSpan(text, sel)
  const body = text
    .slice(from, to)
    .split('\n')
    .filter((l) => l.trim() !== '')
  const allTasks = body.length > 0 && body.every((l) => TASK.test(l))
  return mapLines(text, sel, (line) => {
    if (allTasks) return line.replace(TASK, '$1$2')
    return `${indentOf(line)}- [ ] ${stripListMarkers(line)}`
  })
}

/** `> ` on every line, or off. */
export function toggleQuote(text: string, sel: Selection): EditResult {
  const { from, to } = lineSpan(text, sel)
  const body = text
    .slice(from, to)
    .split('\n')
    .filter((l) => l.trim() !== '')
  const allQuoted = body.length > 0 && body.every((l) => QUOTE.test(l))
  return mapLines(text, sel, (line) =>
    allQuoted ? line.replace(QUOTE, '$1$2') : `${indentOf(line)}> ${line.trimStart()}`
  )
}

/** The line's text with any list/task marker removed, so markers never stack. */
function stripListMarkers(line: string): string {
  const body = line.trimStart()
  return body
    .replace(/^[-*+] \[[ xX]\] /, '')
    .replace(/^[-*+] /, '')
    .replace(/^\d+\. /, '')
}

/**
 * Set the heading level of every line the selection touches, or clear it when the
 * lines are already at that level.
 *
 * Headings are exclusive, not additive: applying H2 to `# Title` must produce
 * `## Title`, never `## # Title`. That single detail is why this is not
 * `toggleLinePrefix('## ')`.
 */
export function setHeading(text: string, sel: Selection, level: 1 | 2 | 3 | 4 | 5 | 6): EditResult {
  const hashes = '#'.repeat(level)
  const { from, to } = lineSpan(text, sel)
  const body = text
    .slice(from, to)
    .split('\n')
    .filter((l) => l.trim() !== '')
  const allAtLevel = body.length > 0 && body.every((l) => HEADING.exec(l)?.[1].length === level)
  return mapLines(text, sel, (line) => {
    const bare = line.replace(HEADING, '$2').trimStart()
    return allAtLevel ? bare : `${hashes} ${bare}`
  })
}

/**
 * Flip the checkbox on one 1-based source line, for a click in the preview.
 *
 * Returns the text untouched when that line is not a task item — the click may have
 * landed on a list item whose checkbox belongs to a nested child, and quietly editing
 * the wrong line is worse than doing nothing.
 */
export function toggleTaskAtLine(text: string, line: number): string {
  const lines = text.split('\n')
  const index = line - 1
  if (index < 0 || index >= lines.length) return text
  const current = lines[index]
  const match = /^(\s*[-*+] \[)([ xX])(\].*)$/.exec(current)
  if (!match) return text
  const next = match[2] === ' ' ? 'x' : ' '
  return [
    ...lines.slice(0, index),
    `${match[1]}${next}${match[3]}`,
    ...lines.slice(index + 1),
  ].join('\n')
}

/** Does this look like something worth putting in the URL slot of a link? */
function looksLikeUrl(value: string): boolean {
  return /^(https?:\/\/|mailto:|\/|\.{1,2}\/)\S*$/.test(value.trim())
}

/**
 * Turn the selection into a link, guessing which half the user selected.
 *
 * Selecting a URL produces `[](url)` with the empty label selected; selecting words
 * produces `[words](url)` with the placeholder URL selected. Either way the next
 * thing typed replaces the part the user still has to supply, which is what makes
 * Ctrl+K worth pressing instead of typing the brackets.
 */
export function applyLink(text: string, sel: Selection): EditResult {
  const { start, end } = trimSelection(text, sel)
  const inner = text.slice(start, end)

  if (inner && looksLikeUrl(inner)) {
    const next = `[](${inner})`
    return { text: text.slice(0, start) + next + text.slice(end), start: start + 1, end: start + 1 }
  }

  const placeholder = 'https://'
  const label = inner || 'link'
  const next = `[${label}](${placeholder})`
  const urlAt = start + label.length + 3
  return {
    text: text.slice(0, start) + next + text.slice(end),
    start: urlAt,
    end: urlAt + placeholder.length,
  }
}

/**
 * Insert a block on its own lines, with blank lines around it.
 *
 * Without the padding a table or fence pasted at the end of a paragraph becomes
 * part of that paragraph and renders as literal pipes — the commonest way a
 * "insert table" button produces something that does not look like a table.
 */
function insertBlock(text: string, sel: Selection, block: string): { text: string; at: number } {
  const { from, to } = lineSpan(text, sel)
  const before = text.slice(0, from)
  const after = text.slice(to)
  const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const currentLine = text.slice(from, to)
  const keep = currentLine.trim() === '' ? '' : currentLine + '\n\n'
  // No trailing separator is needed: `to` is the end of a line, so `after` is either
  // empty or already starts with the newline that separates the block from what follows.
  const at = before.length + lead.length + keep.length
  return { text: before + lead + keep + block + after, at }
}

export const TABLE_SKELETON = ['| Column | Column |', '| --- | --- |', '|  |  |', '|  |  |'].join(
  '\n'
)

/** A GFM table skeleton, with the first header cell selected to type over. */
export function insertTable(text: string, sel: Selection): EditResult {
  const { text: next, at } = insertBlock(text, sel, TABLE_SKELETON)
  const firstCell = at + 2
  return { text: next, start: firstCell, end: firstCell + 'Column'.length }
}

/**
 * Wrap the selection in a fenced code block, or unwrap one.
 *
 * With nothing selected the caret lands on the info string, because the first thing
 * anyone does after opening a fence is say which language it is.
 */
export function toggleFence(text: string, sel: Selection): EditResult {
  const { from, to } = lineSpan(text, sel)
  const block = text.slice(from, to)
  const lines = block.split('\n')
  if (lines.length >= 2 && /^```/.test(lines[0]) && /^```\s*$/.test(lines[lines.length - 1])) {
    const inner = lines.slice(1, -1).join('\n')
    return {
      text: text.slice(0, from) + inner + text.slice(to),
      start: from,
      end: from + inner.length,
    }
  }

  // The fence lines can also sit just OUTSIDE the selection — which is exactly the state
  // this function leaves behind, since fencing selects the code and not the fences.
  // Without this case the button is add-only and produces nested fences on a second press.
  const prevFrom = from > 0 ? text.lastIndexOf('\n', from - 2) + 1 : -1
  const prevLine = prevFrom >= 0 ? text.slice(prevFrom, from - 1) : null
  const nextFrom = to < text.length ? to + 1 : -1
  const nextTo =
    nextFrom >= 0
      ? text.indexOf('\n', nextFrom) === -1
        ? text.length
        : text.indexOf('\n', nextFrom)
      : -1
  const nextLine = nextFrom >= 0 ? text.slice(nextFrom, nextTo) : null
  if (
    prevLine !== null &&
    nextLine !== null &&
    /^```/.test(prevLine) &&
    /^```\s*$/.test(nextLine)
  ) {
    return {
      text: text.slice(0, prevFrom) + block + text.slice(nextTo),
      start: prevFrom,
      end: prevFrom + block.length,
    }
  }
  if (block.trim() === '') {
    const { text: next, at } = insertBlock(text, sel, '```\n\n```')
    return { text: next, start: at + 3, end: at + 3 }
  }
  const fenced = '```\n' + block + '\n```'
  return {
    text: text.slice(0, from) + fenced + text.slice(to),
    start: from + 4,
    end: from + 4 + block.length,
  }
}
