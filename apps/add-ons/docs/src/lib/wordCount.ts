/**
 * Word and character counts for a document.
 *
 * Counted from the editor's rendered text rather than its docx XML, because that
 * is what the user can see — a count that includes deleted tracked-changes text
 * or a field's raw code disagrees with the page in front of them.
 *
 * Word-splitting is a judgement call in every word processor, so the rules here
 * are explicit rather than incidental:
 *
 * - **Any run of whitespace is one separator**, including the newlines between
 *   paragraphs. Word counts "a\n\nb" as two words and so does this.
 * - **Hyphenated and apostrophised words are one word.** "well-known" is one, and
 *   so is "don't" — treating the punctuation as a separator would inflate the
 *   count on ordinary English prose.
 * - **A standalone punctuation run is not a word.** A line containing only "—"
 *   has no words in it, which is what Word reports too.
 * - **Characters are counted as code points, not UTF-16 units.** An emoji or a
 *   CJK extension character is one character to a reader, and `.length` says two.
 */

export type Counts = {
  words: number
  /** Every character, including spaces. */
  characters: number
  /** Characters excluding whitespace — the figure a style guide usually means. */
  charactersNoSpaces: number
}

/**
 * A token counts as a word if it contains at least one letter, digit, or any
 * non-ASCII character that is not punctuation or a symbol. The `\p{…}` classes
 * do the work so this holds for scripts without Latin letters.
 */
const WORDISH = /[\p{L}\p{N}]/u

export function countText(text: string): Counts {
  const normalized = text ?? ''
  const tokens = normalized.split(/\s+/).filter((t) => t !== '')
  return {
    words: tokens.filter((t) => WORDISH.test(t)).length,
    characters: [...normalized].length,
    charactersNoSpaces: [...normalized.replace(/\s/g, '')].length,
  }
}

/**
 * Plain text from an editor's HTML.
 *
 * Block-level tags become newlines first, so paragraphs do not run together into
 * a single word at the boundary ("endBegin"). Done with a real parser rather than
 * a tag-stripping regex: the HTML comes from the document, and a regex that
 * mangles an attribute containing `>` would silently change the count.
 */
export function htmlToText(html: string): string {
  if (typeof DOMParser === 'undefined') {
    // Node (tests): a conservative fallback that still separates blocks.
    return html
      .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
  }
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const el of doc.body.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, tr, br')) {
    el.after(doc.createTextNode('\n'))
  }
  return doc.body.textContent ?? ''
}
