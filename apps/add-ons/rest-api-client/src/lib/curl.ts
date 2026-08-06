import type { HeaderRow, HttpMethod } from '../types'

/**
 * curl in and out — the interop baseline.
 *
 * curl is what people actually paste to each other, and it is what a shell, an API
 * doc and a browser's "copy as cURL" all speak. Without it every request must be
 * retyped and nothing can leave, which is the same argument that got CSV into Sheets,
 * ICS into Calendar and Netscape HTML into Bookmarks.
 *
 * Hand-written and heavily tested because **this is where quoting bugs live**. A
 * parser that mishandles `'` inside `"` silently sends a different body than the one
 * pasted, and the user has no way to see that from the UI.
 *
 * Deliberately NOT a shell. Tokenising handles quoting and backslash continuations,
 * but `$(…)`, backticks, pipes and redirects are **not** interpreted — they stay
 * literal text. A pasted curl command is untrusted input; the only safe reading of it
 * is as data.
 */

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

export type ParsedCurl = {
  method: HttpMethod
  url: string
  headers: { name: string; value: string }[]
  body: string
  /** Flags recognised but not representable here, so the UI can say so. */
  ignored: string[]
}

export class CurlParseError extends Error {}

/**
 * Split a command line into argv, honouring the quoting rules a shell would.
 *
 * - `'single'` quotes: everything literal, no escapes (POSIX).
 * - `"double"` quotes: `\"` `\\` `\$` and a line continuation are unescaped; other
 *   backslashes stay literal, which is what bash does.
 * - A trailing `\` before a newline joins lines — curl commands are usually pasted
 *   multi-line.
 * - `^` continuations (Windows `cmd`) are also tolerated, because "copy as cURL
 *   (cmd)" is a real thing people paste.
 */
export function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let has = false
  let quote: '"' | "'" | null = null

  const push = () => {
    if (has) tokens.push(current)
    current = ''
    has = false
  }

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    if (quote === "'") {
      if (ch === "'") quote = null
      else {
        current += ch
        has = true
      }
      continue
    }

    if (quote === '"') {
      if (ch === '"') {
        quote = null
      } else if (ch === '\\' && i + 1 < input.length) {
        const next = input[i + 1]
        if (next === '\n') {
          i += 1 // line continuation inside quotes
        } else if (next === '"' || next === '\\' || next === '$' || next === '`') {
          current += next
          has = true
          i += 1
        } else {
          current += ch
          has = true
        }
      } else {
        current += ch
        has = true
      }
      continue
    }

    if (ch === "'" || ch === '"') {
      quote = ch
      has = true // `--data ''` is an empty body, not an absent one
      continue
    }
    if (ch === '\\' && i + 1 < input.length) {
      // Outside quotes a backslash escapes the NEXT character, whatever it is —
      // except a newline, which is a line continuation. Handling only the newline
      // case broke the round trip: `shellQuote("it's")` emits `'it'\''s'`, and the
      // `\'` in the middle has to come back as a literal quote or the token ends up
      // with a stray backslash. Caught by the toCurl → parseCurl round-trip test.
      if (input[i + 1] === '\n') {
        i += 1
      } else {
        current += input[i + 1]
        has = true
        i += 1
      }
      continue
    }
    if (ch === '^' && input[i + 1] === '\n') {
      i += 1
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      push()
      continue
    }
    current += ch
    has = true
  }
  if (quote !== null) throw new CurlParseError('That command has an unclosed quote')
  push()
  return tokens
}

/** Flags that take a value we do not model; the value must be consumed too. */
const VALUE_FLAGS_IGNORED = new Set([
  '--connect-timeout',
  '--max-time',
  '-m',
  '--retry',
  '--cacert',
  '--cert',
  '--key',
  '--proxy',
  '-x',
  '--resolve',
  '--limit-rate',
  '-w',
  '--write-out',
  '-o',
  '--output',
  '-A',
  '--user-agent',
  '-e',
  '--referer',
  '--cookie-jar',
  '-c',
])

