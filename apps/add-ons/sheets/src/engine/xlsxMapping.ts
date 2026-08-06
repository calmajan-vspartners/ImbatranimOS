/**
 * The ExcelJS <-> Univer cell mapping.
 *
 * Split out of `xlsxWorker.ts` (moved verbatim, not rewritten) so the fidelity
 * matrix can call it directly from a test. The worker module has a side effect —
 * it assigns `self.onmessage` — so importing it in node is not possible; a
 * fidelity claim nobody can run is not a fidelity claim.
 *
 * This module owns the mapping and nothing else. `xlsxWorker.ts` owns the
 * threading, `xlsxScan.ts` owns finding what the mapping cannot carry.
 */
import type ExcelJS from 'exceljs'
import type { IWorkbookData, ICellData, IStyleData, IWorksheetData } from '@univerjs/presets'
import { inspectXlsx, type LossyFeature } from './xlsxScan'

/** A parsed workbook plus what the package held that the mapping cannot carry. */
export type ParseResult = {
  workbook: Partial<IWorkbookData>
  lossy: LossyFeature[]
}

// exceljs is CJS; grab whichever shape the interop hands back.
async function loadExcelJS(): Promise<typeof ExcelJS> {
  const mod = (await import('exceljs')) as unknown as {
    default?: typeof ExcelJS
  } & typeof ExcelJS
  return mod.default ?? mod
}

