/**
 * docx normalization for SuperDoc round-trip.
 *
 * SuperDoc's docx exporter reads three parts **unconditionally** (via
 * `converter.convertedXml[part].elements[0]`, no null-guard): `word/styles.xml`,
 * `word/_rels/document.xml.rels`, and `docProps/custom.xml`. If any is absent,
 * export throws `TypeError: reading 'elements'` and `SuperDoc.export()` silently
 * falls back to the ORIGINAL bytes — so edits are lost on save. Minimal or
 * tool-generated docx files (and many real Word files, which omit custom.xml)
 * trip this.
 *
 * Fix: before handing bytes to SuperDoc, ensure those parts exist. Missing ones
 * get minimal valid stand-ins and are wired into `[Content_Types].xml` /
 * `_rels/.rels`. Files that already contain a part are left untouched, and a
 * docx that already has all three is returned byte-for-byte unchanged. `fflate`
 * is dynamically imported so it never lands in the desktop boot bundle, and only
 * its **synchronous** API is used — see the note at the top of `normalizeDocx`
 * for why the async one cannot work here.
 *
 * ## Coverage audit (brief 62)
 *
 * What this module repairs — and therefore what cannot fall through to the
 * silent-original-bytes failure — is exactly the three parts SuperDoc's exporter
 * dereferences without a guard:
 *
 * | Part                            | Missing → | Repair                        |
 * |---------------------------------|-----------|-------------------------------|
 * | `word/styles.xml`               | export throws | `docDefaults` + Word's four default styles, declared in `[Content_Types].xml` |
 * | `word/_rels/document.xml.rels`  | export throws | a rels part pointing at `styles.xml` |
 * | `docProps/custom.xml`           | export throws | an empty `Properties` element, declared in `[Content_Types].xml` **and** wired into `_rels/.rels` |
 *
 * Nothing else is repaired, and nothing else needs to be: the failure mode is
 * specifically an unguarded `convertedXml[part].elements[0]`, and these are the
 * three parts read that way. Other missing optional parts (`word/numbering.xml`,
 * `word/settings.xml`, `word/theme/theme1.xml`, headers/footers) are read
 * defensively by the exporter and their absence does not throw — a document
 * without them exports its edits correctly.
 *
 * What is *not* covered, and is reported rather than repaired: a file that is
 * not a readable zip at all. `readable: false` comes back so the app can refuse
 * it with a clear message instead of letting the engine fail like a broken app.
 */

/** The parts this module can synthesise when a document is missing them. */
export type RepairablePart =
  | 'word/styles.xml'
  | 'word/_rels/document.xml.rels'
  | 'docProps/custom.xml'

export type NormalizeResult = {
  /** Bytes to hand the engine. Identical to the input when nothing was needed. */
  bytes: Uint8Array
  /** Parts that were absent and have been synthesised. Empty when none were. */
  repaired: RepairablePart[]
  /**
   * False when the input is not a readable zip. The bytes are handed back
   * unchanged, but the caller should refuse the file rather than load it.
   */
  readable: boolean
}

// A complete-enough styles part: SuperDoc's importer hangs on an *empty*
// `<w:styles/>`, so this carries `docDefaults` plus the four default styles Word
// always emits. Only used when the source has no styles.xml at all.
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style><w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style></w:styles>`

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`

const CUSTOM_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"></Properties>`

const STYLES_PART = 'word/styles.xml'
const DOCUMENT_RELS_PART = 'word/_rels/document.xml.rels'
const CUSTOM_PART = 'docProps/custom.xml'
const CONTENT_TYPES = '[Content_Types].xml'
const PACKAGE_RELS = '_rels/.rels'

const STYLES_CT =
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
const CUSTOM_CT =
  '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>'
const CUSTOM_REL =
  '<Relationship Id="rIdImbatranimCustomProps" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>'

/**
 * Ensure a docx contains the parts SuperDoc's exporter requires. Returns the
 * original bytes untouched if nothing was missing; otherwise a repacked zip.
 */
export async function normalizeDocx(bytes: ArrayBuffer): Promise<NormalizeResult> {
  const { unzipSync, zipSync, strToU8, strFromU8 } = await import('fflate')
  const original = new Uint8Array(bytes)

  // SYNC on purpose. fflate's async `unzip`/`zip` run in a worker it spawns from
  // a `blob:` URL, and the OS's own CSP refuses that: `worker-src` is unset, so
  // it falls back to `script-src 'self'`, and a blob URL is not 'self'. The
  // browser logs "Refused to create a worker from 'blob:…'", fflate 0.4.8 then
  // throws inside its own error handler instead of calling our callback, and the
  // promise never settles — so Docs sat on "Loading document…" forever and could
  // not open ANY .docx in a shipped image. There was no error, no timeout and no
  // notification, because nothing ever rejected.
  //
  // The sync variants produce identical output with no worker and no blob URL. A
  // docx is a small zip (tens of KB to a few MB) and this runs once, behind the
  // open overlay, so the main-thread cost is not perceptible. If a genuinely
  // huge document ever makes it jank, the fix is our own module worker — the
  // `?worker` pattern Monaco and the Sheets ExcelJS bridge already use, which is
  // same-origin and therefore CSP-clean. Do NOT go back to fflate's async API.
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(original)
  } catch {
    // Not a readable zip. Hand the bytes back and say so, so the caller can
    // refuse the file with a real message instead of letting the engine fail.
    return { bytes: original, repaired: [], readable: false }
  }

  const addedStyles = !files[STYLES_PART]
  const addedRels = !files[DOCUMENT_RELS_PART]
  const addedCustom = !files[CUSTOM_PART]
  const repaired: RepairablePart[] = []
  if (addedStyles) repaired.push(STYLES_PART)
  if (addedRels) repaired.push(DOCUMENT_RELS_PART)
  if (addedCustom) repaired.push(CUSTOM_PART)
  // Byte-stable when nothing is missing: the same array comes back, so an
  // open→save with no edits cannot rewrite the package as a side effect.
  if (repaired.length === 0) return { bytes: original, repaired, readable: true }

  if (addedStyles) files[STYLES_PART] = strToU8(STYLES_XML)
  if (addedRels) files[DOCUMENT_RELS_PART] = strToU8(DOCUMENT_RELS_XML)
  if (addedCustom) files[CUSTOM_PART] = strToU8(CUSTOM_XML)

  // Wire new parts into [Content_Types].xml (idempotent: only if not declared).
  if (files[CONTENT_TYPES]) {
    let ct = strFromU8(files[CONTENT_TYPES])
    let extra = ''
    if (files[STYLES_PART] && !ct.includes('/word/styles.xml')) extra += STYLES_CT
    if (files[CUSTOM_PART] && !ct.includes('/docProps/custom.xml')) extra += CUSTOM_CT
    if (extra && ct.includes('</Types>')) {
      ct = ct.replace('</Types>', extra + '</Types>')
      files[CONTENT_TYPES] = strToU8(ct)
    }
  }

  // custom.xml is referenced from the package-level rels, not document.xml.rels.
  if (addedCustom && files[PACKAGE_RELS]) {
    let rels = strFromU8(files[PACKAGE_RELS])
    if (!rels.includes('custom-properties') && rels.includes('</Relationships>')) {
      rels = rels.replace('</Relationships>', CUSTOM_REL + '</Relationships>')
      files[PACKAGE_RELS] = strToU8(rels)
    }
  }

  return { bytes: zipSync(files), repaired, readable: true }
}
