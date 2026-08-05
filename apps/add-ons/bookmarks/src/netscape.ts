/**
 * Netscape bookmark-file HTML: reader and writer.
 *
 * This is the format **every** browser exports and imports — Chrome, Firefox, Edge,
 * Safari — so it is the interop argument CSV is for Sheets and ICS is for Calendar:
 * without it, adopting this app means retyping a bookmark tree by hand, and the data
 * is trapped once it is in.
 *
 * Hand-rolled, no dependency, per the brief. Two reasons beyond the repo's
 * dependency rule:
 *
 * 1. `DOMParser` would be more robust in the browser but untestable in the `node`
 *    environment every add-on's vitest uses, and this is exactly the code that needs
 *    tests — the input is a file written by someone else's software.
 * 2. The format is *not* real HTML. Browsers emit unclosed `<DT>` and stray `<p>`,
 *    and nesting is expressed by `<DL>` depth rather than by containment. A tolerant
 *    tag scanner models that better than a spec-compliant parser, which would have
 *    to be talked out of "fixing" the markup.
 *
 * Times, icons and tags are deliberately dropped. `ADD_DATE` has nowhere to live in
 * this model, and `ICON` is a base64 favicon — the brief's no-favicons decision
 * (until brief 50's proxy exists) applies to imported ones too, and inlining a few
 * hundred KB of base64 into SQLite for decoration is not a trade worth making.
 */

export type ParsedLink = { title: string; url: string }

export type ParsedFolder = {
  name: string
  links: ParsedLink[]
  folders: ParsedFolder[]
}

export type ParseResult = {
  folders: ParsedFolder[]
  /** Links at the very top level, outside any folder. */
  looseLinks: ParsedLink[]
  /** Bookmarks skipped because the URL was not http(s) — javascript:, place:, etc. */
  skipped: number
  /** Folders past MAX_DEPTH, flattened into their deepest allowed ancestor. */
  flattened: number
}

/**
 * How deep a folder tree may nest.
 *
 * Firefox's exports include machine-generated depth, and a hostile file could nest
 * thousands deep purely to blow a stack. Real trees are ~5 deep; 20 is generous and
 * the excess is flattened rather than dropped, so no bookmark is lost to the limit.
 */
export const MAX_DEPTH = 20

/** Only what the app can actually open, and what the backend DTO will accept. */
function usableUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (parsed.hostname === '') return null
  return trimmed
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/**
 * Decode the entities a browser actually writes.
 *
 * `&amp;` last would double-decode (`&amp;lt;` → `<`), so numeric and named forms are
 * handled in one pass over the source instead of a chain of replaces.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match
    }
    return ENTITIES[body.toLowerCase()] ?? match
  })
}

function encodeEntities(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Strip any nested markup out of a title, e.g. `<A ...><B>bold</B></A>`. */
function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).trim()
}

/** Pull an attribute out of a tag, single or double quoted, case-insensitive. */
function attr(tag: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag)
  if (match) return match[2] ?? match[3] ?? null
  // Unquoted, which Safari has been known to emit for HREF.
  const bare = new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, 'i').exec(tag)
  return bare ? bare[1] : null
}

/**
 * The tokens worth noticing, in one alternation.
 *
 * `<H3>` and `<A>` capture their **whole body up to the closing tag**, so nested
 * markup (`<A ...><B>Bold</B> title</A>`, which browsers do emit) yields the full
 * title rather than the empty string before the first inner tag. The close is
 * optional — terminating on the next `<DT>`/`<DL>`/`</DL>` too, because this format
 * is not required to be well formed and Safari has shipped unclosed anchors.
 *
 * `<DT>` is deliberately not a token: it is never closed and carries no information
 * the `<H3>`/`<A>` inside it does not.
 */
const TOKENS =
  /<dl\b[^>]*>|<\/dl\s*>|<h3\b([^>]*)>([\s\S]*?)(?:<\/h3\s*>|(?=<dt\b)|(?=<\/?dl\b))|<a\b([^>]*)>([\s\S]*?)(?:<\/a\s*>|(?=<dt\b)|(?=<\/?dl\b))/gi

/** One open `<DL>`. `folder` is where children go; `counts` is false for the root list. */
type Frame = { folder: ParsedFolder; counts: boolean }