// ── Color helpers ──────────────────────────────────────────────────────────
// ExcelJS speaks 8-digit ARGB; Univer speaks CSS-ish hex. Normalize between.
function argbToHex(argb?: string | null): string | undefined {
  if (!argb) return undefined
  const h = argb.replace(/^#/, '')
  return '#' + h.slice(-6).toUpperCase()
}
function hexToArgb(hex?: string | null): string | undefined {
  if (!hex) return undefined
  return 'FF' + hex.replace(/^#/, '').slice(-6).toUpperCase()
}

// ── Style vocabularies ─────────────────────────────────────────────────────
// Brief 90's real Sheets gap was not missing UI — Univer ships a full ribbon —
// but that the ribbon let a user set underline, font size, font family,
// alignment, wrap and borders, and this bridge carried NONE of them. Set a
// border, save, reopen: gone, silently. So the mapping below covers everything
// the ribbon can produce that xlsx can store, in BOTH directions, and the
// fidelity matrix asserts each one round-trips.
//
// Numeric literals rather than importing Univer's enums: this module is imported
// by the worker AND by tests, and pulling @univerjs/core in for six constants
// would drag the engine into both. The values are from
// `@univerjs/core/types/enum/text-style` and `border-style-types`, and the tests
// pin them.

/** Univer HorizontalAlign */
const H_LEFT = 1
const H_CENTER = 2
const H_RIGHT = 3
/** Univer VerticalAlign */
const V_TOP = 1
const V_MIDDLE = 2
const V_BOTTOM = 3
/** Univer WrapStrategy */
const WRAP_OVERFLOW = 1
const WRAP_CLIP = 2
const WRAP_WRAP = 3
/** Univer BorderStyleTypes — the subset Excel's own border picker offers. */
const B_NONE = 0
const B_THIN = 1
const B_HAIR = 2
const B_DOTTED = 3
const B_DASHED = 4
const B_DOUBLE = 7
const B_MEDIUM = 8
const B_THICK = 13

/** ExcelJS border style name ↔ Univer BorderStyleTypes. */
const BORDER_TO_UNIVER: Record<string, number> = {
  thin: B_THIN,
  hair: B_HAIR,
  dotted: B_DOTTED,
  dashed: B_DASHED,
  double: B_DOUBLE,
  medium: B_MEDIUM,
  thick: B_THICK,
  dashDot: B_DASHED,
  dashDotDot: B_DASHED,
  mediumDashed: B_MEDIUM,
  mediumDashDot: B_MEDIUM,
  mediumDashDotDot: B_MEDIUM,
  slantDashDot: B_MEDIUM,
}
const UNIVER_TO_BORDER: Record<number, ExcelJS.BorderStyle> = {
  [B_THIN]: 'thin',
  [B_HAIR]: 'hair',
  [B_DOTTED]: 'dotted',
  [B_DASHED]: 'dashed',
  [B_DOUBLE]: 'double',
  [B_MEDIUM]: 'medium',
  [B_THICK]: 'thick',
}

/** The four edges, in the two libraries' own names. */
const EDGES = [
  { univer: 't', excel: 'top' },
  { univer: 'r', excel: 'right' },
  { univer: 'b', excel: 'bottom' },
  { univer: 'l', excel: 'left' },
] as const

// ── ExcelJS cell → Univer ──────────────────────────────────────────────────
function cellToUniverStyle(cell: ExcelJS.Cell): IStyleData | undefined {
  const st: IStyleData = {}
  const font = cell.font
  if (font?.bold) st.bl = 1
  if (font?.italic) st.it = 1
  // `s: 1` is Univer's "show this decoration"; the colour follows the font.
  if (font?.underline) st.ul = { s: 1 }
  if (font?.strike) st.st = { s: 1 }
  if (font?.name) st.ff = font.name
  // Excel stores size in points and so does Univer, so this is a copy, not a
  // conversion — but guard the value: a 0 or a NaN renders as invisible text.
  if (typeof font?.size === 'number' && font.size > 0) st.fs = font.size
  const fontColor = argbToHex(font?.color?.argb)
  if (fontColor) st.cl = { rgb: fontColor }

  const fill = cell.fill
  if (fill && fill.type === 'pattern' && fill.pattern === 'solid') {
    const bg = argbToHex(fill.fgColor?.argb)
    if (bg) st.bg = { rgb: bg }
  }

  const align = cell.alignment
  if (align?.horizontal === 'left') st.ht = H_LEFT
  else if (align?.horizontal === 'center') st.ht = H_CENTER
  else if (align?.horizontal === 'right') st.ht = H_RIGHT
  if (align?.vertical === 'top') st.vt = V_TOP
  else if (align?.vertical === 'middle') st.vt = V_MIDDLE
  else if (align?.vertical === 'bottom') st.vt = V_BOTTOM
  // Excel models wrap and shrink separately; Univer has one strategy, so wrap
  // wins where both are set — losing "shrink to fit" is visible, losing the wrap
  // reflows the text.
  if (align?.wrapText) st.tb = WRAP_WRAP

  const borders = cellToUniverBorders(cell)
  if (borders) st.bd = borders

  const nf = cell.numFmt
  if (nf && nf !== 'General') st.n = { pattern: nf }
  return Object.keys(st).length ? st : undefined
}

function cellToUniverBorders(cell: ExcelJS.Cell): IStyleData['bd'] | undefined {
  const src = cell.border
  if (!src) return undefined
  const bd: Record<string, { s: number; cl: { rgb: string } }> = {}
  for (const edge of EDGES) {
    const side = src[edge.excel]
    if (!side?.style) continue
    const s = BORDER_TO_UNIVER[side.style] ?? B_THIN
    if (s === B_NONE) continue
    // Univer requires a colour on a border; Excel's default is black.
    bd[edge.univer] = { s, cl: { rgb: argbToHex(side.color?.argb) ?? '#000000' } }
  }
  return Object.keys(bd).length ? (bd as IStyleData['bd']) : undefined
}

/**
 * A JS `Date` as an Excel **serial number** — days since the 1899-12-30 epoch,
 * with a fractional part for the time of day.
 *
 * Excel (and Univer) store a date as this number under a *date* number format;
 * the old code wrote the `Date` back as ISO TEXT (`v.toISOString()`), which left
 * a string sitting under a date numFmt so Excel could no longer sort, filter, or
 * compute with it. Reuses ExcelJS's own constant (`25569` = 1970-01-01 in the
 * serial system), which already bakes in Excel's phantom 1900-02-29 for every
 * real-world date — so a value read here round-trips back to the same serial
 * ExcelJS would have written.
 */
function dateToExcelSerial(d: Date): number {
  return 25569 + d.getTime() / (24 * 3600 * 1000)
}

function cellValueToUniver(cell: ExcelJS.Cell): Pick<ICellData, 'v' | 'f'> {
  const v = cell.value
  if (v == null) return {}
  if (typeof v === 'object') {
    if ('formula' in v || 'sharedFormula' in v) {
      // Read formulas through the cell-level getter, which covers BOTH masters
      // and shared-formula followers. For a follower, `v.sharedFormula` holds
      // the MASTER CELL'S ADDRESS (e.g. "B2"), not a formula — only
      // `cell.formula` materializes the translated formula (=A2*2, =A3*2, …).
      // Reading `v.sharedFormula` raw would round-trip fill-down/-right cells as
      // self-referential literals (f: "=B2") — silent data corruption.
      const formula = cell.formula
      const out: Pick<ICellData, 'v' | 'f'> = formula ? { f: '=' + formula } : {}
      const result = (v as { result?: unknown }).result
      if (result != null && typeof result !== 'object') {
        out.v = result as string | number | boolean
      }
      return out
    }
    if ('richText' in v && Array.isArray(v.richText)) {
      return { v: v.richText.map((r) => r.text).join('') }
    }
    if ('text' in v) return { v: String((v as { text: unknown }).text) }
    if ('hyperlink' in v) return { v: String((v as { hyperlink: unknown }).hyperlink) }
    if (v instanceof Date) return { v: dateToExcelSerial(v) }
    return {}
  }
  return { v: v as string | number | boolean }
}

/**
 * Parse xlsx bytes into a Univer workbook snapshot, plus the list of features
 * the package holds that this mapping cannot carry.
 *
 * The scan runs first, on the raw bytes, because ExcelJS drops most of that
 * evidence during its own load — by the time there is a Workbook object there is
 * no chart left to notice.
 */
export async function parse(bytes: ArrayBuffer): Promise<ParseResult> {
  // One pass over the package: what a save would drop, plus a copy ExcelJS can
  // actually load. Charts make `xlsx.load` throw outright, so this is not an
  // optimisation — without it the file does not open.
  const inspected = await inspectXlsx(bytes)
  const ExcelJSLib = await loadExcelJS()
  const wb = new ExcelJSLib.Workbook()
  await wb.xlsx.load(inspected.bytes)

  const sheets: Record<string, Partial<IWorksheetData>> = {}
  const sheetOrder: string[] = []

  wb.eachSheet((ws, sheetIndex) => {
    const id = `sheet-${sheetIndex}`
    sheetOrder.push(id)
    const cellData: Record<number, Record<number, ICellData>> = {}
    let maxCol = 0

    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        // A merged range reports the MASTER'S value for every cell in it, so
        // writing them all back turns one "merged header" into four copies —
        // data the file never contained, which is worse than losing the merge.
        // The merge itself cannot be carried (Univer's snapshot here has no
        // merge model), and the open-time warning says so; the value belongs to
        // the top-left cell only.
        if (cell.isMerged && cell.master !== cell) return
        const r = rowNumber - 1
        const c = colNumber - 1
        const uc: ICellData = { ...cellValueToUniver(cell) }
        const style = cellToUniverStyle(cell)
        if (style) uc.s = style
        if (uc.v !== undefined || uc.f !== undefined || uc.s !== undefined) {
          ;(cellData[r] ||= {})[c] = uc
          if (c > maxCol) maxCol = c
        }
      })
    })

    sheets[id] = {
      id,
      name: ws.name,
      cellData,
      columnCount: Math.max(maxCol + 1, 20),
    }
  })

  // A truly empty workbook still needs one sheet for Univer to mount.
  if (sheetOrder.length === 0) {
    sheets['sheet-1'] = { id: 'sheet-1', name: 'Sheet1', cellData: {} }
    sheetOrder.push('sheet-1')
  }

  return {
    workbook: { id: 'imbatranim-sheets', name: 'Workbook', sheetOrder, sheets },
    lossy: inspected.lossy,
  }
}

