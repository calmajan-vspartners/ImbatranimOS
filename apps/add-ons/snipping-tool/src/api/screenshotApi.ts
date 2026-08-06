import type { SystemFs } from '@imbatranim/ui'

/**
 * Where saved screenshots land, relative to the `home` files root
 * (~/Pictures/Screenshots). The upload endpoint mkdir -p's parent dirs, so the
 * folder is created on first save.
 */
const SCREENSHOTS_DIR = 'Pictures/Screenshots'

/**
 * `screenshot-YYYY-MM-DD-HHMMSS-mmm.png` in local time. The millisecond suffix
 * keeps two saves within the same second from silently overwriting each other.
 */
export function screenshotFilename(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const ms = String(now.getMilliseconds()).padStart(3, '0')
  const stamp =
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}-${ms}`
  return `screenshot-${stamp}.png`
}

/** Upload a PNG blob to ~/Pictures/Screenshots via the fs capability. */
export async function saveScreenshot(fs: SystemFs, blob: Blob): Promise<string> {
  const name = screenshotFilename()
  const path = `${SCREENSHOTS_DIR}/${name}`
  await fs.upload('home', path, await blob.arrayBuffer(), name)
  return path
}
