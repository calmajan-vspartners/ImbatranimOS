import { describe, expect, it } from 'vitest'
import type { IWorkbookData, ICellData } from '@univerjs/presets'
import { csvToUniver, parseCsv, univerToCsv } from './csv'

const cellsOf = (wb: Partial<IWorkbookData>) => {
  const id = wb.sheetOrder?.[0]
  const sheet = id ? wb.sheets?.[id] : undefined
  return (sheet?.cellData ?? {}) as Record<number, Record<number, ICellData>>
}

describe('parseCsv', () => {
  it('reads plain rows', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('treats a trailing newline as a terminator, not an empty row', () => {
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']])
    expect(parseCsv('a,b')).toEqual([['a', 'b']])
  })

  it('handles CRLF', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('keeps commas and newlines inside quoted fields', () => {
    expect(parseCsv('"Smith, John","line1\nline2",3')).toEqual([
      ['Smith, John', 'line1\nline2', '3'],
    ])
  })

  it('unescapes a doubled quote', () => {
    expect(parseCsv('"say ""hi""",x')).toEqual([['say "hi"', 'x']])
  })

  it('keeps empty fields, including trailing ones', () => {
    expect(parseCsv('a,,c,\n')).toEqual([['a', '', 'c', '']])
  })

  it('strips a UTF-8 BOM so it does not become part of the first header', () => {
    // Excel writes one. Left in, the first column is named U+FEFF + "Region".
    // Spelled as an escape: a literal BOM in source is invisible and lint-hostile.
    expect(parseCsv('\ufeffRegion,Q1\n')).toEqual([['Region', 'Q1']])
  })

  it('does not lose a lone-CR line ending', () => {
    expect(parseCsv('a,b\r1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('csvToUniver', () => {
  it('coerces whole-field numbers and leaves everything else as text', () => {
    const cells = cellsOf(csvToUniver('12,3.5,-7,1e3,x,12 ,007a\n'))
    expect(cells[0][0].v).toBe(12)
    expect(cells[0][1].v).toBe(3.5)
    expect(cells[0][2].v).toBe(-7)
    expect(cells[0][3].v).toBe(1000)
    expect(cells[0][4].v).toBe('x')
    // ' 12 ' with padding is text: Number() would happily accept it and silently
    // rewrite the user's data.
    expect(cells[0][5].v).toBe('12 ')
    expect(cells[0][6].v).toBe('007a')
  })

  it('keeps a leading-zero string as text', () => {
    // A postcode, account number or part code. Coercing it means the save writes
    // 1234 and the user's file is wrong in a way they will not notice.
    expect(cellsOf(csvToUniver('01234\n'))[0][0].v).toBe('01234')
    expect(cellsOf(csvToUniver('-007\n'))[0][0].v).toBe('-007')
    // A genuine zero, and a decimal below one, are still numbers.
    expect(cellsOf(csvToUniver('0\n'))[0][0].v).toBe(0)
    expect(cellsOf(csvToUniver('0.5\n'))[0][0].v).toBe(0.5)
  })

  it('keeps a number longer than a double can hold as text', () => {
    // 1234567890123456789 comes back from Number() as ...800. Silent corruption
    // of exactly the long identifiers people keep in spreadsheets.
    expect(cellsOf(csvToUniver('1234567890123456789\n'))[0][0].v).toBe('1234567890123456789')
    // 15 significant digits is still safe.
    expect(cellsOf(csvToUniver('123456789012345\n'))[0][0].v).toBe(123456789012345)
  })

  it('never turns a field into a formula', () => {
    // A CSV cell reading "=1+1" is text. Evaluating it would let a data file
    // decide what the spreadsheet computes.
    const cells = cellsOf(csvToUniver('=1+1,=SUM(A1:A9)\n'))
    expect(cells[0][0].v).toBe('=1+1')
    expect(cells[0][0].f).toBeUndefined()
    expect(cells[0][1].v).toBe('=SUM(A1:A9)')
  })

  it('skips empty cells rather than storing blanks', () => {
    const cells = cellsOf(csvToUniver('a,,c\n'))
    expect(cells[0][0].v).toBe('a')
    expect(cells[0][1]).toBeUndefined()
    expect(cells[0][2].v).toBe('c')
  })

  it('produces one sheet with the name it was given', () => {
    const wb = csvToUniver('a\n', 'data.csv')
    expect(wb.sheetOrder).toEqual(['sheet-1'])
    expect(wb.sheets?.['sheet-1']?.name).toBe('data.csv')
  })
})

describe('univerToCsv', () => {
  const workbook = (cellData: Record<number, Record<number, ICellData>>): IWorkbookData =>
    ({
      id: 'w',
      name: 'w',
      sheetOrder: ['sheet-1'],
      sheets: { 'sheet-1': { id: 'sheet-1', name: 'S', cellData } },
    }) as unknown as IWorkbookData

  it('writes a rectangular grid, filling gaps', () => {
    expect(
      univerToCsv(workbook({ 0: { 0: { v: 'a' }, 2: { v: 'c' } }, 1: { 1: { v: 'b' } } }))
    ).toBe('a,,c\r\n,b,\r\n')
  })

  it('quotes only what has to be quoted', () => {
    const csv = univerToCsv(
      workbook({ 0: { 0: { v: 'plain' }, 1: { v: 'has,comma' }, 2: { v: 'say "hi"' } } })
    )
    expect(csv).toBe('plain,"has,comma","say ""hi"""\r\n')
  })

  it('exports a formula cell as its cached value, not its source', () => {
    // CSV has no formulas. The recipient asked for the number.
    expect(univerToCsv(workbook({ 0: { 0: { f: '=B1+C1', v: 42 } } }))).toBe('42\r\n')
  })

  it('writes an empty string for a formula with no cached value', () => {
    expect(univerToCsv(workbook({ 0: { 0: { f: '=B1+C1' }, 1: { v: 1 } } }))).toBe(',1\r\n')
  })

  it('returns an empty string for an empty sheet', () => {
    expect(univerToCsv(workbook({}))).toBe('')
  })

  it('round-trips text through parse → build → write', () => {
    const original = 'Region,Q1\r\n"Smith, John",120\r\nAPAC,90\r\n'
    expect(univerToCsv(csvToUniver(original) as IWorkbookData)).toBe(original)
  })
})
