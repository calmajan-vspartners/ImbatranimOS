/**
 * Path arithmetic for images: resolving the relative links a markdown file already
 * contains, and choosing where a pasted image should be written.
 *
 * This is the part of "it's a real OS with a real filesystem" that a markdown editor
 * can actually deliver — but only if relative links resolve. A README that says
 * `![](docs/shot.png)` is the normal case, not the exotic one, and until these
 * functions existed the preview asked the *web origin* for `docs/shot.png` and drew a
 * broken image.
 */

/** The directory part of a path, or `''` at the root. */
export function dirOf(path: string): string {
  const at = path.lastIndexOf('/')
  return at === -1 ? '' : path.slice(0, at)
}

/** True for anything that is not a path inside this filesystem. */
export function isRemote(src: string): boolean {
  // Any scheme (`https:`, `data:`, `mailto:`) or a protocol-relative `//host/…`.
  return /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')
}

/**
 * Resolve a link from a document, or `null` when it does not name a file in this root.
 *
 * `null` for remote URLs, in-page anchors, and — the case that matters — anything that
 * climbs out of the root with `..`. The backend's `resolveSafe` would refuse such a
 * path anyway; refusing to *build* the request keeps a document full of `../../..`
 * links from firing a burst of 400s just by being previewed.
 */
export function resolveRelative(docDir: string, src: string): string | null {
  if (src === '' || src.startsWith('#') || isRemote(src)) return null
  const raw = decodeURI(src.split('#')[0].split('?')[0])
  // A leading slash means "root of this filesystem", not "root of the web origin".
  const base = raw.startsWith('/') ? '' : docDir
  const parts = base === '' ? [] : base.split('/')
  for (const segment of raw.replace(/^\//, '').split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return parts.length === 0 ? null : parts.join('/')
}

/** Path of `target` expressed relative to `fromDir`, for writing back into the source. */
export function relativeFrom(fromDir: string, target: string): string {
  if (fromDir === '') return target
  if (target === fromDir) return '.'
  if (target.startsWith(fromDir + '/')) return target.slice(fromDir.length + 1)
  const from = fromDir.split('/')
  const to = target.split('/')
  let shared = 0
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared++
  return [...Array(from.length - shared).fill('..'), ...to.slice(shared)].join('/')
}

/**
 * Where a pasted image should land: a sibling `assets/` directory if the document
 * already keeps its images there, otherwise beside the document.
 *
 * Reusing an existing `assets/` rather than always creating one is the difference
 * between fitting into someone's repo layout and imposing a new one on it.
 */
export function assetDir(docDir: string, hasAssetsDir: boolean): string {
  if (!hasAssetsDir) return docDir
  return docDir === '' ? 'assets' : `${docDir}/assets`
}

/** Strip a filename down to something safe to write and pleasant to read. */
export function safeBaseName(raw: string): string {
  const withoutExt = raw.replace(/\.[^.]+$/, '')
  const cleaned = withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned === '' ? 'image' : cleaned.slice(0, 40)
}

/** Extension for a pasted blob, from its MIME type. */
export function extensionForMime(mime: string): string {
  const known: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
  }
  return known[mime] ?? 'png'
}

/**
 * A name not already taken in the target directory.
 *
 * Silently overwriting `image.png` because that is what the clipboard blob was called
 * would destroy a file the user never mentioned — and pasted screenshots are *always*
 * called `image.png`.
 */
export function uniqueName(existing: readonly string[], base: string, ext: string): string {
  const taken = new Set(existing.map((name) => name.toLowerCase()))
  const first = `${base}.${ext}`
  if (!taken.has(first.toLowerCase())) return first
  for (let n = 1; n < 1000; n++) {
    const candidate = `${base}-${n}.${ext}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return `${base}-${Date.now()}.${ext}`
}

/** The image markdown to insert, with the spaces a link cannot carry escaped. */
export function imageMarkdown(alt: string, relativePath: string): string {
  return `![${alt}](${relativePath.replace(/ /g, '%20')})`
}
