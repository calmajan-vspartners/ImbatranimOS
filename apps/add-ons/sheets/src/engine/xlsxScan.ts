/**
 * What this workbook contains that Sheets will not give back.
 *
 * The ExcelJS bridge maps the intersection Univer can render: values, formulas,
 * number formats, bold/italic, font colour and solid fills. Everything else in
 * an `.xlsx` — charts, images, pivot tables, conditional formatting, data
 * validation, defined names, comments, merges, frozen panes — is not in the
 * model, so it is not in the file the bridge writes back. A user could open a
 * colleague's workbook, change one cell, save, and hand back a file that had
 * quietly lost a chart. Brief 63 exists because that is unacceptable *silently*;
 * a user who is warned can decide, a user who is not, loses work.
 *
 * ## Why this reads the zip rather than asking ExcelJS
 *
 * ExcelJS drops most of this on **read**, so by the time there is a `Workbook`
 * object the evidence is already gone — there is no `worksheet.charts` to
 * inspect because ExcelJS never parsed one. The only place the truth survives is
 * the package itself: part names for whole features, and a handful of element
 * names inside the sheet XML for the rest. It is a scan, not a parse: it looks
 * for evidence a feature is present and never tries to understand it.
 *
 * Runs inside the xlsx worker, so its cost is off the UI thread either way, and
 * uses fflate's **synchronous** API — the async one spawns a `blob:` worker that
 * this OS's CSP refuses (see `docs/engine/docxNormalize.ts`, brief 62).
 */

/** A feature the bridge cannot round-trip. */
export type LossyFeature =
  | 'charts'
  | 'images'
  | 'pivotTables'
  | 'tables'
  | 'macros'
  | 'comments'
  | 'conditionalFormatting'
  | 'dataValidation'
  | 'definedNames'
  | 'mergedCells'
  | 'frozenPanes'
  | 'autoFilter'
  | 'hyperlinks'

/**
 * Whether losing it loses the user's *content* or only their *view*.
 *
 * The distinction is the difference between "your chart is gone" and "you will
 * have to re-freeze the header row", and a warning that does not make it reads
 * as crying wolf.
 */
export type Severity = 'content' | 'view'

export const FEATURE_INFO: Record<LossyFeature, { label: string; severity: Severity }> = {
  charts: { label: 'charts', severity: 'content' },
  images: { label: 'images', severity: 'content' },
  pivotTables: { label: 'pivot tables', severity: 'content' },
  tables: { label: 'table ranges', severity: 'content' },
  macros: { label: 'macros', severity: 'content' },
  comments: { label: 'comments', severity: 'content' },
  conditionalFormatting: { label: 'conditional formatting', severity: 'content' },
  dataValidation: { label: 'data validation', severity: 'content' },
  definedNames: { label: 'named ranges', severity: 'content' },
  mergedCells: { label: 'merged cells', severity: 'content' },
  frozenPanes: { label: 'frozen panes', severity: 'view' },
  autoFilter: { label: 'filters', severity: 'view' },
  hyperlinks: { label: 'hyperlinks', severity: 'content' },
}

/** Order the warning lists them in: content first, then view, each stable. */
const REPORT_ORDER: LossyFeature[] = [
  'charts',
  'images',
  'pivotTables',
  'macros',
  'conditionalFormatting',
  'dataValidation',
  'comments',
  'definedNames',
  'tables',
  'mergedCells',
  'hyperlinks',
  'autoFilter',
  'frozenPanes',
]

/** Whole-feature evidence: the presence of a part is the whole test. */
const PART_EVIDENCE: { feature: LossyFeature; test: (name: string) => boolean }[] = [
  { feature: 'charts', test: (n) => n.startsWith('xl/charts/') },
  { feature: 'images', test: (n) => n.startsWith('xl/media/') },
  {
    feature: 'pivotTables',
    test: (n) => n.startsWith('xl/pivotTables/') || n.startsWith('xl/pivotCache/'),
  },
  { feature: 'tables', test: (n) => n.startsWith('xl/tables/') },
  { feature: 'macros', test: (n) => n.endsWith('vbaProject.bin') },
  {
    // Excel writes `xl/comments1.xml`; openpyxl writes `xl/comments/comment1.xml`;
    // modern Excel adds `xl/threadedComments/`. Match all three shapes.
    feature: 'comments',
    test: (n) => /^xl\/(comments|threadedComments)/.test(n),
  },
]

