import { describe, expect, it } from 'vitest'
import { canSaveInPlace, copyName, encodeMime, noSaveReason, rotatedCanvasSize } from './encode'

describe('encodeMime', () => {
  it('keeps the format for the ones the browser can encode', () => {
    expect(encodeMime('a.jpg')).toBe('image/jpeg')
    expect(encodeMime('a.JPEG')).toBe('image/jpeg')
    expect(encodeMime('a.png')).toBe('image/png')
    expect(encodeMime('a.webp')).toBe('image/webp')
  })

  it('falls back to PNG for everything else', () => {
    expect(encodeMime('a.bmp')).toBe('image/png')
    expect(encodeMime('a.avif')).toBe('image/png')
    expect(encodeMime('noext')).toBe('image/png')
  })
})

describe('canSaveInPlace', () => {
  it('allows the raster formats the browser can encode', () => {
    for (const p of ['a.png', 'a.jpg', 'a.jpeg', 'a.WEBP']) {
      expect(canSaveInPlace(p), p).toBe(true)
    }
  })

  it('refuses formats where a re-encode would change what the file is', () => {
    // Losing a GIF's animation without saying so is the same class of defect as
    // losing a chart on a spreadsheet save.
    for (const p of ['a.svg', 'a.gif', 'a.ico', 'a.bmp', 'a.avif']) {
      expect(canSaveInPlace(p), p).toBe(false)
    }
  })
})

describe('noSaveReason', () => {
  it('says nothing when the file can be saved', () => {
    expect(noSaveReason('a.png')).toBeNull()
  })

  it('names the actual reason per format, not a generic refusal', () => {
    expect(noSaveReason('a.svg')).toContain('vector')
    expect(noSaveReason('a.gif')).toContain('one frame')
    expect(noSaveReason('a.ico')).toContain('several sizes')
    expect(noSaveReason('a.bmp')).toContain('.bmp')
  })

  it('does not produce a dangling extension for a file without one', () => {
    expect(noSaveReason('noext')).toContain('this format')
  })
})

describe('copyName', () => {
  it('suggests a PNG beside the original', () => {
    expect(copyName('Pictures/photo.jpg', 90)).toBe('photo-rotated-90.png')
    expect(copyName('Pictures/photo.jpg', 180)).toBe('photo-rotated-180.png')
  })

  it('normalises the rotation into 0-359', () => {
    expect(copyName('a.png', -90)).toBe('a-rotated-270.png')
    expect(copyName('a.png', 450)).toBe('a-rotated-90.png')
    expect(copyName('a.png', 360)).toBe('a-rotated.png')
  })

  it('handles a name with dots and no extension', () => {
    expect(copyName('my.photo.v2.jpg', 90)).toBe('my.photo.v2-rotated-90.png')
    expect(copyName('README', 90)).toBe('README-rotated-90.png')
  })
})

describe('rotatedCanvasSize', () => {
  it('swaps the axes on a quarter turn only', () => {
    const n = { width: 400, height: 200 }
    expect(rotatedCanvasSize(n, 0)).toEqual({ width: 400, height: 200 })
    expect(rotatedCanvasSize(n, 90)).toEqual({ width: 200, height: 400 })
    expect(rotatedCanvasSize(n, 180)).toEqual({ width: 400, height: 200 })
    expect(rotatedCanvasSize(n, 270)).toEqual({ width: 200, height: 400 })
  })
})

describe('extension handling', () => {
  it('does not treat a dotless name as its own extension', () => {
    // `'png'.split('.').pop()` is `'png'`, so a file literally called `png`
    // would have been saved over as a PNG.
    expect(canSaveInPlace('png')).toBe(false)
    expect(canSaveInPlace('Pictures/jpeg')).toBe(false)
    expect(encodeMime('png')).toBe('image/png')
  })

  it('does not treat a leading dot as an extension', () => {
    expect(canSaveInPlace('.gitignore')).toBe(false)
  })

  it('reads the extension from the basename, not the directory', () => {
    // A folder with a dot in it must not decide the format.
    expect(canSaveInPlace('my.photos/holiday.png')).toBe(true)
    expect(canSaveInPlace('my.png/notes')).toBe(false)
  })
})
