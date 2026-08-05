import { describe, expect, it } from 'vitest'
import {
  INITIAL_PROGRAMMER_STATE,
  backspace,
  clearAll,
  displayString,
  inputDigit,
  pressEquals,
  pressNot,
  pressOperator,
  setBase,
  type ProgrammerState,
} from './programmerInput'

/**
 * Programmer mode is on brief 70's "must preserve" list and had no tests, so these pin the
 * behaviour rather than change it. Written after a probe misread the app: the initial base is
 * **HEX**, not DEC, so typing `255` and pressing HEX looks like a broken conversion when it is
 * simply the base that was already selected.
 */
const typeIn = (digits: string, state: ProgrammerState = INITIAL_PROGRAMMER_STATE) =>
  [...digits].reduce((acc, digit) => inputDigit(acc, digit), state)

describe('bases', () => {
  it('starts in HEX', () => {
    expect(INITIAL_PROGRAMMER_STATE.base).toBe(16)
  })

  it('converts the value when the base changes', () => {
    const dec = typeIn('255', setBase(INITIAL_PROGRAMMER_STATE, 10))
    expect(displayString(dec)).toBe('255')
    expect(displayString(setBase(dec, 16))).toBe('FF')
    expect(displayString(setBase(dec, 8))).toBe('377')
    expect(displayString(setBase(dec, 2))).toBe('11111111')
  })

  it('round-trips through every base', () => {
    let state = typeIn('1234', setBase(INITIAL_PROGRAMMER_STATE, 10))
    for (const base of [16, 8, 2, 10] as const) state = setBase(state, base)
    expect(displayString(state)).toBe('1234')
  })

  it('reads hex digits as hex', () => {
    expect(displayString(setBase(typeIn('FF'), 10))).toBe('255')
  })
})

describe('bitwise and shifts, on 64-bit words', () => {
  const dec = (digits: string) => typeIn(digits, setBase(INITIAL_PROGRAMMER_STATE, 10))
  const compute = (a: string, op: Parameters<typeof pressOperator>[1], b: string) =>
    displayString(pressEquals(typeIn(b, pressOperator(dec(a), op))))

  it('computes AND, OR, XOR', () => {
    expect(compute('12', 'AND', '10')).toBe('8')
    expect(compute('12', 'OR', '3')).toBe('15')
    expect(compute('12', 'XOR', '10')).toBe('6')
  })

  it('shifts', () => {
    expect(compute('1', '<<', '8')).toBe('256')
    expect(compute('256', '>>', '4')).toBe('16')
  })

  it('NOT wraps within the 64-bit word rather than going negative', () => {
    // The whole point of the BigInt + clamp: ~0 is 2^64 - 1, not -1.
    expect(displayString(pressNot(dec('0')))).toBe('18446744073709551615')
  })

  it('refuses division by zero in words', () => {
    expect(displayString(pressEquals(typeIn('0', pressOperator(dec('8'), '÷'))))).toMatch(/zero/i)
  })
})

describe('editing', () => {
  it('backspaces a digit, then clears', () => {
    expect(displayString(backspace(typeIn('12', setBase(INITIAL_PROGRAMMER_STATE, 10))))).toBe('1')
    expect(displayString(clearAll(INITIAL_PROGRAMMER_STATE))).toBe('0')
  })
})
