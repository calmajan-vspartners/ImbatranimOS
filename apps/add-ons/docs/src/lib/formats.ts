/**
 * What Docs can open, and how it says no.
 *
 * The engine is SuperDoc, which reads `.docx` and nothing else. Before brief 62
 * an `.odt` reached the engine and failed there, so an unsupported file looked
 * like a broken app. Refusing up front, by name, is the whole point: the user
 * learns what the app reads instead of what it crashed on.
 *
 * Deliberately not a converter. Reading `.doc`/`.odt`/`.rtf` means a large
 * dependency for a rare case, and the OS's identity is a slim image.
 */

/** Formats a user might reasonably expect a word processor to open. */
const KNOWN_WORD_FORMATS: Record<string, string> = {
  doc: 'Word 97-2003 (.doc)',
  dot: 'Word 97-2003 template (.dot)',
  odt: 'OpenDocument Text (.odt)',
  ott: 'OpenDocument template (.ott)',
  rtf: 'Rich Text Format (.rtf)',
  pages: 'Apple Pages (.pages)',
  wpd: 'WordPerfect (.wpd)',
}

/** Formats another app in the OS owns — point at it rather than just refusing. */
const OTHER_APPS: Record<string, string> = {
  txt: 'Notepad',
  log: 'Notepad',
  md: 'Markdown Editor',
  markdown: 'Markdown Editor',
  pdf: 'PDF Viewer',
  xlsx: 'Sheets',
  xls: 'Sheets',
  csv: 'Sheets',
  pptx: 'Slides',
  ppt: 'Slides',
}

/** Lowercase extension of a path, without the dot (empty when there is none). */
export function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? path
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

/**
 * The reason Docs will not open `path`, or null when it will.
 *
 * One message, phrased so it always answers "then what does this app read?" —
 * a refusal that does not say that is just a dead end with better manners.
 */
export function unsupportedReason(path: string): string | null {
  const ext = extensionOf(path)
  if (ext === 'docx') return null

  const known = KNOWN_WORD_FORMATS[ext]
  if (known) return `${known} is not supported. Docs reads .docx files.`

  const other = OTHER_APPS[ext]
  if (other) return `.${ext} files open in ${other}. Docs reads .docx files.`

  if (!ext) return 'This file has no extension. Docs reads .docx files.'
  return `.${ext} is not supported. Docs reads .docx files.`
}
