import type { SystemFs } from '@imbatranim/ui'

/**
 * Load a saved capture back into a canvas so it can be annotated again.
 *
 * Through `fs.read` (the authed channel) rather than pointing an `<img>` at the
 * download URL: an image loaded that way is fine to display but drawing it to a canvas and
 * calling `toBlob` risks a tainted canvas, and the whole point of reopening is to export
 * again afterwards. Bytes → `Blob` → `createImageBitmap` keeps the canvas clean.
 */
export async function loadCaptureCanvas(
  fs: SystemFs,
  root: string,
  path: string
): Promise<HTMLCanvasElement> {
  const bytes = await fs.read(root, path)
  const bitmap = await createImageBitmap(new Blob([bytes]))
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas
}
