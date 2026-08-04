/**
 * Terminal font size: clamped, persisted, and shared with the fit maths.
 *
 * Kept as a module rather than inline state because the value is written to
 * localStorage and read back on the next mount, so the parse has to be defensive
 * about whatever is in storage — including a value written by an older build or
 * edited by hand.
 */

export const MIN_FONT_SIZE = 8
export const MAX_FONT_SIZE = 28
export const DEFAULT_FONT_SIZE = 13
export const FONT_SIZE_STEP = 1

const STORAGE_KEY = 'imbatranim:terminal:font-size'

export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_FONT_SIZE
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)))
}

export function loadFontSize(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return DEFAULT_FONT_SIZE
    const parsed = Number(raw)
    // `Number('')` is 0 and `Number('abc')` is NaN — both must land on the
    // default rather than on the clamp's lower bound, or a corrupt value would
    // silently give the user an 8px terminal forever.
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_FONT_SIZE
    return clampFontSize(parsed)
  } catch {
    return DEFAULT_FONT_SIZE
  }
}

export function saveFontSize(size: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(clampFontSize(size)))
  } catch {
    // quota exceeded or private mode — the size still applies for this session
  }
}

/**
 * The next size for a zoom step. `direction` is +1 / -1, and 0 resets.
 *
 * Returns the clamped result, so a caller at the bound gets the same value back
 * and can skip the re-fit rather than thrashing xterm at the limit.
 */
export function stepFontSize(current: number, direction: 1 | -1 | 0): number {
  if (direction === 0) return DEFAULT_FONT_SIZE
  return clampFontSize(current + direction * FONT_SIZE_STEP)
}
