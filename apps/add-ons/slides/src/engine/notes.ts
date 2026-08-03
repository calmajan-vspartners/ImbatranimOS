/**
 * Speaker notes, read from the `.pptx` package.
 *
 * `pptx-preview` reconstructs slides for display and does not surface notes at
 * all, so they come from the file itself. A deck carries them in
 * `ppt/notesSlides/notesSlideN.xml`, and — this is the part worth getting right —
 * **N does not match the slide number**. python-pptx and PowerPoint both
 * allocate notes parts only for slides that have notes, so a deck whose slides
 * 1, 2, 4 and 5 have notes produces `notesSlide1..4`. Indexing notes by slide
 * number would show slide 4 the note belonging to slide 5.
 *
 * The only correct route is the one the format specifies:
 *
 *   `ppt/presentation.xml` → `<p:sldIdLst>` gives slide ORDER as r:ids
 *   `ppt/_rels/presentation.xml.rels` resolves each r:id to a slide part
 *   `ppt/slides/_rels/slideN.xml.rels` resolves that slide's notesSlide part
 *
 * Showing the wrong note is worse than showing none, which is why this follows
 * the relationships instead of the filenames.
 *
 * Uses fflate's **synchronous** API: the async one spawns a `blob:` worker that
 * this OS's CSP refuses (brief 62 — it hung Docs forever), and a notes parse is
 * a few milliseconds behind the render overlay anyway.
 */

/** Resolve a rels `Target` against the part that declared it. */
function resolveTarget(fromPart: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const base = fromPart.split('/').slice(0, -1)
  const segments = target.split('/')
  for (const seg of segments) {
    if (seg === '.' || seg === '') continue
    if (seg === '..') base.pop()
    else base.push(seg)
  }
  return base.join('/')
}

/** `{ rId: resolvedPartName }` from a `.rels` part. */
function relMap(fromPart: string, xml: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const tag of xml.match(/<Relationship\b[^>]*\/?>/g) ?? []) {
    const id = /\bId="([^"]+)"/.exec(tag)?.[1]
    const target = /\bTarget="([^"]*)"/.exec(tag)?.[1]
    const mode = /\bTargetMode="([^"]*)"/.exec(tag)?.[1]
    // External targets are URLs, not parts.
    if (!id || !target || mode === 'External') continue
    out[id] = resolveTarget(fromPart, target)
  }
  return out
}

/** The rels part that describes `part`. */
function relsPathFor(part: string): string {
  const segments = part.split('/')
  const file = segments.pop() as string
  return [...segments, '_rels', `${file}.rels`].join('/')
}

const NOTES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide'

/**
 * Visible text of a notesSlide, as one string.
 *
 * `<a:t>` runs carry the words; paragraph boundaries become newlines. The slide
 * number placeholder is dropped — it renders as a stray digit that reads like
 * part of the note.
 */
function notesText(xml: string): string {
  // Body shapes only: the slide-number placeholder lives in a shape whose
  // `<p:ph type="sldNum"/>` marks it, and it is the one thing in a notesSlide
  // that is not the speaker's words.
  const shapes = xml.split(/<p:sp[\s>]/).slice(1)
  const paragraphs: string[] = []
  for (const shape of shapes) {
    if (/<p:ph\b[^>]*type="sldNum"/.test(shape)) continue
    for (const para of shape.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? []) {
      const runs = para.match(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g) ?? []
      const text = runs.map((r) => /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/.exec(r)?.[1] ?? '').join('')
      paragraphs.push(decodeXml(text))
    }
  }
  // Trailing empty paragraphs are layout, not content.
  while (paragraphs.length && paragraphs[paragraphs.length - 1].trim() === '') paragraphs.pop()
  return paragraphs.join('\n').trim()
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
}

/**
 * Speaker notes in slide order — one entry per slide, `''` where a slide has
 * none. Returns `[]` if the package cannot be read, because notes are an extra
 * and must never be the reason a deck fails to open.
 */
export async function extractNotes(bytes: ArrayBuffer): Promise<string[]> {
  try {
    const { unzipSync, strFromU8 } = await import('fflate')
    const files = unzipSync(new Uint8Array(bytes))
    const read = (part: string): string | null => (files[part] ? strFromU8(files[part]) : null)

    const presentation = read('ppt/presentation.xml')
    const presentationRels = read('ppt/_rels/presentation.xml.rels')
    if (!presentation || !presentationRels) return []

    const rels = relMap('ppt/presentation.xml', presentationRels)
    // Slide ORDER, which is the sldIdLst and not the filenames.
    const slideIds = presentation.match(/<p:sldId\b[^>]*\/?>/g) ?? []

    const notes: string[] = []
    for (const tag of slideIds) {
      const rId = /\br:id="([^"]+)"/.exec(tag)?.[1]
      const slidePart = rId ? rels[rId] : undefined
      if (!slidePart) {
        notes.push('')
        continue
      }
      const slideRels = read(relsPathFor(slidePart))
      if (!slideRels) {
        notes.push('')
        continue
      }
      // Find the notesSlide relationship by TYPE, not by guessing a filename.
      const notesTag = (slideRels.match(/<Relationship\b[^>]*\/?>/g) ?? []).find((t) =>
        t.includes(NOTES_REL)
      )
      const target = notesTag ? /\bTarget="([^"]*)"/.exec(notesTag)?.[1] : undefined
      const notesPart = target ? resolveTarget(slidePart, target) : undefined
      const notesXml = notesPart ? read(notesPart) : null
      notes.push(notesXml ? notesText(notesXml) : '')
    }
    return notes
  } catch {
    // A deck that will not unzip is the render path's problem to report.
    return []
  }
}