/** Boolean flags we recognise and can safely disregard. */
const BOOL_FLAGS_IGNORED = new Set([
  '-s',
  '--silent',
  '-S',
  '--show-error',
  '-v',
  '--verbose',
  '-k',
  '--insecure',
  '-L',
  '--location',
  '-i',
  '--include',
  '-f',
  '--fail',
  '--compressed',
  '-g',
  '--globoff',
  '--no-progress-meter',
])

/**
 * Parse a curl command into a request.
 *
 * Supported: `-X/--request`, `-H/--header`, `-d/--data/--data-raw/--data-binary/
 * --data-ascii`, `--json`, `-u/--user`, `-b/--cookie`, `-F/--form`, `-G/--get`,
 * `-I/--head`, and a bare URL anywhere in the command.
 */
export function parseCurl(input: string): ParsedCurl {
  const tokens = tokenize(input.trim())
  if (tokens.length === 0) throw new CurlParseError('Nothing to import')
  // Tolerate a leading `$ ` or `curl` in any case, and a `sudo` someone pasted.
  let i = 0
  if (tokens[i] === '$') i += 1
  if (tokens[i] === 'sudo') i += 1
  if (tokens[i]?.toLowerCase() !== 'curl') {
    throw new CurlParseError('That does not start with `curl`')
  }
  i += 1

  let method: HttpMethod | null = null
  let url = ''
  const headers: { name: string; value: string }[] = []
  const dataParts: string[] = []
  const formParts: string[] = []
  const ignored: string[] = []
  let forceGet = false
  let jsonFlag = false

  const valueOf = (flag: string, inline: string | null): string => {
    if (inline !== null) return inline
    const next = tokens[++i]
    if (next === undefined) throw new CurlParseError(`${flag} needs a value`)
    return next
  }

  for (; i < tokens.length; i++) {
    const token = tokens[i]
    // `--flag=value` as well as `--flag value`.
    const eq = token.startsWith('--') ? token.indexOf('=') : -1
    const flag = eq > 0 ? token.slice(0, eq) : token
    const inline = eq > 0 ? token.slice(eq + 1) : null

    if (flag === '-X' || flag === '--request') {
      const raw = valueOf(flag, inline).toUpperCase()
      const found = METHODS.find((m) => m === raw)
      if (!found) throw new CurlParseError(`Unsupported method ${raw}`)
      method = found
      continue
    }
    if (flag === '-H' || flag === '--header') {
      const raw = valueOf(flag, inline)
      const colon = raw.indexOf(':')
      if (colon < 0) {
        ignored.push(raw)
        continue
      }
      headers.push({ name: raw.slice(0, colon).trim(), value: raw.slice(colon + 1).trim() })
      continue
    }
    if (
      flag === '-d' ||
      flag === '--data' ||
      flag === '--data-raw' ||
      flag === '--data-binary' ||
      flag === '--data-ascii' ||
      flag === '--data-urlencode'
    ) {
      dataParts.push(valueOf(flag, inline))
      continue
    }
    if (flag === '--json') {
      dataParts.push(valueOf(flag, inline))
      jsonFlag = true
      continue
    }
    if (flag === '-F' || flag === '--form') {
      formParts.push(valueOf(flag, inline))
      continue
    }
    if (flag === '-u' || flag === '--user') {
      const raw = valueOf(flag, inline)
      // Encode to a real Basic header rather than keeping a curl-ism around.
      headers.push({ name: 'Authorization', value: `Basic ${base64(raw)}` })
      continue
    }
    if (flag === '-b' || flag === '--cookie') {
      headers.push({ name: 'Cookie', value: valueOf(flag, inline) })
      continue
    }
    if (flag === '-A' || flag === '--user-agent') {
      headers.push({ name: 'User-Agent', value: valueOf(flag, inline) })
      continue
    }
    if (flag === '-e' || flag === '--referer') {
      headers.push({ name: 'Referer', value: valueOf(flag, inline) })
      continue
    }
    if (flag === '-G' || flag === '--get') {
      forceGet = true
      continue
    }
    if (flag === '-I' || flag === '--head') {
      method = 'HEAD'
      continue
    }
    if (flag === '--url') {
      url = valueOf(flag, inline)
      continue
    }
    if (VALUE_FLAGS_IGNORED.has(flag)) {
      const value = valueOf(flag, inline)
      ignored.push(`${flag} ${value}`)
      continue
    }
    if (BOOL_FLAGS_IGNORED.has(flag)) {
      ignored.push(flag)
      continue
    }
    if (token.startsWith('-')) {
      // Unknown flag: record it rather than guessing whether it eats a value.
      ignored.push(token)
      continue
    }
    // A bare token is the URL. The first one wins; a second is noted.
    if (url === '') url = token
    else ignored.push(token)
  }

  if (url === '') throw new CurlParseError('No URL in that command')

  let body = ''
  if (formParts.length > 0) {
    // Multipart is modelled by the UI's own form editor; represent it as the
    // `name=value` lines curl used, which the UI can load into that editor.
    body = formParts.join('\n')
    if (!headers.some((h) => h.name.toLowerCase() === 'content-type')) {
      headers.push({ name: 'Content-Type', value: 'multipart/form-data' })
    }
  } else if (dataParts.length > 0) {
    body = dataParts.join('&')
    if (jsonFlag) {
      if (!headers.some((h) => h.name.toLowerCase() === 'content-type')) {
        headers.push({ name: 'Content-Type', value: 'application/json' })
      }
      if (!headers.some((h) => h.name.toLowerCase() === 'accept')) {
        headers.push({ name: 'Accept', value: 'application/json' })
      }
    }
  }

  // curl's own rule: data implies POST unless a method was given, and -G moves the
  // data to the query string with a GET.
  if (method === null) method = dataParts.length > 0 || formParts.length > 0 ? 'POST' : 'GET'
  if (forceGet) {
    method = 'GET'
    if (body) {
      url += (url.includes('?') ? '&' : '?') + body
      body = ''
    }
  }

  return { method, url, headers, body, ignored }
}

