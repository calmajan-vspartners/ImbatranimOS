import type { FormField } from '../types'

/**
 * Building a multipart body by hand.
 *
 * The proxy takes bytes (`bodyBase64`, brief 77) and does not compose bodies, so the
 * multipart envelope is assembled here. That is the right split: the proxy stays a
 * dumb relay whose guardrails are about *where* a request goes, not what is in it.
 *
 * `FormData` is deliberately not used even though the browser has it. It would give
 * a `FormData` object, and the only way to get its bytes is to hand it to `fetch` —
 * which is exactly what this app cannot do, since every request goes through the
 * proxy as JSON. So the envelope is written out explicitly, which also means the
 * boundary and the `Content-Type` header are chosen here and cannot disagree.
 */

/** A boundary no realistic body will contain, from the platform CSPRNG. */
export function newBoundary(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return `----ImbatranimFormBoundary${hex}`
}

/** Escape a name for a `Content-Disposition` parameter, per RFC 6266's practice. */
function quoteName(name: string): string {
  // Browsers percent-encode CR/LF/quote here rather than escaping them; matching that
  // matters because a raw newline would end the header and split the part.
  return name.replace(/["\r\n]/g, (ch) => (ch === '"' ? '%22' : ch === '\r' ? '%0D' : '%0A'))
}

const encoder = new TextEncoder()

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out
}

export type MultipartPart = {
  name: string
  /** A text value… */
  value?: string
  /** …or a file: its bytes plus the name to report. */
  bytes?: Uint8Array
  fileName?: string
  contentType?: string
}

/**
 * Assemble the multipart/form-data body.
 *
 * Returns the bytes and the exact `Content-Type` that describes them — the two must
 * travel together, so they are produced together.
 */
export function buildMultipart(parts: MultipartPart[]): {
  bytes: Uint8Array
  contentType: string
} {
  const boundary = newBoundary()
  const chunks: Uint8Array[] = []
  for (const part of parts) {
    const disposition =
      part.bytes !== undefined
        ? `form-data; name="${quoteName(part.name)}"; filename="${quoteName(part.fileName ?? 'file')}"`
        : `form-data; name="${quoteName(part.name)}"`
    const type =
      part.bytes !== undefined
        ? `\r\nContent-Type: ${part.contentType ?? 'application/octet-stream'}`
        : ''
    chunks.push(
      encoder.encode(`--${boundary}\r\nContent-Disposition: ${disposition}${type}\r\n\r\n`)
    )
    chunks.push(part.bytes ?? encoder.encode(part.value ?? ''))
    chunks.push(encoder.encode('\r\n'))
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`))
  return {
    bytes: concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

/** Base64 for the proxy's `bodyBase64`, chunked so a large file cannot blow the stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** The enabled, named rows of a form — what actually gets sent. */
export function activeFields(fields: FormField[]): FormField[] {
  return fields.filter((f) => f.enabled && f.name.trim() !== '')
}

/** A guess at a file's content type from its extension; octet-stream otherwise. */
export function contentTypeFor(path: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? ''
  const map: Record<string, string> = {
    json: 'application/json',
    txt: 'text/plain',
    csv: 'text/csv',
    xml: 'application/xml',
    html: 'text/html',
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    zip: 'application/zip',
  }
  return map[ext] ?? 'application/octet-stream'
}
