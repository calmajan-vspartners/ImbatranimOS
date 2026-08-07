/**
 * Unit conversion tables and arithmetic (brief 116).
 *
 * Pure data plus two functions, deliberately: a converter is a table, and a
 * table is the one thing in a calculator that can be wrong in a way nobody
 * notices. Every factor here is exact by definition (the international yard
 * and pound agreement of 1959 for length and mass, SI prefixes and IEC binary
 * prefixes for data) except where noted, and the tests state the definitions
 * they are checking rather than the numbers they happen to produce.
 *
 * Every category except temperature converts through a **base unit** by a
 * single multiplication, which is why the whole thing is a factor table.
 * Temperature does not — its scales have different zero points — so it is the
 * one category with real functions, and it is modelled as such rather than
 * being forced into a factor it does not have.
 */

export type UnitId = string

export type Unit = {
  id: UnitId
  /** Shown in the picker. */
  label: string
  /** Short suffix shown beside the value. */
  symbol: string
  /** How many BASE units one of these is. Absent for temperature. */
  factor?: number
}

export type Category = {
  id: string
  label: string
  units: Unit[]
  /** Which unit each side starts on. */
  defaults: [UnitId, UnitId]
}

export const CATEGORIES: Category[] = [
  {
    id: 'length',
    label: 'Length',
    // Base: metre. The inch is exactly 0.0254 m (1959 agreement); everything
    // imperial here is derived from it, so the chain cannot drift.
    units: [
      { id: 'mm', label: 'Millimetre', symbol: 'mm', factor: 0.001 },
      { id: 'cm', label: 'Centimetre', symbol: 'cm', factor: 0.01 },
      { id: 'm', label: 'Metre', symbol: 'm', factor: 1 },
      { id: 'km', label: 'Kilometre', symbol: 'km', factor: 1000 },
      { id: 'in', label: 'Inch', symbol: 'in', factor: 0.0254 },
      { id: 'ft', label: 'Foot', symbol: 'ft', factor: 0.3048 },
      { id: 'yd', label: 'Yard', symbol: 'yd', factor: 0.9144 },
      { id: 'mi', label: 'Mile', symbol: 'mi', factor: 1609.344 },
      { id: 'nmi', label: 'Nautical mile', symbol: 'nmi', factor: 1852 },
    ],
    defaults: ['m', 'ft'],
  },
  {
    id: 'mass',
    label: 'Mass',
    // Base: kilogram. The pound is exactly 0.45359237 kg (same 1959 agreement).
    units: [
      { id: 'mg', label: 'Milligram', symbol: 'mg', factor: 0.000001 },
      { id: 'g', label: 'Gram', symbol: 'g', factor: 0.001 },
      { id: 'kg', label: 'Kilogram', symbol: 'kg', factor: 1 },
      { id: 't', label: 'Tonne', symbol: 't', factor: 1000 },
      { id: 'oz', label: 'Ounce', symbol: 'oz', factor: 0.028349523125 },
      { id: 'lb', label: 'Pound', symbol: 'lb', factor: 0.45359237 },
      { id: 'st', label: 'Stone', symbol: 'st', factor: 6.35029318 },
    ],
    defaults: ['kg', 'lb'],
  },
  {
    id: 'temperature',
    label: 'Temperature',
    // No factors: these scales have different zero points, so they convert
    // through functions below rather than through a base multiplication.
    units: [
      { id: 'c', label: 'Celsius', symbol: '°C' },
      { id: 'f', label: 'Fahrenheit', symbol: '°F' },
      { id: 'k', label: 'Kelvin', symbol: 'K' },
    ],
    defaults: ['c', 'f'],
  },
  {
    id: 'data',
    label: 'Data',
    // Base: byte. Decimal (kB = 1000) and binary (KiB = 1024) both listed,
    // because conflating them is the mistake this category exists to prevent —
    // a "500 GB" disk really is 465.7 GiB, and a converter that pretends
    // otherwise is worse than no converter.
    units: [
      { id: 'b', label: 'Bit', symbol: 'bit', factor: 0.125 },
      { id: 'B', label: 'Byte', symbol: 'B', factor: 1 },
      { id: 'kB', label: 'Kilobyte (1000)', symbol: 'kB', factor: 1e3 },
      { id: 'MB', label: 'Megabyte (1000²)', symbol: 'MB', factor: 1e6 },
      { id: 'GB', label: 'Gigabyte (1000³)', symbol: 'GB', factor: 1e9 },
      { id: 'TB', label: 'Terabyte (1000⁴)', symbol: 'TB', factor: 1e12 },
      { id: 'KiB', label: 'Kibibyte (1024)', symbol: 'KiB', factor: 1024 },
      { id: 'MiB', label: 'Mebibyte (1024²)', symbol: 'MiB', factor: 1024 ** 2 },
      { id: 'GiB', label: 'Gibibyte (1024³)', symbol: 'GiB', factor: 1024 ** 3 },
      { id: 'TiB', label: 'Tebibyte (1024⁴)', symbol: 'TiB', factor: 1024 ** 4 },
    ],
    defaults: ['MB', 'MiB'],
  },
]

export function categoryById(id: string): Category {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0]
}

export function unitById(category: Category, id: UnitId): Unit | undefined {
  return category.units.find((u) => u.id === id)
}

/** Celsius is the pivot: every temperature pair goes through it. */
function toCelsius(value: number, from: UnitId): number {
  if (from === 'f') return (value - 32) / 1.8
  if (from === 'k') return value - 273.15
  return value
}

function fromCelsius(celsius: number, to: UnitId): number {
  if (to === 'f') return celsius * 1.8 + 32
  if (to === 'k') return celsius + 273.15
  return celsius
}

/**
 * Convert, or `null` when the request does not make sense (an unknown unit).
 *
 * Null rather than 0 or NaN: a converter that silently answers zero for a unit
 * it does not know is the failure mode worth designing out.
 */
export function convert(
  categoryId: string,
  value: number,
  from: UnitId,
  to: UnitId
): number | null {
  if (!Number.isFinite(value)) return null
  const category = categoryById(categoryId)
  const a = unitById(category, from)
  const b = unitById(category, to)
  if (!a || !b) return null

  if (category.id === 'temperature') {
    return fromCelsius(toCelsius(value, from), to)
  }
  if (a.factor === undefined || b.factor === undefined) return null
  return (value * a.factor) / b.factor
}

/**
 * Show a converted number without lying about its precision.
 *
 * Floating point turns exact conversions into 1.0000000000000002; rounding to
 * 12 significant figures and trimming trailing zeros gives back the number the
 * definition actually says, while still showing a real 0.0000001 rather than
 * flattening it to zero.
 */
export function formatResult(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e15 || abs < 1e-9) return value.toExponential(6).replace(/e\+?/, 'e')
  const rounded = Number(value.toPrecision(12))
  return String(rounded)
}
