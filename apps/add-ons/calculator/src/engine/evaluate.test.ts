import { describe, expect, it } from 'vitest'
import { evaluate, formatResult, fullPrecision, isRounded, tokenize, toRPN } from './evaluate'

const near = (expr: string, expected: number, angle: 'deg' | 'rad' = 'rad') =>
  expect(evaluate(expr, angle)).toBeCloseTo(expected, 10)

describe('arithmetic that already worked (must not change)', () => {
  it('respects precedence and left-associativity', () => {
    expect(evaluate('2+3*4')).toBe(14)
    expect(evaluate('100/10/2')).toBe(5)
    expect(evaluate('10-3-2')).toBe(5)
  })

  it('accepts the on-screen glyphs as well as ASCII', () => {
    expect(evaluate('6×7')).toBe(42)
    expect(evaluate('84÷2')).toBe(42)
    expect(evaluate('5−3')).toBe(2)
  })

  it('reads unary minus at the start and after an operator', () => {
    expect(evaluate('-5+2')).toBe(-3)
    expect(evaluate('5−−3')).toBe(8)
    expect(evaluate('5*-2')).toBe(-10)
  })

  it('divides a literal by 100 per trailing percent', () => {
    expect(evaluate('50%')).toBe(0.5)
    expect(evaluate('12+50%×2')).toBe(13)
  })

  it('throws on division by zero rather than returning Infinity', () => {
    expect(() => evaluate('1/0')).toThrow()
  })

  it('rejects a stray character instead of guessing', () => {
    expect(() => evaluate('2 $ 2')).toThrow()
  })

  it('is 0 for an empty expression', () => {
    expect(evaluate('')).toBe(0)
  })
})

describe('parentheses', () => {
  it('overrides precedence', () => {
    expect(evaluate('(2+3)*4')).toBe(20)
  })

  it('nests to depth', () => {
    expect(evaluate('((2+3)*(4-1))^2')).toBe(225)
    expect(evaluate('2*(3+(4*(5-1)))')).toBe(38)
  })

  it('allows a negative first term inside parens', () => {
    expect(evaluate('(-4)+10')).toBe(6)
    expect(evaluate('3*(-2)')).toBe(-6)
  })

  it('refuses unbalanced parentheses in both directions', () => {
    expect(() => evaluate('(2+3')).toThrow(/Unbalanced/)
    expect(() => evaluate('2+3)')).toThrow(/Unbalanced/)
  })

  it('negates a parenthesised group instead of throwing (L9)', () => {
    // Both used to throw "Expected a number": unary minus was only accepted as the
    // sign of a numeric literal, never in front of a group.
    expect(evaluate('-(2+3)')).toBe(-5)
    expect(evaluate('2*-(4)')).toBe(-8)
    // At the start, after an operator, and doubled — and binding tighter than the
    // binary operators around it.
    expect(evaluate('10--(2+3)')).toBe(15)
    expect(evaluate('-(2+3)*2')).toBe(-10)
    // A negated group as an exponent matches the folded-literal case (`2^-3`).
    near('2^-(3)', 0.125)
  })
})

describe('power and factorial', () => {
  it('binds tighter than multiplication', () => {
    expect(evaluate('2*3^2')).toBe(18)
  })

  it('is right-associative', () => {
    // Left-associative would give 64. Every calculator and every maths convention says 512.
    expect(evaluate('2^3^2')).toBe(512)
  })

  it('handles fractional and negative exponents', () => {
    near('9^0.5', 3)
    near('2^-2', 0.25)
  })

  it('computes factorials postfix, tighter than anything else', () => {
    expect(evaluate('5!')).toBe(120)
    expect(evaluate('3!+2')).toBe(8)
    expect(evaluate('2*3!')).toBe(12)
    expect(evaluate('(2+2)!')).toBe(24)
  })

  it('refuses factorials it cannot represent', () => {
    // 171! is Infinity in a double; saying so beats printing Infinity.
    expect(() => evaluate('171!')).toThrow(/too large/)
    expect(() => evaluate('2.5!')).toThrow(/whole number/)
    expect(() => evaluate('-3!')).toThrow()
  })
})

