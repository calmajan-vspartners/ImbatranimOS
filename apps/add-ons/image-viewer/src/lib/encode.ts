/**
 * Re-encoding a rotated image so the rotation actually survives.
 *
 * Before this, rotate was display-only: turn a sideways photo upright, close the
 * window, and it is sideways again. The brief calls silently discarding the
 * user's action the worst of the three options, and it is right — the other two
 * are "offer to save it" and "say it is temporary", and this does the first.
 *
 * ## EXIF orientation is not our problem, and that is measured
 *
 * The brief also asks for an EXIF-orientation parse applied as an initial
 * transform. **That would double-rotate every phone photo.** Verified in the
 * shipped build against two JPEGs with identical pixels, one carrying
 * `Orientation=6`:
 *
 * - `getComputedStyle().imageOrientation` is `from-image` — the default.
 * - The oriented file reports `naturalWidth/naturalHeight` as **200×400** where
 *   the plain one reports 400×200. The browser hands us the *oriented*
 *   dimensions, so the existing fit math is already correct.
 * - `drawImage` receives the **rotated** pixels: sampling the top-left of the
 *   canvas gives white where the raw bitmap has a red bar.
 *
 * The third point is what makes this module safe: a canvas re-encode bakes in the
 * orientation the user actually sees, and the output carries no EXIF at all — so
 * the saved file needs no orientation tag and cannot disagree with itself.
 */

/**
 * Lowercase extension, or `''` when there is none.
 *
 * `split('.').pop()` returns the WHOLE name for a file without a dot, so a file
 * literally called `png` would have been treated as a PNG — and `.gitignore`
 * would be an extension called "gitignore". Both matter here, because the answer
 * decides whether the app will write over the file.
 */
function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? path
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

/**
 * Output MIME for a path.
 *
 * Anything the browser cannot *encode* becomes PNG, which is lossless and
 * universally supported. Re-encoding a JPEG as JPEG is a generation loss, but
 * silently turning the user's `photo.jpg` into a PNG under the same name is
 * worse — the extension would lie about the bytes.
 */
export function encodeMime(path: string): string {
  switch (extensionOf(path)) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'png':
      return 'image/png'
    default:
      // GIF (animation would be lost anyway), BMP, ICO, AVIF, SVG: PNG is the
      // honest lossless target, and `canSaveInPlace` refuses the ones where
      // that would rename the format out from under the user.
      return 'image/png'
  }
}

/**
 * Whether a rotation can be written back over this file without changing what
 * the format is.
 *
 * SVG is vector and has no business going through a raster canvas. GIF may be
 * animated, and a re-encode would silently keep one frame. ICO is a container of
 * several sizes. For those, rotation stays a view transform and the app offers
 * "Save a copy" instead — losing an animation without saying so is the same
 * class of defect as losing a chart on a spreadsheet save (brief 63).
 */
export function canSaveInPlace(path: string): boolean {
  return ['png', 'jpg', 'jpeg', 'webp'].includes(extensionOf(path))
}

/** Human reason a file cannot be rotated in place, for the UI to show. */
export function noSaveReason(path: string): string | null {
  const ext = extensionOf(path)
  if (canSaveInPlace(path)) return null
  if (ext === 'svg') return 'SVG is vector — rotation stays a view setting.'
  if (ext === 'gif') return 'Saving a GIF would keep one frame. Save a copy as PNG instead.'
  if (ext === 'ico') return 'An .ico holds several sizes. Save a copy as PNG instead.'
  return `Rotation cannot be written back to .${ext || 'this format'}. Save a copy as PNG instead.`
}

/** The suggested filename for "save a copy" of a rotated image. */
export function copyName(path: string, rotation: number): string {
  const base = path.split('/').pop() ?? path
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const turns = ((rotation % 360) + 360) % 360 || 0
  return `${stem}-rotated${turns ? `-${turns}` : ''}.png`
}

/** Size of the canvas needed to hold `natural` turned by `rotation`. */
export function rotatedCanvasSize(
  natural: { width: number; height: number },
  rotation: number
): { width: number; height: number } {
  const quarterTurn = Math.abs(rotation % 180) === 90
  return quarterTurn
    ? { width: natural.height, height: natural.width }
    : { width: natural.width, height: natural.height }
}
