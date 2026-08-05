/**
 * When two bookmarks are "the same".
 *
 * Duplicate detection is only as good as this function, and it is a judgement call
 * rather than a spec, so the choices are written down:
 *
 * - **The scheme is kept.** `http://` and `https://` versions of a host are genuinely
 *   different addresses, and silently treating them as one would hide a real
 *   distinction on an intranet.
 * - **The host is lowercased**, because DNS is case-insensitive. The **path is not** —
 *   most servers treat paths case-sensitively, so `/A` and `/a` may be two pages.
 * - **A default port is dropped** (`:80` on http, `:443` on https): those are the same
 *   address written two ways.
 * - **`www.` is dropped.** This one is a heuristic — `www.x.com` and `x.com` are
 *   *technically* different hosts and occasionally serve different content — but for a
 *   human's bookmark list they are the same site, and a duplicate prompt the user can
 *   dismiss is a better failure than a silent second entry.
 * - **A trailing slash on an empty path is dropped**, so `https://x.com` equals
 *   `https://x.com/`.
 * - **The fragment is dropped**, because `#section` is a position in one page.
 * - **The query is kept, exactly.** Sorting parameters would collapse genuinely
 *   different pages (`?id=1` vs `?id=2` are not one bookmark), and stripping tracking
 *   parameters is a guessing game that would make the check wrong for real URLs.
 *
 * A URL this cannot parse normalises to its trimmed self, so an unparseable string is
 * only ever a duplicate of an identical string.
 */
export function normaliseUrl(raw: string): string {
  const trimmed = raw.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return trimmed
  }

  const scheme = parsed.protocol.toLowerCase()
  let host = parsed.hostname.toLowerCase()
  if (host.startsWith('www.') && host.length > 4) host = host.slice(4)

  const defaultPort =
    (scheme === 'http:' && parsed.port === '80') || (scheme === 'https:' && parsed.port === '443')
  const port = parsed.port === '' || defaultPort ? '' : `:${parsed.port}`

  const path = parsed.pathname === '/' ? '' : parsed.pathname

  return `${scheme}//${host}${port}${path}${parsed.search}`
}

/** True when two URLs would be the same bookmark. */
export function sameUrl(a: string, b: string): boolean {
  return normaliseUrl(a) === normaliseUrl(b)
}

/**
 * Complete a URL the way a browser's address bar does.
 *
 * Typing `example.com` into a bookmark field is what a user will actually do, and
 * rejecting it with "must be an http:// or https:// URL" would be pedantry — the
 * backend's allow-list exists to keep `javascript:` out, not to make people type a
 * scheme. Anything that already has a scheme is left exactly as it is, so this can
 * never turn a `javascript:` URL into an accepted one.
 */
export function completeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '') return trimmed
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  return `https://${trimmed}`
}