/** Sheet-XML evidence: an element name inside `xl/worksheets/sheetN.xml`. */
const SHEET_EVIDENCE: { feature: LossyFeature; pattern: RegExp }[] = [
  { feature: 'conditionalFormatting', pattern: /<conditionalFormatting[\s>]/ },
  { feature: 'dataValidation', pattern: /<dataValidation[\s>]/ },
  { feature: 'mergedCells', pattern: /<mergeCell[\s>]/ },
  { feature: 'autoFilter', pattern: /<autoFilter[\s>]/ },
  { feature: 'hyperlinks', pattern: /<hyperlink[\s>]/ },
  // Only a FROZEN pane counts. A split pane is a different thing, and a `<pane>`
  // element with no state is the default unsplit view.
  { feature: 'frozenPanes', pattern: /<pane[^>]*state="frozen/ },
]

/**
 * A user-authored defined name, ignoring Excel's built-ins.
 *
 * `_xlnm.*` names are bookkeeping — `_xlnm._FilterDatabase` is created by simply
 * turning on a filter — so counting them would warn about named ranges on every
 * filtered sheet, which is how a warning becomes noise people stop reading.
 */
const USER_DEFINED_NAME = /<definedName\s[^>]*name="(?!_xlnm\.)[^"]+"/

export async function scanXlsx(bytes: ArrayBuffer): Promise<LossyFeature[]> {
  const { unzipSync, strFromU8 } = await import('fflate')
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(bytes))
  } catch {
    // Not a readable zip. Not this function's problem to report — the parse that
    // follows will fail with a real message.
    return []
  }
  return detect(files, strFromU8)
}

function detect(
  files: Record<string, Uint8Array>,
  strFromU8: (b: Uint8Array) => string
): LossyFeature[] {
  const found = new Set<LossyFeature>()
  const names = Object.keys(files)

  for (const { feature, test } of PART_EVIDENCE) {
    if (names.some(test)) found.add(feature)
  }

  for (const name of names) {
    if (!/^xl\/worksheets\/sheet.*\.xml$/.test(name)) continue
    const xml = strFromU8(files[name])
    for (const { feature, pattern } of SHEET_EVIDENCE) {
      if (!found.has(feature) && pattern.test(xml)) found.add(feature)
    }
  }

  const workbookXml = files['xl/workbook.xml']
  if (workbookXml && USER_DEFINED_NAME.test(strFromU8(workbookXml))) {
    found.add('definedNames')
  }

  return REPORT_ORDER.filter((f) => found.has(f))
}

/**
 * Parts ExcelJS 4 cannot survive being handed, and what removing them costs.
 *
 * **Charts break every load, universally.** `xlsx.load` reconciles drawings
 * against their rels and reads `drawing.anchors`, but its drawing transform only
 * builds anchors for `<xdr:pic>` (images) — a chart's `<xdr:graphicFrame>`
 * leaves the model empty, so `anchors` is `undefined` and it throws
 * `TypeError: Cannot read properties of undefined (reading 'anchors')`.
 * Verified with both absolute (`/xl/charts/chart1.xml`) and Excel-style relative
 * (`../charts/chart1.xml`) rel targets — it is not a writer quirk. Any workbook
 * with a chart in it simply could not be opened.
 *
 * **Comments break for some writers.** ExcelJS keys parsed comments by
 * `../commentsN.xml` and only matches `xl/commentsN.xml` at the package root.
 * Excel's own layout works; openpyxl's (`xl/comments/comment1.xml`, absolute rel
 * target) does not, and throws `reading 'comments'`. So a workbook out of a
 * Python pipeline failed where the same workbook out of Excel succeeded.
 *
 * Stripping them is the right trade because the alternative is not opening the
 * file at all, and the save was going to drop these features regardless — the
 * open-time warning already says so. The stripped package exists only in memory,
 * only as ExcelJS's input; the file the user saves is built fresh by
 * `serialize`, so nothing here can reach the disk.
 */
const STRIPPED_PREFIXES = ['xl/drawings/', 'xl/charts/', 'xl/media/', 'xl/threadedComments/']
const STRIPPED_PATTERN = /^xl\/comments/

function isStripped(name: string): boolean {
  return STRIPPED_PREFIXES.some((p) => name.startsWith(p)) || STRIPPED_PATTERN.test(name)
}