// ── Univer → ExcelJS ────────────────────────────────────────────────────────
function resolveStyle(
  raw: ICellData['s'],
  styles: IWorkbookData['styles'] | undefined
): IStyleData | undefined {
  if (!raw) return undefined
  if (typeof raw === 'string') return (styles?.[raw] as IStyleData) ?? undefined
  return raw
}

/** A decoration is on when Univer says `s: 1`. */
function decorationOn(d: IStyleData['ul' | 'st']): boolean {
  return !!d && typeof d === 'object' && d.s === 1
}

function rgbOf(color: unknown): string | undefined {
  if (!color || typeof color !== 'object') return undefined
  const rgb = (color as { rgb?: unknown }).rgb
  return typeof rgb === 'string' ? rgb : undefined
}

function applyUniverStyle(cell: ExcelJS.Cell, st: IStyleData | undefined): void {
  if (!st) return

  const font: Partial<ExcelJS.Font> = {}
  if (st.bl) font.bold = true
  if (st.it) font.italic = true
  if (decorationOn(st.ul)) font.underline = true
  if (decorationOn(st.st)) font.strike = true
  if (typeof st.ff === 'string' && st.ff) font.name = st.ff
  if (typeof st.fs === 'number' && st.fs > 0) font.size = st.fs
  const cl = hexToArgb(rgbOf(st.cl))
  if (cl) font.color = { argb: cl }
  if (Object.keys(font).length) cell.font = font

  const bgArgb = hexToArgb(rgbOf(st.bg))
  if (bgArgb) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } }
  }

  const alignment: Partial<ExcelJS.Alignment> = {}
  if (st.ht === H_LEFT) alignment.horizontal = 'left'
  else if (st.ht === H_CENTER) alignment.horizontal = 'center'
  else if (st.ht === H_RIGHT) alignment.horizontal = 'right'
  if (st.vt === V_TOP) alignment.vertical = 'top'
  else if (st.vt === V_MIDDLE) alignment.vertical = 'middle'
  else if (st.vt === V_BOTTOM) alignment.vertical = 'bottom'
  // OVERFLOW and CLIP both mean "do not wrap" as far as xlsx is concerned; only
  // WRAP has a representation, so only WRAP is written.
  if (st.tb === WRAP_WRAP) alignment.wrapText = true
  else if (st.tb === WRAP_OVERFLOW || st.tb === WRAP_CLIP) alignment.wrapText = false
  if (Object.keys(alignment).length) cell.alignment = alignment

  const border = univerToExcelBorders(st.bd)
  if (border) cell.border = border

  if (st.n && typeof st.n === 'object' && st.n.pattern) cell.numFmt = st.n.pattern
}

