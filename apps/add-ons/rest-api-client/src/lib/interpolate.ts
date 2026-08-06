/**
 * `{{var}}` interpolation, and the guard the brief's security review is aimed at.
 *
 * Environments are what make a REST client usable instead of a curiosity — one saved
 * request that works against localhost and against a deployed instance. The catch is
 * that a variable ends up **inside a URL that the proxy then fetches**, and the proxy's
 * first guardrail is a scheme allowlist. So the reviewer's trick is a variable whose
 * value smuggles a scheme past it:
 *
 * ```
 * url  = "{{base}}/users"
 * base = "file:///etc/passwd#"
 * ```
 *
 * The proxy would still refuse `file:` — its allowlist is re-checked per redirect hop
 * and is the real boundary. But refusing here as well means the user is told *why*,
 * at the moment they can fix it, instead of getting an opaque backend error; and it
 * means a future caller that forgets the proxy cannot be tricked either. Defence in
 * depth, with the shallower layer giving the better message.
 *
 * A second, subtler trick: a variable injecting `\r\n` into a **header** value, to
 * append a header of the attacker's choosing. The proxy rejects CRLF in header values,
 * and so does this module — same reasoning.
 */

export type Variables = Record<string, string>

/** What the proxy will accept. Kept in step with its allowlist deliberately. */
const ALLOWED_SCHEMES = ['http:', 'https:']

const VAR_RE = /\{\{\s*([\w.-]+)\s*\}\}/g

export type InterpolationIssue =
  | { kind: 'missing'; name: string }
  | { kind: 'scheme'; scheme: string }
  | { kind: 'crlf'; where: string }
  | { kind: 'empty'; name: string }

export type Interpolated = {
  url: string
  headers: { name: string; value: string }[]
  body: string
  /** Anything the user should see before sending. Empty means clean. */
  issues: InterpolationIssue[]
}

/** Substitute `{{name}}`, collecting names that had no value. */
export function substitute(
  text: string,
  vars: Variables
): { text: string; missing: string[]; empty: string[] } {
  const missing: string[] = []
  const empty: string[] = []
  const out = text.replace(VAR_RE, (_match, name: string) => {
    if (!(name in vars)) {
      missing.push(name)
      // Left as-is rather than blanked: a URL with a visible `{{host}}` in it is a
      // legible mistake, while a URL that silently became `/users` is a confusing one.
      return `{{${name}}}`
    }
    const value = vars[name]
    if (value === '') empty.push(name)
    return value
  })
  return { text: out, missing, empty }
}

/** Every `{{name}}` referenced by a piece of text. */
export function referencedVars(text: string): string[] {
  const names = new Set<string>()
  for (const match of text.matchAll(VAR_RE)) names.add(match[1])
  return [...names]
}

/**
 * Interpolate a whole request and report what is wrong with the result.
 *
 * Interpolation happens **at send time and is never stored**, so a saved request keeps
 * its `{{var}}` form and stays portable between environments — which is the entire
 * point of having them.
 */
export function interpolateRequest(
  request: {
    url: string
    headers: { name: string; value: string; enabled?: boolean }[]
    body: string
  },
  vars: Variables
): Interpolated {
  const issues: InterpolationIssue[] = []
  const seenMissing = new Set<string>()
  const noteMissing = (names: string[], empties: string[]) => {
    for (const name of names) {
      if (seenMissing.has(name)) continue
      seenMissing.add(name)
      issues.push({ kind: 'missing', name })
    }
    for (const name of empties) {
      if (seenMissing.has(name)) continue
      seenMissing.add(name)
      issues.push({ kind: 'empty', name })
    }
  }

  const urlResult = substitute(request.url, vars)
  noteMissing(urlResult.missing, urlResult.empty)
  const url = urlResult.text

  // The scheme check runs on the RESULT, which is the only thing that matters: the
  // template may be innocent and the value may not be.
  const scheme = schemeOf(url)
  if (scheme !== null && !ALLOWED_SCHEMES.includes(scheme)) {
    issues.push({ kind: 'scheme', scheme })
  }

  const headers: { name: string; value: string }[] = []
  for (const header of request.headers) {
    if (header.enabled === false) continue
    if (header.name.trim() === '') continue
    const nameResult = substitute(header.name, vars)
    const valueResult = substitute(header.value, vars)
    noteMissing(
      [...nameResult.missing, ...valueResult.missing],
      [...nameResult.empty, ...valueResult.empty]
    )
    if (hasCrlf(nameResult.text) || hasCrlf(valueResult.text)) {
      issues.push({ kind: 'crlf', where: nameResult.text.trim() || 'a header' })
      continue
    }
    headers.push({ name: nameResult.text.trim(), value: valueResult.text })
  }

  const bodyResult = substitute(request.body, vars)
  noteMissing(bodyResult.missing, bodyResult.empty)

  return { url, headers, body: bodyResult.text, issues }
}

/**
 * The scheme of a URL, or null when it has none.
 *
 * Parsed off the front rather than with `new URL()`, because a scheme-relative or
 * relative URL must come back as "no scheme" rather than throwing, and because the
 * thing being guarded against is precisely a value that `new URL` would happily
 * accept.
 */
export function schemeOf(url: string): string | null {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url.trim())
  return match ? `${match[1].toLowerCase()}:` : null
}

function hasCrlf(text: string): boolean {
  return /[\r\n]/.test(text)
}

/** True when there is anything the user must resolve before a send can be honest. */
export function blocksSend(issues: InterpolationIssue[]): boolean {
  // A missing or empty variable is a warning — sending is still the user's call, and
  // sometimes an empty value is the intent. A smuggled scheme or an injected CRLF is
  // never the intent, and the proxy would refuse it anyway.
  return issues.some((issue) => issue.kind === 'scheme' || issue.kind === 'crlf')
}

/** One human sentence for the warning strip. */
export function describeIssues(issues: InterpolationIssue[]): string {
  const parts: string[] = []
  const missing = issues.filter((i) => i.kind === 'missing').map((i) => i.name)
  const empty = issues.filter((i) => i.kind === 'empty').map((i) => i.name)
  const scheme = issues.find((i) => i.kind === 'scheme')
  const crlf = issues.find((i) => i.kind === 'crlf')

  if (scheme && scheme.kind === 'scheme') {
    parts.push(
      `A variable turned this into a ${scheme.scheme} URL — only http and https can be sent.`
    )
  }
  if (crlf && crlf.kind === 'crlf') {
    parts.push(`A variable put a line break into the header “${crlf.where}”, which is not allowed.`)
  }
  if (missing.length > 0) {
    parts.push(
      `${missing.length === 1 ? 'Variable' : 'Variables'} with no value in this environment: ${missing.join(', ')}.`
    )
  }
  if (empty.length > 0) {
    parts.push(`Set but empty: ${empty.join(', ')}.`)
  }
  return parts.join(' ')
}
