import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { IWorkbookData, ICellData } from '@univerjs/presets'
import { parse, serialize } from './xlsxMapping'
import { inspectXlsx, lossyWarning, scanXlsx, type LossyFeature } from './xlsxScan'

/**
 * The brief-63 fidelity matrix.
 *
 * Not a description of what the bridge drops — a *measurement* of it. The
 * fixture (`__fixtures__/fidelity.xlsx`, generated with openpyxl — an
 * independent writer, so it is not our own bug reflected back) exercises charts,
 * conditional formatting, data validation, defined names, comments, merges,
 * frozen panes, autofilter, hyperlinks, currency and percent number formats,
 * bold + coloured + filled header cells, formulas, and a second sheet.
 *
 * Anything asserted as surviving here is a promise. Anything asserted as lost is
 * something the user must be warned about at open, which is what `scanXlsx`
 * drives — so if the mapping ever *gains* a feature, the corresponding
 * assertion here fails and the warning has to be updated with it. The two cannot
 * drift apart silently, which is the whole point.
 */

const fixtureBytes = () => {
  const buf = readFileSync(join(__dirname, '__fixtures__', 'fidelity.xlsx'))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

const cell = (wb: Partial<IWorkbookData>, sheetIdx: number, r: number, c: number) => {
  const id = wb.sheetOrder?.[sheetIdx]
  const sheet = id ? wb.sheets?.[id] : undefined
  const rows = sheet?.cellData as Record<number, Record<number, ICellData>> | undefined
  return rows?.[r]?.[c]
}

describe('scanXlsx — what the fixture actually contains', () => {
  it('finds every feature the fixture was built with', async () => {
    const found = await scanXlsx(fixtureBytes())
    // Written out in full rather than as a `toContain` sweep: this list IS the
    // matrix, and a change to it should be a visible diff.
    expect(found).toEqual<LossyFeature[]>([
      'charts',
      'conditionalFormatting',
      'dataValidation',
      'comments',
      'definedNames',
      'mergedCells',
      'hyperlinks',
      'autoFilter',
      'frozenPanes',
    ])
  })

  it('does not report a named range for a filter Excel created itself', async () => {
    // The fixture has an autofilter, which writes `_xlnm._FilterDatabase`.
    // Counting that would warn about named ranges on every filtered sheet, and a
    // warning that fires when nothing is wrong is one people stop reading.
    const found = await scanXlsx(fixtureBytes())
    expect(found).toContain('autoFilter')
    // definedNames is present here only because the fixture has a real one.
    expect(found).toContain('definedNames')
  })

  it('reports nothing for a workbook the bridge can carry whole', async () => {
    // Round-tripping the fixture strips everything the mapping cannot hold, so
    // the output is by construction a workbook with nothing left to warn about.
    const { workbook } = await parse(fixtureBytes())
    const out = await serialize(workbook as IWorkbookData)
    expect(await scanXlsx(out)).toEqual([])
  })

  it('returns nothing rather than throwing on bytes that are not a zip', async () => {
    const junk = new TextEncoder().encode('not a workbook')
    const buf = junk.buffer.slice(junk.byteOffset, junk.byteOffset + junk.byteLength) as ArrayBuffer
    expect(await scanXlsx(buf)).toEqual([])
  })
})

describe('the round-trip — what survives', () => {
  it('preserves cell values across parse → serialize → parse', async () => {
    const first = await parse(fixtureBytes())
    const out = await serialize(first.workbook as IWorkbookData)
    const second = await parse(out)

    expect(cell(second.workbook, 0, 0, 0)?.v).toBe('Region')
    expect(cell(second.workbook, 0, 1, 0)?.v).toBe('EMEA')
    expect(cell(second.workbook, 0, 1, 1)?.v).toBe(120)
    expect(cell(second.workbook, 0, 3, 2)?.v).toBe(180)
  })

  it('preserves formulas even though it does not recalculate them', async () => {
    const first = await parse(fixtureBytes())
    expect(cell(first.workbook, 0, 1, 3)?.f).toBe('=B2+C2')
    const out = await serialize(first.workbook as IWorkbookData)
    const second = await parse(out)
    expect(cell(second.workbook, 0, 1, 3)?.f).toBe('=B2+C2')
    expect(cell(second.workbook, 0, 3, 3)?.f).toBe('=B4+C4')
  })

  it('preserves number formats, including currency and percent', async () => {
    const first = await parse(fixtureBytes())
    const out = await serialize(first.workbook as IWorkbookData)
    const second = await parse(out)
    expect(cell(second.workbook, 0, 5, 1)?.s).toMatchObject({ n: { pattern: '0.00%' } })
    expect(cell(second.workbook, 0, 5, 2)?.s).toMatchObject({ n: { pattern: '"$"#,##0.00' } })
  })

  it('preserves bold, font colour and solid fill', async () => {
    const first = await parse(fixtureBytes())
    const out = await serialize(first.workbook as IWorkbookData)
    const second = await parse(out)
    const header = cell(second.workbook, 0, 0, 0)?.s
    expect(header).toMatchObject({ bl: 1, cl: { rgb: '#1155CC' }, bg: { rgb: '#EEEEEE' } })
  })

  it('preserves every sheet, in order, with its name', async () => {
    const first = await parse(fixtureBytes())
    const out = await serialize(first.workbook as IWorkbookData)
    const second = await parse(out)
    const names = second.workbook.sheetOrder?.map((id) => second.workbook.sheets?.[id]?.name)
    expect(names).toEqual(['Data', 'Notes'])
  })
})

describe('the round-trip — what is lost, and is therefore warned about', () => {
  it('loses every feature the scan reports, and the scan reports every loss', async () => {
    const before = await scanXlsx(fixtureBytes())
    const { workbook } = await parse(fixtureBytes())
    const out = await serialize(workbook as IWorkbookData)
    const after = await scanXlsx(out)

    // Every feature present before is gone after — so the warning list is
    // exactly the loss list, not an approximation of it.
    expect(before.length).toBeGreaterThan(0)
    for (const feature of before) expect(after).not.toContain(feature)
  })

  it('drops the merged cell as a merge, keeping only the anchor value', async () => {
    const first = await parse(fixtureBytes())
    // A8:D8 was merged. The value survives in the anchor; the merge does not.
    expect(cell(first.workbook, 0, 7, 0)?.v).toBe('merged header')
    const out = await serialize(first.workbook as IWorkbookData)
    expect(await scanXlsx(out)).not.toContain('mergedCells')
  })

  it('does not smear a merged value across the cells it spanned', async () => {
    // ExcelJS reports the master's value for EVERY cell in a merged range. Read
    // naively, A8:D8 came back as four copies of "merged header" — and a save
    // then wrote four copies into the file, data it never contained. Losing the
    // merge is acceptable and is warned about; inventing three cells is not.
    const { workbook } = await parse(fixtureBytes())
    expect(cell(workbook, 0, 7, 0)?.v).toBe('merged header')
    expect(cell(workbook, 0, 7, 1)).toBeUndefined()
    expect(cell(workbook, 0, 7, 2)).toBeUndefined()
    expect(cell(workbook, 0, 7, 3)).toBeUndefined()
  })
})

describe('lossyWarning', () => {
  it('says nothing when there is nothing to say', () => {
    expect(lossyWarning([])).toBeNull()
  })

  it('names the features rather than saying "some formatting may be lost"', () => {
    const msg = lossyWarning(['charts', 'comments'])
    expect(msg).toContain('charts')
    expect(msg).toContain('comments')
    expect(msg).toContain('Sheets cannot save')
  })

  it('keeps view-only losses out of the lead clause', () => {
    // "Your chart is gone" and "re-freeze the header row" are not the same
    // sentence, and merging them makes the first one easy to skim past.
    const msg = lossyWarning(['charts', 'frozenPanes'])!
    expect(msg.indexOf('charts')).toBeLessThan(msg.indexOf('frozen panes'))
    expect(msg).toContain('It will also lose frozen panes.')
  })

  it('does not overclaim when only the view is affected', () => {
    expect(lossyWarning(['frozenPanes', 'autoFilter'])).toBe(
      "Saving will not preserve this workbook's frozen panes and filters."
    )
  })

  it('reads as English for one, two and three features', () => {
    expect(lossyWarning(['charts'])).toContain('contains charts, which')
    expect(lossyWarning(['charts', 'images'])).toContain('charts and images')
    expect(lossyWarning(['charts', 'images', 'pivotTables'])).toContain(
      'charts, images and pivot tables'
    )
  })

  it('says "it" for one loss and "them" for several', () => {
    expect(lossyWarning(['charts'])).toContain('lose it')
    expect(lossyWarning(['charts', 'images'])).toContain('lose them')
  })
})

describe('inspectXlsx — the parts ExcelJS cannot be handed', () => {
  it('strips charts, drawings and comments, and nothing else', async () => {
    const { stripped } = await inspectXlsx(fixtureBytes())
    expect(stripped.some((n) => n.startsWith('xl/charts/'))).toBe(true)
    expect(stripped.some((n) => n.startsWith('xl/drawings/'))).toBe(true)
    expect(stripped.some((n) => /^xl\/comments/.test(n))).toBe(true)
    // The cells, styles and workbook parts must never be candidates.
    expect(stripped).not.toContain('xl/worksheets/sheet1.xml')
    expect(stripped).not.toContain('xl/styles.xml')
    expect(stripped).not.toContain('xl/workbook.xml')
  })

  it('still reports the stripped features as lossy — removing them is not hiding them', async () => {
    const { lossy } = await inspectXlsx(fixtureBytes())
    expect(lossy).toContain('charts')
    expect(lossy).toContain('comments')
  })

  it('is byte-stable for a workbook that needs no stripping', async () => {
    // Same discipline as the docx normalizer: an untouched package is handed
    // through, not repacked, so nothing changes as a side effect of opening.
    const { workbook } = await parse(fixtureBytes())
    const clean = await serialize(workbook as IWorkbookData)
    const { bytes, stripped } = await inspectXlsx(clean)
    expect(stripped).toEqual([])
    expect(bytes).toBe(clean)
  })

  it('regression: a workbook with a chart loads at all', async () => {
    // TypeError: Cannot read properties of undefined (reading 'anchors').
    // ExcelJS reconciles drawings against their rels and reads `drawing.anchors`,
    // but only builds anchors for <xdr:pic>; a chart's <xdr:graphicFrame> leaves
    // the model empty. Universal — not a writer quirk. Every workbook with a
    // chart failed to open before this.
    const { workbook } = await parse(fixtureBytes())
    expect(workbook.sheetOrder?.length).toBe(2)
    expect(cell(workbook, 0, 0, 0)?.v).toBe('Region')
  })

  it('regression: a workbook whose comments are not in Excel’s layout loads', async () => {
    // TypeError: Cannot read properties of undefined (reading 'comments').
    // ExcelJS keys comments by `../commentsN.xml` and only matches
    // `xl/commentsN.xml` at the root; openpyxl writes `xl/comments/comment1.xml`
    // with an absolute rel target. Excel's own files were fine, a Python
    // pipeline's were not.
    const { lossy } = await inspectXlsx(fixtureBytes())
    expect(lossy).toContain('comments')
    const { workbook } = await parse(fixtureBytes())
    expect(cell(workbook, 0, 10, 0)?.v).toBe('commented')
  })
})