function univerToExcelBorders(bd: IStyleData['bd']): Partial<ExcelJS.Borders> | undefined {
  if (!bd || typeof bd !== 'object') return undefined
  const out: Record<string, ExcelJS.Border> = {}
  for (const edge of EDGES) {
    const side = (bd as Record<string, unknown>)[edge.univer]
    if (!side || typeof side !== 'object') continue
    const s = (side as { s?: unknown }).s
    if (typeof s !== 'number' || s === B_NONE) continue
    const style = UNIVER_TO_BORDER[s] ?? 'thin'
    // ExcelJS's Border type requires a colour, so default to black — which is
    // also Excel's own default when a border has no explicit colour.
    const argb = hexToArgb(rgbOf((side as { cl?: unknown }).cl)) ?? 'FF000000'
    out[edge.excel] = { style, color: { argb } }
  }
  return Object.keys(out).length ? (out as Partial<ExcelJS.Borders>) : undefined
}

/** Serialize a Univer workbook snapshot back to xlsx bytes. */
export async function serialize(snapshot: IWorkbookData): Promise<ArrayBuffer> {
  const ExcelJSLib = await loadExcelJS()
  const wb = new ExcelJSLib.Workbook()

  for (const sheetId of snapshot.sheetOrder) {
    const sd = snapshot.sheets[sheetId]
    if (!sd) continue
    const ws = wb.addWorksheet(sd.name || sheetId)
    const cellData = sd.cellData ?? {}
    for (const rowKey of Object.keys(cellData)) {
      const r = Number(rowKey)
      const rowCells = cellData[Number(rowKey)] as Record<number, ICellData>
      for (const colKey of Object.keys(rowCells)) {
        const c = Number(colKey)
        const uc = rowCells[Number(colKey)]
        if (!uc) continue
        const cell = ws.getCell(r + 1, c + 1)
        if (uc.f) {
          cell.value = {
            formula: String(uc.f).replace(/^=/, ''),
            result: (uc.v ?? undefined) as string | number | boolean | undefined,
          }
        } else if (uc.v !== undefined && uc.v !== null) {
          cell.value = uc.v as string | number | boolean
        }
        applyUniverStyle(cell, resolveStyle(uc.s, snapshot.styles))
      }
    }
  }

  const buffer = await wb.xlsx.writeBuffer()
  return buffer as ArrayBuffer
}
