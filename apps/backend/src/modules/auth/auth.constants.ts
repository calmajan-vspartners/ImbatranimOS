import { createHash } from 'crypto';

/**
 * Name of the httpOnly session cookie. Exported so WebSocket upgrade
 * handlers (terminal/files, future briefs) read the same cookie the REST
 * guard sets.
 */
export const SESSION_COOKIE_NAME = 'imb_session';

/** SHA-256 of a raw session token, used as the DB primary key. */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Parse a raw `Cookie:` header into a name→value map. Dependency-free so it
 * works for WS upgrade requests, which never pass through Express /
 * cookie-parser.
 */
export function parseCookieHeader(
  header: string | undefined | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    const val = part.slice(eq + 1).trim();
    // A malformed percent-escape (e.g. a stray `%` from another cookie on the
    // domain) makes decodeURIComponent throw URIError. Unguarded, that bubbled
    // out of the guard and 500'd every response — including the public
    // /api/auth/status. Fall back to the raw value instead.
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

/**
 * Extract the raw session token from any request-like object — an Express
 * request (with `.cookies` from cookie-parser) or a raw Node
 * `IncomingMessage` (WS upgrade, only `.headers.cookie`).
 */
export function readSessionCookie(req: {
  cookies?: Record<string, string>;
  headers?: { cookie?: string };
}): string | null {
  const fromParsed = req.cookies?.[SESSION_COOKIE_NAME];
  if (fromParsed) return fromParsed;
  const fromHeader = parseCookieHeader(req.headers?.cookie)[
    SESSION_COOKIE_NAME
  ];
  return fromHeader ?? null;
}