/** Base64 without Node's Buffer, so this stays a browser-safe pure module. */
function base64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * Quote a value for a POSIX shell.
 *
 * Single quotes with `'\''` for embedded single quotes: the only form that is
 * literal for *every* other character, so nothing in a body or header can be
 * re-interpreted when the line is pasted into a shell. An unquoted "safe-looking"
 * fast path was considered and rejected — deciding what is safe is exactly the bug.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Serialise a request as a curl command.
 *
 * Multi-line with `\` continuations, because that is what is readable and what
 * people paste. `--data-raw` rather than `-d` so curl does not strip newlines from
 * the body.
 */
export function toCurl(input: {
  method: HttpMethod
  url: string
  headers: HeaderRow[]
  body: string
}): string {
  const lines: string[] = [`curl -X ${input.method} ${shellQuote(input.url)}`]
  for (const header of input.headers) {
    if (!header.enabled) continue
    if (header.name.trim() === '') continue
    lines.push(`  -H ${shellQuote(`${header.name.trim()}: ${header.value}`)}`)
  }
  if (input.body && input.method !== 'GET' && input.method !== 'HEAD') {
    lines.push(`  --data-raw ${shellQuote(input.body)}`)
  }
  return lines.join(' \\\n')
}

/** A sentence about what an import could not carry, or null when it was clean. */
export function describeIgnored(ignored: string[]): string | null {
  if (ignored.length === 0) return null
  const shown = ignored.slice(0, 3).join(', ')
  const more = ignored.length > 3 ? ` and ${ignored.length - 3} more` : ''
  return `Imported, but these parts were not carried over: ${shown}${more}.`
}
