import { getExtension } from './fileKind'

/**
 * Which desktop app opens which file type, by lowercase extension.
 *
 * This is the single source of truth for double-click / Enter routing in the
 * file manager. Brief 20 (Sheets/Docs editors) extends it by adding entries
 * here — nothing else in the file manager needs to change.
 *
 * `onlyRoots` gates an entry to specific FS roots. Notepad reads the Notes root
 * only (it is not root-aware), so text files route to it just from `notes`.
 * The viewers (PDF Viewer, Slides) are root-aware — they receive `{ root }` in
 * the open payload and fetch bytes via the authed download endpoint — so they
 * carry no `onlyRoots` and open from any root.
 */
export type OpenWithRule = {
  appId: string
  /** If set, this rule only applies when the file lives under one of these roots. */
  onlyRoots?: string[]
}

const NOTEPAD_ONLY_NOTES: OpenWithRule = { appId: 'notepad', onlyRoots: ['notes'] }
const IMAGE_VIEWER: OpenWithRule = { appId: 'image-viewer' }
const MEDIA_PLAYER: OpenWithRule = { appId: 'media-player' }
const MARKDOWN_EDITOR: OpenWithRule = { appId: 'markdown-editor' }
const CODE_EDITOR: OpenWithRule = { appId: 'code-editor' }

export const EXTENSION_APP_MAP: Record<string, OpenWithRule> = {
  // Markdown → Markdown Editor (root-aware, live preview; upgrades the old
  // notes-only Notepad route for `md`).
  md: MARKDOWN_EDITOR,
  markdown: MARKDOWN_EDITOR,
  // Plain text → Notepad (Notes root only)
  txt: NOTEPAD_ONLY_NOTES,
  log: NOTEPAD_ONLY_NOTES,
  // Code → Code Editor (Monaco; root-aware, any root — upgrades the old
  // notes-only Notepad route for these).
  json: CODE_EDITOR,
  ts: CODE_EDITOR,
  tsx: CODE_EDITOR,
  js: CODE_EDITOR,
  jsx: CODE_EDITOR,
  css: CODE_EDITOR,
  html: CODE_EDITOR,
  sh: CODE_EDITOR,
  py: CODE_EDITOR,
  c: CODE_EDITOR,
  cpp: CODE_EDITOR,
  h: CODE_EDITOR,
  hpp: CODE_EDITOR,
  go: CODE_EDITOR,
  rs: CODE_EDITOR,
  java: CODE_EDITOR,
  rb: CODE_EDITOR,
  php: CODE_EDITOR,
  yaml: CODE_EDITOR,
  yml: CODE_EDITOR,
  toml: CODE_EDITOR,
  xml: CODE_EDITOR,
  sql: CODE_EDITOR,
  // Documents → viewers (any root).
  //
  // `.pdf` goes to **norPDF**, not the small PDF Viewer (brief 65). norPDF is a
  // strict superset — outline, thumbnails, search, annotate, forms, page
  // organise, and a real save path — and while the default pointed at the
  // 340-line viewer, those 3886 lines were reachable only by launching the app
  // from the desktop, which almost nobody does. PDF Viewer stays in the tree as
  // the deliberately light option (measured: ~1.2s faster to first page, a
  // fraction of the bytes); brief 81's "Open with ▸" is how a user picks it.
  pdf: { appId: 'norpdf' },
  pptx: { appId: 'slides' },
  ppt: { appId: 'slides' },
  // Office editors → Sheets / Docs (any root; root-aware like the viewers)
  xlsx: { appId: 'sheets' },
  // CSV was not mapped at all, so double-clicking one did nothing — a dead end
  // on the most common interchange format a spreadsheet app has (brief 63).
  csv: { appId: 'sheets' },
  xls: { appId: 'sheets' },
  docx: { appId: 'docs' },
  // Images → Image Viewer (any root; root-aware)
  png: IMAGE_VIEWER,
  jpg: IMAGE_VIEWER,
  jpeg: IMAGE_VIEWER,
  gif: IMAGE_VIEWER,
  webp: IMAGE_VIEWER,
  bmp: IMAGE_VIEWER,
  svg: IMAGE_VIEWER,
  avif: IMAGE_VIEWER,
  ico: IMAGE_VIEWER,
  // Audio/Video → Media Player (any root; native range-streamed)
  mp3: MEDIA_PLAYER,
  wav: MEDIA_PLAYER,
  ogg: MEDIA_PLAYER,
  oga: MEDIA_PLAYER,
  flac: MEDIA_PLAYER,
  m4a: MEDIA_PLAYER,
  aac: MEDIA_PLAYER,
  opus: MEDIA_PLAYER,
  mp4: MEDIA_PLAYER,
  webm: MEDIA_PLAYER,
  ogv: MEDIA_PLAYER,
  mov: MEDIA_PLAYER,
  m4v: MEDIA_PLAYER,
  mkv: MEDIA_PLAYER,
}

/**
 * The app id that should open `fileName` from `root`, or null if nothing is
 * registered (or the registered app isn't available from this root).
 */
export function resolveOpenApp(root: string, fileName: string): string | null {
  const rule = EXTENSION_APP_MAP[getExtension(fileName)]
  if (!rule) return null
  if (rule.onlyRoots && !rule.onlyRoots.includes(root)) return null
  return rule.appId
}

/** Human label for the "Open" context-menu item, given the resolved app id. */
export function openAppLabel(appId: string | null): string {
  switch (appId) {
    case 'notepad':
      return 'Open in Notepad'
    case 'pdf-viewer':
      return 'Open in PDF Viewer'
    case 'norpdf':
      return 'Open in norPDF'
    case 'slides':
      return 'Open in Slides'
    case 'sheets':
      return 'Open in Sheets'
    case 'docs':
      return 'Open in Docs'
    case 'markdown-editor':
      return 'Open in Markdown Editor'
    case 'code-editor':
      return 'Open in Code Editor'
    case 'image-viewer':
      return 'Open in Image Viewer'
    case 'media-player':
      return 'Open in Media Player'
    default:
      return 'Open'
  }
}