/**
 * Parse a bookmark file into a folder tree.
 *
 * Driven by `<DL>` / `</DL>` depth rather than by matching `<DT>` pairs, because
 * `<DT>` is never closed in this format. A folder is `<H3>name</H3>` followed by the
 * `<DL>` that opens next; a bookmark is `<A HREF=...>title</A>`.
 *
 * Depth is counted in **folders**, not in open `<DL>`s. The outermost `<DL>` and any
 * `<DL>` with no `<H3>` before it add a stack frame without adding a level, so
 * measuring the stack would charge the file for structure the user never sees.
 */
export function parseNetscape(html: string): ParseResult {
  const root: ParsedFolder = { name: '', links: [], folders: [] }
  const stack: Frame[] = [{ folder: root, counts: false }]
  // The folder the next `<DL>` should open, set by the `<H3>` just before it.
  let pending: ParsedFolder | null = null
  let depth = 0
  let skipped = 0
  let flattened = 0

  const current = () => stack[stack.length - 1].folder

  TOKENS.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TOKENS.exec(html)) !== null) {
    const text = match[0]

    if (/^<\/dl/i.test(text)) {
      // Never pop the root: a file with an extra `</DL>` (Safari adds one) must not
      // start attaching bookmarks above the tree.
      if (stack.length > 1) {
        if (stack[stack.length - 1].counts) depth -= 1
        stack.pop()
      }
      continue
    }

    if (/^<dl/i.test(text)) {
      if (pending === null) {
        // The outermost list, or one with no heading — stay where we are so its
        // children land here rather than in an invented folder.
        stack.push({ folder: current(), counts: false })
      } else if (depth < MAX_DEPTH) {
        current().folders.push(pending)
        stack.push({ folder: pending, counts: true })
        depth += 1
      } else {
        // Too deep: keep the bookmarks by folding this folder's contents into the
        // deepest allowed ancestor rather than dropping them.
        flattened += 1
        stack.push({ folder: current(), counts: false })
      }
      pending = null
      continue
    }

    if (/^<h3/i.test(text)) {
      pending = { name: textOf(match[2] ?? '') || 'Untitled folder', links: [], folders: [] }
      continue
    }

    // <A>
    const href = attr(match[3] ?? '', 'href')
    const url = href === null ? null : usableUrl(decodeEntities(href))
    if (url === null) {
      skipped += 1
      continue
    }
    current().links.push({ title: textOf(match[4] ?? '') || url, url })
  }

  return { folders: root.folders, looseLinks: root.links, skipped, flattened }
}

/** A human sentence about an import, so the result is never a silent partial. */
export function describeImport(result: {
  folders: number
  links: number
  skipped: number
  flattened: number
}): string {
  const parts = [
    `${result.links} bookmark${result.links === 1 ? '' : 's'}`,
    `${result.folders} folder${result.folders === 1 ? '' : 's'}`,
  ]
  let text = `Imported ${parts.join(' in ')}.`
  if (result.skipped > 0) {
    text += ` ${result.skipped} skipped (not a web address).`
  }
  if (result.flattened > 0) {
    text += ` ${result.flattened} deeply nested folder${
      result.flattened === 1 ? '' : 's'
    } flattened.`
  }
  return text
}

/**
 * Write a bookmark file any browser will import.
 *
 * The `<!DOCTYPE NETSCAPE-Bookmark-file-1>` line is what browsers sniff for, and the
 * `<DL><p>` / `</DL><p>` shape is what they expect to see — this writes the format
 * back the way Chrome writes it rather than the tidiest HTML, because the consumer
 * is another importer, not a renderer.
 */
export function toNetscape(folders: ParsedFolder[], looseLinks: ParsedLink[] = []): string {
  const out: string[] = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file.',
    '     It will be read and overwritten.',
    '     DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ]

  const indent = (depth: number) => '    '.repeat(depth + 1)

  const writeLinks = (links: ParsedLink[], depth: number) => {
    for (const link of links) {
      out.push(
        `${indent(depth)}<DT><A HREF="${encodeEntities(link.url)}">${encodeEntities(link.title)}</A>`
      )
    }
  }

  const writeFolder = (folder: ParsedFolder, depth: number) => {
    out.push(`${indent(depth)}<DT><H3>${encodeEntities(folder.name)}</H3>`)
    out.push(`${indent(depth)}<DL><p>`)
    writeLinks(folder.links, depth + 1)
    for (const child of folder.folders) writeFolder(child, depth + 1)
    out.push(`${indent(depth)}</DL><p>`)
  }

  writeLinks(looseLinks, 0)
  for (const folder of folders) writeFolder(folder, 0)
  out.push('</DL><p>', '')
  return out.join('\n')
}