/** The basename a rel Target resolves to, however it was written. */
function relTargetsStrippedPart(target: string): boolean {
  // Targets appear as `/xl/charts/chart1.xml`, `../charts/chart1.xml` or
  // `charts/chart1.xml`. Normalising to "does it mention a stripped folder" is
  // enough here and cannot false-negative on a form we have not seen.
  const t = target.replace(/^\/+/, '').replace(/^(\.\.\/)+/, '')
  return isStripped(t.startsWith('xl/') ? t : `xl/${t}`)
}

export type InspectResult = {
  /** Features present in the package that a save will not preserve. */
  lossy: LossyFeature[]
  /**
   * Bytes to hand ExcelJS. Identical to the input when nothing had to be
   * removed, so an untouched workbook is not repacked on the way in.
   */
  bytes: ArrayBuffer
  /** Part names removed so ExcelJS could load the file at all. */
  stripped: string[]
}

/**
 * One unzip: find what a save would drop, and hand back a package ExcelJS can
 * actually load.
 */
export async function inspectXlsx(bytes: ArrayBuffer): Promise<InspectResult> {
  const { unzipSync, zipSync, strFromU8, strToU8 } = await import('fflate')

  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(bytes))
  } catch {
    // Not a readable zip — hand it straight through and let the parse report it.
    return { lossy: [], bytes, stripped: [] }
  }

  const lossy = detect(files, strFromU8)
  const stripped = Object.keys(files).filter(isStripped)
  if (stripped.length === 0) return { lossy, bytes, stripped: [] }

  const kept: Record<string, Uint8Array> = {}
  for (const [name, data] of Object.entries(files)) {
    if (isStripped(name)) continue
    kept[name] = data
  }

  // A rel pointing at a part that is no longer there is exactly what makes
  // ExcelJS reconcile against `undefined`, so the rels must go with the parts.
  for (const name of Object.keys(kept)) {
    if (!name.endsWith('.rels')) continue
    const xml = strFromU8(kept[name])
    const pruned = xml.replace(/<Relationship\b[^>]*\/>/g, (tag) => {
      const target = /\bTarget="([^"]*)"/.exec(tag)?.[1]
      return target && relTargetsStrippedPart(target) ? '' : tag
    })
    if (pruned !== xml) kept[name] = strToU8(pruned)
  }

  // …and the sheet's own references to them.
  for (const name of Object.keys(kept)) {
    if (!/^xl\/worksheets\/sheet.*\.xml$/.test(name)) continue
    const xml = strFromU8(kept[name])
    const pruned = xml.replace(/<(legacyDrawing|drawing|picture)\b[^>]*\/>/g, '')
    if (pruned !== xml) kept[name] = strToU8(pruned)
  }

  const ct = kept['[Content_Types].xml']
  if (ct) {
    const xml = strFromU8(ct)
    const pruned = xml.replace(/<Override\b[^>]*\/>/g, (tag) => {
      const part = /\bPartName="([^"]*)"/.exec(tag)?.[1]
      return part && isStripped(part.replace(/^\/+/, '')) ? '' : tag
    })
    if (pruned !== xml) kept['[Content_Types].xml'] = strToU8(pruned)
  }

  const repacked = zipSync(kept)
  return {
    lossy,
    bytes: repacked.buffer.slice(
      repacked.byteOffset,
      repacked.byteOffset + repacked.byteLength
    ) as ArrayBuffer,
    stripped,
  }
}

/**
 * The sentence shown when a workbook contains things a save would drop.
 *
 * Names them, because "some formatting may be lost" tells the user nothing they
 * can act on. Content losses lead; view losses are a trailing clause so they do
 * not dilute the ones that matter.
 */
export function lossyWarning(features: LossyFeature[]): string | null {
  if (features.length === 0) return null
  const content = features.filter((f) => FEATURE_INFO[f].severity === 'content')
  const view = features.filter((f) => FEATURE_INFO[f].severity === 'view')
  const list = (fs: LossyFeature[]) => joinList(fs.map((f) => FEATURE_INFO[f].label))

  if (content.length === 0) {
    return `Saving will not preserve this workbook's ${list(view)}.`
  }
  const tail = view.length > 0 ? ` It will also lose ${list(view)}.` : ''
  return `This workbook contains ${list(content)}, which Sheets cannot save. Saving will write the cells and lose ${content.length === 1 ? 'it' : 'them'}.${tail}`
}

/** `a`, `a and b`, `a, b and c`. */
function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
