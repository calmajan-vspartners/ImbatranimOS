import { describe, expect, it } from 'vitest'
import { buildMultipart, bytesToBase64, contentTypeFor, newBoundary } from './multipart'

const decode = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes)

describe('buildMultipart', () => {
  it('writes a text field the way a server expects to read it', () => {
    const { bytes, contentType } = buildMultipart([{ name: 'title', value: 'hello' }])
    const boundary = /boundary=(.+)$/.exec(contentType)![1]
    const text = decode(bytes)
    expect(text).toBe(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="title"\r\n\r\n` +
        `hello\r\n` +
        `--${boundary}--\r\n`
    )
  })

  it('gives the Content-Type and the body the SAME boundary', () => {
    // If these disagree the server sees an empty form and nothing explains why.
    const { bytes, contentType } = buildMultipart([{ name: 'a', value: '1' }])
    const boundary = /boundary=(.+)$/.exec(contentType)![1]
    expect(decode(bytes).startsWith(`--${boundary}\r\n`)).toBe(true)
    expect(decode(bytes).endsWith(`--${boundary}--\r\n`)).toBe(true)
  })

  it('writes a file part with a filename and a content type', () => {
    const { bytes } = buildMultipart([
      {
        name: 'upload',
        bytes: new Uint8Array([1, 2, 3]),
        fileName: 'a.png',
        contentType: 'image/png',
      },
    ])
    const text = decode(bytes)
    expect(text).toContain('Content-Disposition: form-data; name="upload"; filename="a.png"')
    expect(text).toContain('Content-Type: image/png')
  })

  it('keeps binary bytes intact, including NUL and 0xFF', () => {
    const raw = new Uint8Array([0x00, 0xff, 0x0d, 0x0a, 0x41])
    const { bytes } = buildMultipart([{ name: 'f', bytes: raw, fileName: 'b.bin' }])
    // Find the raw payload between the blank line and the trailing CRLF.
    const marker = decode(bytes).indexOf('\r\n\r\n') + 4
    expect(Array.from(bytes.subarray(marker, marker + raw.length))).toEqual(Array.from(raw))
  })

  it('writes several parts in order', () => {
    const { bytes } = buildMultipart([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
    ])
    const text = decode(bytes)
    expect(text.indexOf('name="a"')).toBeLessThan(text.indexOf('name="b"'))
  })

  it('neutralises a quote or newline in a field name, so a part cannot be split', () => {
    // A raw CR/LF here would terminate the header and let a caller inject their own
    // part; a raw quote would end the name parameter.
    const { bytes } = buildMultipart([{ name: 'a"\r\nX-Evil: 1', value: 'v' }])
    const text = decode(bytes)
    expect(text).toContain('name="a%22%0D%0AX-Evil: 1"')
    expect(text.split('\r\n\r\n')).toHaveLength(2)
  })

  it('handles an empty part list', () => {
    const { bytes, contentType } = buildMultipart([])
    const boundary = /boundary=(.+)$/.exec(contentType)![1]
    expect(decode(bytes)).toBe(`--${boundary}--\r\n`)
  })

  it('encodes a UTF-8 value as UTF-8 bytes', () => {
    const { bytes } = buildMultipart([{ name: 'n', value: 'café' }])
    expect(new TextDecoder().decode(bytes)).toContain('café')
  })
})

describe('newBoundary', () => {
  it('is unique per call', () => {
    expect(newBoundary()).not.toBe(newBoundary())
  })

  it('contains only boundary-legal characters', () => {
    expect(newBoundary()).toMatch(/^[A-Za-z0-9'()+_,\-./:=?-]+$/)
  })
})

describe('bytesToBase64', () => {
  it('round-trips', () => {
    const raw = new Uint8Array([0, 1, 250, 255, 65])
    const back = Uint8Array.from(atob(bytesToBase64(raw)), (c) => c.charCodeAt(0))
    expect(Array.from(back)).toEqual(Array.from(raw))
  })

  it('handles a payload larger than the chunk size without blowing the stack', () => {
    // String.fromCharCode(...bytes) on a big array throws; the chunking exists for this.
    const raw = new Uint8Array(200_000).fill(7)
    const b64 = bytesToBase64(raw)
    expect(atob(b64).length).toBe(200_000)
  })

  it('is empty for no bytes', () => {
    expect(bytesToBase64(new Uint8Array())).toBe('')
  })
})

describe('contentTypeFor', () => {
  it('knows the common ones', () => {
    expect(contentTypeFor('a.json')).toBe('application/json')
    expect(contentTypeFor('photo.JPG')).toBe('image/jpeg')
    expect(contentTypeFor('dir/x.png')).toBe('image/png')
  })

  it('falls back to octet-stream', () => {
    expect(contentTypeFor('a.weird')).toBe('application/octet-stream')
    expect(contentTypeFor('noext')).toBe('application/octet-stream')
  })
})
