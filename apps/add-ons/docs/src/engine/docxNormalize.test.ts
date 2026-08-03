import { describe, expect, it } from 'vitest'
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate'
import { normalizeDocx } from './docxNormalize'

/**
 * Fixtures for the brief-62 coverage audit.
 *
 * The defect this module exists for is not hypothetical: SuperDoc's exporter
 * dereferences three parts without a null-guard, and when one is missing the
 * export throws and `SuperDoc.export()` falls back to the ORIGINAL bytes — so a
 * save silently discards every edit. There is one fixture per part, so a
 * regression in any of the three is caught rather than discovered by a user
 * whose afternoon of edits did not save.
 */

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`

const PACKAGE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>`

const ALL_PARTS = {
  '[Content_Types].xml': CONTENT_TYPES,
  '_rels/.rels': PACKAGE_RELS,
  'word/document.xml': DOCUMENT,
  'word/styles.xml': '<?xml version="1.0"?><w:styles xmlns:w="x"/>',
  'word/_rels/document.xml.rels':
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
  'docProps/custom.xml': '<?xml version="1.0"?><Properties xmlns="x"/>',
} as const

/** A docx zip containing every part except those named in `without`. */
function docx(without: string[] = [], overrides: Record<string, string> = {}): ArrayBuffer {
  const files: Record<string, Uint8Array> = {}
  for (const [name, xml] of Object.entries({ ...ALL_PARTS, ...overrides })) {
    if (without.includes(name)) continue
    files[name] = strToU8(xml)
  }
  const zipped = zipSync(files)
  // A standalone ArrayBuffer, matching what fetchFileBytes hands the app.
  return zipped.buffer.slice(
    zipped.byteOffset,
    zipped.byteOffset + zipped.byteLength
  ) as ArrayBuffer
}

const partsOf = (bytes: Uint8Array) => Object.keys(unzipSync(bytes)).sort()
const textOf = (bytes: Uint8Array, part: string) => strFromU8(unzipSync(bytes)[part])

describe('normalizeDocx — a complete document', () => {
  it('is byte-stable: the same array comes back, not a repack', async () => {
    const input = docx()
    const result = await normalizeDocx(input)
    expect(result.readable).toBe(true)
    expect(result.repaired).toEqual([])
    // Identity, not just equality. An open→save with no edits must not rewrite
    // the package as a side effect of having been opened.
    expect(result.bytes).toEqual(new Uint8Array(input))
    expect(result.bytes.byteLength).toBe(input.byteLength)
  })

  it('does not duplicate a Content_Types override that already exists', async () => {
    const result = await normalizeDocx(docx())
    const ct = textOf(result.bytes, '[Content_Types].xml')
    expect(ct.match(/\/word\/styles\.xml/g)?.length ?? 0).toBeLessThanOrEqual(1)
  })
})

describe('normalizeDocx — one missing part per fixture', () => {
  it('synthesises word/styles.xml and declares it', async () => {
    const result = await normalizeDocx(docx(['word/styles.xml']))
    expect(result.repaired).toEqual(['word/styles.xml'])
    expect(partsOf(result.bytes)).toContain('word/styles.xml')
    // SuperDoc's importer hangs on an EMPTY <w:styles/>, so the stand-in must
    // carry docDefaults and Word's default styles — not just be present.
    const styles = textOf(result.bytes, 'word/styles.xml')
    expect(styles).toContain('docDefaults')
    expect(styles).toContain('w:styleId="Normal"')
    expect(textOf(result.bytes, '[Content_Types].xml')).toContain('/word/styles.xml')
  })

  it('synthesises word/_rels/document.xml.rels pointing at styles.xml', async () => {
    const result = await normalizeDocx(docx(['word/_rels/document.xml.rels']))
    expect(result.repaired).toEqual(['word/_rels/document.xml.rels'])
    expect(textOf(result.bytes, 'word/_rels/document.xml.rels')).toContain('styles.xml')
  })

  it('synthesises docProps/custom.xml and wires it into the package rels', async () => {
    const result = await normalizeDocx(docx(['docProps/custom.xml']))
    expect(result.repaired).toEqual(['docProps/custom.xml'])
    expect(partsOf(result.bytes)).toContain('docProps/custom.xml')
    expect(textOf(result.bytes, '[Content_Types].xml')).toContain('/docProps/custom.xml')
    // custom.xml is referenced from _rels/.rels, NOT document.xml.rels — getting
    // that wrong produces a package Word opens but SuperDoc still cannot export.
    expect(textOf(result.bytes, '_rels/.rels')).toContain('custom-properties')
  })

  it('repairs all three at once, and reports all three', async () => {
    const result = await normalizeDocx(
      docx(['word/styles.xml', 'word/_rels/document.xml.rels', 'docProps/custom.xml'])
    )
    expect(result.repaired).toEqual([
      'word/styles.xml',
      'word/_rels/document.xml.rels',
      'docProps/custom.xml',
    ])
    expect(partsOf(result.bytes)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/custom.xml',
      'word/_rels/document.xml.rels',
      'word/document.xml',
      'word/styles.xml',
    ])
  })

  it('leaves the document body untouched while repairing', async () => {
    // The repair must add parts, never rewrite content. A normalizer that
    // damages the body would trade one silent-data-loss bug for another.
    const result = await normalizeDocx(docx(['word/styles.xml']))
    expect(textOf(result.bytes, 'word/document.xml')).toBe(DOCUMENT)
  })
})

describe('normalizeDocx — what it does not repair', () => {
  it('reports a file that is not a zip instead of pretending it is a docx', async () => {
    const notAZip = strToU8('this is a .docx by name only')
    const input = notAZip.buffer.slice(
      notAZip.byteOffset,
      notAZip.byteOffset + notAZip.byteLength
    ) as ArrayBuffer
    const result = await normalizeDocx(input)
    expect(result.readable).toBe(false)
    expect(result.repaired).toEqual([])
    expect(result.bytes).toEqual(new Uint8Array(input))
  })

  it('leaves other optional parts absent, because their absence does not throw', async () => {
    // numbering/settings/theme are read defensively by the exporter. Repairing
    // them would mean inventing content the document never had.
    const result = await normalizeDocx(docx())
    const parts = partsOf(result.bytes)
    expect(parts).not.toContain('word/numbering.xml')
    expect(parts).not.toContain('word/settings.xml')
    expect(result.repaired).toEqual([])
  })
})
