import type { ICellData, IWorkbookData, IWorksheetData } from '@univerjs/presets'

/**
 * CSV in and out, without a dependency.
 *
 * `.csv` was not in the `openWith` map at all, so double-clicking one did
 * nothing — for a spreadsheet app, a dead end on the most common interchange
 * format there is. It also does not need ExcelJS: RFC 4180 is a small format and
 * the whole point of reaching for it is that it is simple.
 *
 * Kept honest about what CSV is: a grid of text. Reading one produces values,
 * never formulas — a cell whose text starts with `=` stays the literal string,
 * because treating it as a formula is how a spreadsheet turns a data file into
 * arbitrary evaluation. Writing one takes the *displayed* value, so a formula
 * cell exports its cached result rather than its source, which is what every
 * other spreadsheet does and what the person receiving the file expects.
 */

/**
 * Parse RFC 4180-ish CSV into rows of strings.
 *
 * Handles quoted fields, escaped quotes (`""`), embedded newlines and commas,
 * and both `\n` and `\r\n`. Does not attempt delimiter sniffing — a
 * semicolon-separated European export is a real thing but guessing wrong
 * silently mangles the data, and this returns one column instead, which is
 * visibly wrong rather than subtly wrong.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0

  // Strip a UTF-8 BOM: Excel writes one, and left in place it becomes part of
  // the first header cell's name.
  if (text.charCodeAt(0) === 0xfeff) i = 1

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  for (; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"' && field === '') {
      quoted = true
    } else if (ch === ',') {
      endField()
    } else if (ch === '\n') {
      endRow()
    } else if (ch === '\r') {
      // Swallow CR; the LF that follows ends the row. A lone CR (old Mac) also
      // ends it.
      if (text[i + 1] !== '\n') endRow()
    } else {
      field += ch
    }
  }
  // A trailing newline is a terminator, not an empty final row.
  if (field !== '' || row.length > 0 || quoted) endRow()
  return rows
}

const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

/**
 * A number if the whole field is unambiguously one, otherwise the text
 * unchanged.
 *
 * Deliberately stricter than `Number()`, which accepts `''` as 0 and `' 12 '` as
 * 12 — both of which silently rewrite the user's data. Two further refusals,
 * both for the same reason:
 *
 * - **A leading zero stays text.** `01234` is a postcode, an account number or a
 *   part code. Coercing it means the save writes `1234`, and the user's file is
 *   now wrong in a way they will not notice until something downstream breaks.
 *   Excel does convert these and is widely cursed for it; brief 63's own rule is
 *   that a feature which does not round-trip is worse than an absent one.
 * - **More than 15 significant digits stays text.** A double cannot hold them,
 *   so `1234567890123456789` would come back as `1234567890123456800`. Silent
 *   corruption of exactly the long identifiers people put in spreadsheets.
 */
function coerce(value: string): string | number {
  if (value === '') return value
  if (!NUMERIC.test(value)) return value

  const unsigned = value.replace(/^[+-]/, '')
  // `0`, `0.5` and `0e3` are fine; `01`, `007` are identifiers.
  if (/^0\d/.test(unsigned)) return value
  const digits = unsigned.replace(/[.eE+-].*$/, '').replace(/^0+/, '')
  if (digits.length > 15) return value

  const n = Number(value)
  return Number.isFinite(n) ? n : value
}

/** Build a single-sheet Univer workbook from CSV text. */
export function csvToUniver(text: string, sheetName = 'Sheet1'): Partial<IWorkbookData> {
  const rows = parseCsv(text)
  const cellData: Record<number, Record<number, ICellData>> = {}
  let maxCol = 0

  rows.forEach((cols, r) => {
    cols.forEach((raw, c) => {
      if (raw === '') return
      ;(cellData[r] ||= {})[c] = { v: coerce(raw) }
      if (c > maxCol) maxCol = c
    })
  })

  const sheet: Partial<IWorksheetData> = {
    id: 'sheet-1',
    name: sheetName,
    cellData,
    columnCount: Math.max(maxCol + 1, 20),
  }
  return {
    id: 'imbatranim-sheets',
    name: sheetName,
    sheetOrder: ['sheet-1'],
    sheets: { 'sheet-1': sheet },
  }
}

/** Quote a field only when it has to be quoted. */
function quote(value: string): string {
  if (!/[",\n\r]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * Serialize the **first** sheet of a workbook to CSV.
 *
 * One sheet, because that is what the format holds. Silently exporting only the
 * active sheet while implying the whole workbook was written is the kind of
 * quiet loss brief 63 exists to stop, so the caller warns when there is more
 * than one — see `Sheets.tsx`.
 */
export function univerToCsv(snapshot: IWorkbookData): string {
  const sheetId = snapshot.sheetOrder?.[0]
  const sheet = sheetId ? snapshot.sheets?.[sheetId] : undefined
  const cellData = (sheet?.cellData ?? {}) as Record<number, Record<number, ICellData>>

  const rowIndexes = Object.keys(cellData)
    .map(Number)
    .filter((n) => Number.isFinite(n))
  if (rowIndexes.length === 0) return ''
  const lastRow = Math.max(...rowIndexes)

  let lastCol = 0
  for (const r of rowIndexes) {
    for (const c of Object.keys(cellData[r]).map(Number)) {
      if (c > lastCol) lastCol = c
    }
  }

  const lines: string[] = []
  for (let r = 0; r <= lastRow; r++) {
    const row = cellData[r] ?? {}
    const cols: string[] = []
    for (let c = 0; c <= lastCol; c++) {
      const cell = row[c]
      // The cached value, not the formula: CSV has no formulas, and writing
      // `=B2+C2` as text is not the number the recipient asked for.
      const v = cell?.v
      cols.push(v === undefined || v === null ? '' : quote(String(v)))
    }
    lines.push(cols.join(','))
  }
  // Trailing newline: every tool that reads CSV expects one, and `wc -l` on a
  // file without it is off by one.
  return lines.join('\r\n') + '\r\n'
}
