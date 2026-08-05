import { describe, expect, it } from 'vitest'
import { completeUrl, normaliseUrl, sameUrl } from './urlNormalise'

describe('normaliseUrl — when two bookmarks are the same', () => {
  it('treats a trailing slash on an empty path as the same address', () => {
    expect(sameUrl('https://example.com', 'https://example.com/')).toBe(true)
  })

  it('ignores host case but not path case', () => {
    expect(sameUrl('https://EXAMPLE.com/a', 'https://example.com/a')).toBe(true)
    // Most servers serve /A and /a as different pages, so these are two bookmarks.
    expect(sameUrl('https://example.com/A', 'https://example.com/a')).toBe(false)
  })

  it('drops www., which is the deliberate heuristic', () => {
    expect(sameUrl('https://www.example.com/x', 'https://example.com/x')).toBe(true)
    // But not a host that merely starts with those letters.
    expect(sameUrl('https://wwwx.example.com', 'https://x.example.com')).toBe(false)
  })

  it('drops a default port and keeps a real one', () => {
    expect(sameUrl('http://example.com:80/a', 'http://example.com/a')).toBe(true)
    expect(sameUrl('https://example.com:443/a', 'https://example.com/a')).toBe(true)
    expect(sameUrl('http://example.com:8080/a', 'http://example.com/a')).toBe(false)
  })

  it('keeps the scheme, because http and https are different addresses', () => {
    expect(sameUrl('http://example.com', 'https://example.com')).toBe(false)
  })

  it('drops the fragment, because it is a place in one page', () => {
    expect(sameUrl('https://example.com/a#top', 'https://example.com/a#bottom')).toBe(true)
  })

  it('keeps the query exactly — different parameters are different pages', () => {
    expect(sameUrl('https://example.com/p?id=1', 'https://example.com/p?id=2')).toBe(false)
    // And parameter order is not normalised: guessing would be worse than a duplicate
    // prompt the user can dismiss.
    expect(sameUrl('https://example.com/p?a=1&b=2', 'https://example.com/p?b=2&a=1')).toBe(false)
  })

  it('handles localhost, which the app must be able to bookmark', () => {
    expect(sameUrl('http://localhost:3000/', 'http://localhost:3000')).toBe(true)
    expect(sameUrl('http://localhost:3000', 'http://localhost:3001')).toBe(false)
  })

  it('falls back to the trimmed string for something it cannot parse', () => {
    expect(normaliseUrl('  not a url  ')).toBe('not a url')
    expect(sameUrl('not a url', 'not a url')).toBe(true)
    expect(sameUrl('not a url', 'also not')).toBe(false)
  })
})

describe('completeUrl — what a person actually types', () => {
  it('adds https:// to a bare host', () => {
    expect(completeUrl('example.com')).toBe('https://example.com')
    expect(completeUrl('  example.com/a?b=c  ')).toBe('https://example.com/a?b=c')
  })

  it('leaves an existing scheme alone', () => {
    expect(completeUrl('http://localhost:3000')).toBe('http://localhost:3000')
    expect(completeUrl('https://example.com')).toBe('https://example.com')
  })

  it('never invents a scheme for something dangerous', () => {
    // The point: completion must not be able to turn a rejected URL into an accepted
    // one. These keep their scheme and the backend keeps refusing them.
    expect(completeUrl('javascript:alert(1)')).toBe('javascript:alert(1)')
    expect(completeUrl('data:text/html,x')).toBe('data:text/html,x')
    expect(completeUrl('file:///etc/passwd')).toBe('file:///etc/passwd')
  })

  it('resolves a protocol-relative URL to https', () => {
    expect(completeUrl('//cdn.example.com/x')).toBe('https://cdn.example.com/x')
  })

  it('leaves an empty string empty rather than making it a URL', () => {
    expect(completeUrl('   ')).toBe('')
  })
})
