import { describe, it, expect } from 'vitest'
import { CATEGORIES, convert, formatResult, categoryById } from './units'

/** Convert and round the way the UI does, so the tests read as the UI reads. */
const c = (cat: string, v: number, from: string, to: string) => {
  const out = convert(cat, v, from, to)
  return out === null ? null : Number(out.toPrecision(12))
}

describe('the tables are well formed', () => {
  it('every non-temperature unit has a factor, and temperature has none', () => {
    for (const cat of CATEGORIES) {
      for (const u of cat.units) {
        if (cat.id === 'temperature') expect(u.factor).toBeUndefined()
        else expect(typeof u.factor).toBe('number')
      }
    }
  })

  it('every category has exactly one base unit (factor 1)', () => {
    for (const cat of CATEGORIES.filter((x) => x.id !== 'temperature')) {
      expect(cat.units.filter((u) => u.factor === 1)).toHaveLength(1)
    }
  })

  it('both defaults exist in their own category', () => {
    for (const cat of CATEGORIES) {
      for (const id of cat.defaults) {
        expect(cat.units.some((u) => u.id === id)).toBe(true)
      }
    }
  })

  it('unit ids are unique within a category', () => {
    for (const cat of CATEGORIES) {
      expect(new Set(cat.units.map((u) => u.id)).size).toBe(cat.units.length)
    }
  })
})

describe('length — the 1959 definitions, exactly', () => {
  it('an inch is 25.4 mm by definition', () => {
    expect(c('length', 1, 'in', 'mm')).toBe(25.4)
  })

  it('a foot is 12 inches and a yard is 3 feet', () => {
    expect(c('length', 1, 'ft', 'in')).toBe(12)
    expect(c('length', 1, 'yd', 'ft')).toBe(3)
  })

  it('a mile is 5280 feet', () => {
    expect(c('length', 1, 'mi', 'ft')).toBe(5280)
  })

  it('a nautical mile is exactly 1852 m', () => {
    expect(c('length', 1, 'nmi', 'm')).toBe(1852)
  })

  it('round-trips', () => {
    expect(c('length', 42, 'km', 'mi')).toBeCloseTo(26.0976, 4)
    expect(c('length', c('length', 42, 'km', 'mi') as number, 'mi', 'km')).toBeCloseTo(42, 9)
  })
})

describe('mass — the pound is exactly 0.45359237 kg', () => {
  it('converts pounds to kilograms by definition', () => {
    expect(c('mass', 1, 'lb', 'kg')).toBe(0.45359237)
  })

  it('a pound is 16 ounces and a stone is 14 pounds', () => {
    expect(c('mass', 1, 'lb', 'oz')).toBe(16)
    expect(c('mass', 1, 'st', 'lb')).toBe(14)
  })
})

describe('temperature — different zero points, so real functions', () => {
  it('water freezes and boils where it should', () => {
    expect(c('temperature', 0, 'c', 'f')).toBe(32)
    expect(c('temperature', 100, 'c', 'f')).toBe(212)
  })

  it('absolute zero lines up in all three scales', () => {
    expect(c('temperature', 0, 'k', 'c')).toBe(-273.15)
    expect(c('temperature', 0, 'k', 'f')).toBeCloseTo(-459.67, 8)
  })

  it('crosses at -40, the one place the two scales agree', () => {
    expect(c('temperature', -40, 'c', 'f')).toBe(-40)
    expect(c('temperature', -40, 'f', 'c')).toBe(-40)
  })

  it('never applies a factor — a same-unit conversion is identity', () => {
    expect(c('temperature', 21.5, 'c', 'c')).toBe(21.5)
    expect(c('temperature', 21.5, 'k', 'k')).toBe(21.5)
  })
})

describe('data — decimal and binary are different, and both are offered', () => {
  it('a kilobyte is 1000 bytes and a kibibyte is 1024', () => {
    expect(c('data', 1, 'kB', 'B')).toBe(1000)
    expect(c('data', 1, 'KiB', 'B')).toBe(1024)
  })

  it('the marketing-vs-real disk size the category exists for', () => {
    // A "500 GB" disk really is 465.66 GiB, and the converter must say so.
    expect(c('data', 500, 'GB', 'GiB')).toBeCloseTo(465.661287308, 6)
  })

  it('a byte is 8 bits', () => {
    expect(c('data', 1, 'B', 'b')).toBe(8)
  })
})

describe('convert refuses rather than guessing', () => {
  it('returns null for an unknown unit instead of 0', () => {
    expect(convert('length', 1, 'furlong', 'm')).toBeNull()
    expect(convert('length', 1, 'm', 'furlong')).toBeNull()
  })

  it('returns null for a non-finite input', () => {
    expect(convert('length', NaN, 'm', 'ft')).toBeNull()
    expect(convert('length', Infinity, 'm', 'ft')).toBeNull()
  })

  it('an unknown category falls back to the first, it does not crash', () => {
    expect(categoryById('nope').id).toBe(CATEGORIES[0].id)
  })
})

describe('formatResult', () => {
  it('does not show floating-point noise', () => {
    // 1 in → mm is exactly 25.4; a naive toString can produce 25.400000000000002.
    expect(formatResult(25.400000000000002)).toBe('25.4')
  })

  it('keeps a real small number instead of flattening it to zero', () => {
    // The notation is JavaScript's choice (1e-7); what matters is that the
    // value survives the round trip rather than being shown as 0.
    const shown = formatResult(0.0000001)
    expect(shown).not.toBe('0')
    expect(Number(shown)).toBe(0.0000001)
  })

  it('goes exponential at the extremes rather than printing a wall of digits', () => {
    expect(formatResult(1e20)).toMatch(/e20$/)
    expect(formatResult(1e-12)).toMatch(/e-12$/)
  })

  it('says so for a non-number', () => {
    expect(formatResult(NaN)).toBe('—')
  })

  it('is plain zero for zero', () => {
    expect(formatResult(0)).toBe('0')
  })
})