describe('functions', () => {
  it('computes each one', () => {
    near('sqrt(16)', 4)
    near('cbrt(27)', 3)
    near('abs(0-7)', 7)
    near('ln(1)', 0)
    near('log(1000)', 3)
    near('exp(0)', 1)
    near('atan(1)', Math.PI / 4)
  })

  it('applies to a parenthesised expression, not just a literal', () => {
    near('sqrt(9+16)', 5)
  })

  it('nests', () => {
    near('sqrt(sqrt(16))', 2)
    near('ln(exp(3))', 3)
  })

  it('composes with operators on both sides', () => {
    near('2*sqrt(9)+1', 7)
  })

  it('refuses inputs outside a function domain instead of returning NaN', () => {
    expect(() => evaluate('sqrt(-1)')).toThrow(/not negative/)
    expect(() => evaluate('ln(0)')).toThrow(/above zero/)
    expect(() => evaluate('log(-5)')).toThrow(/above zero/)
    expect(() => evaluate('asin(2)')).toThrow(/between/)
  })
})

describe('angle mode', () => {
  it('reads degrees when asked', () => {
    near('sin(30)', 0.5, 'deg')
    near('cos(60)', 0.5, 'deg')
    near('tan(45)', 1, 'deg')
  })

  it('reads radians by default, which is what Basic mode gets', () => {
    near('sin(0)', 0)
    near(`sin(${Math.PI / 2})`, 1)
  })

  it('returns degrees from the inverse functions in degree mode', () => {
    near('asin(1)', 90, 'deg')
    near('atan(1)', 45, 'deg')
  })

  it('does not touch functions that have no angle in them', () => {
    expect(evaluate('sqrt(16)', 'deg')).toBe(evaluate('sqrt(16)', 'rad'))
  })
})

describe('constants', () => {
  it('substitutes π and e', () => {
    near('π', Math.PI)
    near('pi', Math.PI)
    near('e', Math.E)
    near('2*π', Math.PI * 2)
  })

  it('does not read the e in exp as Euler’s number', () => {
    // Function names are matched before constants; otherwise `exp(1)` would tokenize as
    // `e`, `x`, `p`… and throw on the `x`.
    near('exp(1)', Math.E)
  })

  it('takes a factorial of a constant expression', () => {
    expect(evaluate('(2*2)!')).toBe(24)
  })
})

describe('tokenize / toRPN', () => {
  it('emits the tokens the evaluator expects', () => {
    expect(tokenize('sin(30)')).toEqual([
      { type: 'function', value: 'sin' },
      { type: 'lparen' },
      { type: 'number', value: 30 },
      { type: 'rparen' },
    ])
  })

  it('orders a function after its argument in RPN', () => {
    expect(toRPN(tokenize('sqrt(4)')).map((t) => t.type)).toEqual(['number', 'function'])
  })
})

describe('formatResult', () => {
  const cases: [number, string][] = [
    [0.1 + 0.2, '0.3'],
    [1 / 3, '0.333333333333'],
    [2 / 3, '0.666666666667'],
    [0, '0'],
    [-0.5, '-0.5'],
    [1e21, '1e+21'],
    [1.5e-7, '1.5e-7'],
    [42, '42'],
    [Number.POSITIVE_INFINITY, 'Error'],
    [Number.NaN, 'Error'],
  ]

  it('formats each case', () => {
    for (const [input, expected] of cases) {
      expect(formatResult(input), String(input)).toBe(expected)
    }
  })

  it('hides float noise without hiding real digits', () => {
    expect(formatResult(0.1 + 0.2)).toBe('0.3')
    expect(formatResult(0.30000000001)).toBe('0.30000000001')
  })
})

describe('fullPrecision and isRounded', () => {
  it('keeps the value that round-trips', () => {
    expect(fullPrecision(0.1 + 0.2)).toBe('0.30000000000000004')
  })

  it('knows when the display is hiding something', () => {
    expect(isRounded(0.1 + 0.2)).toBe(true)
    expect(isRounded(42)).toBe(false)
  })
})
