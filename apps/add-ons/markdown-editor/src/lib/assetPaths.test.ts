import { describe, expect, it } from 'vitest'
import {
  assetDir,
  dirOf,
  extensionForMime,
  imageMarkdown,
  isRemote,
  relativeFrom,
  resolveRelative,
  safeBaseName,
  uniqueName,
} from './assetPaths'

describe('resolveRelative', () => {
  it('resolves a sibling and a subdirectory', () => {
    expect(resolveRelative('docs', 'shot.png')).toBe('docs/shot.png')
    expect(resolveRelative('docs', 'img/shot.png')).toBe('docs/img/shot.png')
    expect(resolveRelative('', 'shot.png')).toBe('shot.png')
  })

  it('resolves ./ and ../ within the root', () => {
    expect(resolveRelative('docs/deep', '../shot.png')).toBe('docs/shot.png')
    expect(resolveRelative('docs', './shot.png')).toBe('docs/shot.png')
  })

  it('treats a leading slash as the root of THIS filesystem, not the web origin', () => {
    expect(resolveRelative('docs', '/assets/logo.png')).toBe('assets/logo.png')
  })

  it('refuses to build a path that climbs out of the root', () => {
    // The backend's resolveSafe would refuse it anyway; not building the request keeps
    // a document full of `../..` links from firing a burst of rejected calls just by
    // being previewed.
    expect(resolveRelative('docs', '../../etc/passwd')).toBeNull()
    expect(resolveRelative('', '../secret')).toBeNull()
  })

  it('returns null for anything that is not a path in this filesystem', () => {
    expect(resolveRelative('docs', 'https://example.test/a.png')).toBeNull()
    expect(resolveRelative('docs', 'data:image/png;base64,AAA')).toBeNull()
    expect(resolveRelative('docs', '#heading')).toBeNull()
    expect(resolveRelative('docs', '')).toBeNull()
  })

  it('decodes percent-escapes and drops the query/fragment', () => {
    expect(resolveRelative('docs', 'my%20shot.png#zoom')).toBe('docs/my shot.png')
  })
})

describe('isRemote', () => {
  it('spots schemes and protocol-relative URLs', () => {
    expect(isRemote('https://x.test/a.png')).toBe(true)
    expect(isRemote('//x.test/a.png')).toBe(true)
    expect(isRemote('data:image/png;base64,AA')).toBe(true)
    expect(isRemote('docs/a.png')).toBe(false)
    expect(isRemote('/docs/a.png')).toBe(false)
  })
})

describe('relativeFrom', () => {
  it('shortens a path inside the document directory', () => {
    expect(relativeFrom('docs', 'docs/assets/a.png')).toBe('assets/a.png')
    expect(relativeFrom('', 'a.png')).toBe('a.png')
  })

  it('climbs out when the target is elsewhere', () => {
    expect(relativeFrom('docs/deep', 'docs/a.png')).toBe('../a.png')
    expect(relativeFrom('docs', 'other/a.png')).toBe('../other/a.png')
  })
})

describe('assetDir', () => {
  it('uses an existing assets directory, and the document directory otherwise', () => {
    expect(assetDir('docs', true)).toBe('docs/assets')
    expect(assetDir('docs', false)).toBe('docs')
    expect(assetDir('', true)).toBe('assets')
  })
})

describe('safeBaseName', () => {
  it('slugifies and drops the extension', () => {
    expect(safeBaseName('Screen Shot 2026-08-05 at 12.03.png')).toBe(
      'screen-shot-2026-08-05-at-12-03'
    )
  })

  it('falls back rather than producing an empty name', () => {
    expect(safeBaseName('...')).toBe('image')
    expect(safeBaseName('')).toBe('image')
  })
})

describe('uniqueName', () => {
  it('takes the plain name when it is free', () => {
    expect(uniqueName(['other.png'], 'shot', 'png')).toBe('shot.png')
  })

  it('suffixes rather than overwriting an existing file', () => {
    // Every pasted screenshot blob is called `image.png`. Overwriting would destroy a
    // file the user never mentioned.
    expect(uniqueName(['image.png'], 'image', 'png')).toBe('image-1.png')
    expect(uniqueName(['image.png', 'image-1.png'], 'image', 'png')).toBe('image-2.png')
  })

  it('compares case-insensitively, because the FS may too', () => {
    expect(uniqueName(['IMAGE.PNG'], 'image', 'png')).toBe('image-1.png')
  })
})

describe('extensionForMime', () => {
  it('maps known image types and falls back to png', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg')
    expect(extensionForMime('image/svg+xml')).toBe('svg')
    expect(extensionForMime('application/octet-stream')).toBe('png')
  })
})

describe('imageMarkdown', () => {
  it('escapes the spaces a markdown link cannot carry', () => {
    expect(imageMarkdown('shot', 'assets/my shot.png')).toBe('![shot](assets/my%20shot.png)')
  })
})

describe('dirOf', () => {
  it('is empty at the root', () => {
    expect(dirOf('a.md')).toBe('')
    expect(dirOf('docs/a.md')).toBe('docs')
  })
})
