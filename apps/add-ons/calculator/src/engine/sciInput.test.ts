import { describe, expect, it } from 'vitest'
import {
  backspace,
  displayExpr,
  evaluateState,
  INITIAL_SCI_STATE,
  insert,
  normalizeForEval,
  openParens,
} from './sciInput'

const typeIn = (keys: string[]) =>
  keys.reduce((state, key) => insert(state, key), INITIAL_SCI_STATE)

describe('insert', () => {
  it('builds an expression from keypad presses', () => {
    expect(displayExpr(typeIn(['sin(', '3', '0', ')']))).toBe('sin(30)')
  })

  it('replaces a doubled operator', () => {
    expect(displayExpr(typeIn(['5', '+', '×']))).toBe('5×')
  })

  it('starts fresh on a digit after a result, and chains on an operator', () => {
    const done = evaluateState(typeIn(['4', '+', '4']), 'rad')
    expect(done.result).toBe('8')
    expect(displayExpr(insert(done, '2'))).toBe('2')
    expect(displayExpr(insert(done, '×'))).toBe('8×')
  })

  it('chains from the exact value, not the rounded display', () => {
    const third = evaluateState(typeIn(['1', '÷', '3']), 'rad')
    const chained = evaluateState(insert(insert(third, '×'), '3'), 'rad')
    expect(chained.result).toBe('1')
  })

  it('ignores an operator pressed on an error, and any digit clears it', () => {
    const errored = evaluateState(typeIn(['1', '÷', '0']), 'rad')
    expect(errored.error).toBe('Division by zero')
    expect(insert(errored, '×')).toBe(errored)
    expect(displayExpr(insert(errored, '7'))).toBe('7')
  })
})

describe('backspace', () => {
  it('deletes a function name whole', () => {
    // Dropping one character leaves `si(`, which looks fine and fails at `=`.
    expect(displayExpr(backspace(typeIn(['sin('])))).toBe('0')
    expect(displayExpr(backspace(typeIn(['2', '+', 'sqrt('])))).toBe('2+')
  })

  it('deletes one character otherwise', () => {
    expect(displayExpr(backspace(typeIn(['1', '2', '3'])))).toBe('12')
  })

  it('clears an error', () => {
    const errored = evaluateState(typeIn(['1', '÷', '0']), 'rad')
    expect(backspace(errored)).toEqual(INITIAL_SCI_STATE)
  })
})

describe('openParens and normalizeForEval', () => {
  it('counts depth, ignoring extra closers', () => {
    expect(openParens('sin(2*(3')).toBe(2)
    expect(openParens('(1+2)')).toBe(0)
    expect(openParens('1+2)')).toBe(0)
  })

  it('closes what the user left open', () => {
    // `sin(30` then `=` is a request, not a mistake.
    expect(normalizeForEval('sin(30')).toBe('sin(30)')
    expect(normalizeForEval('2*(3+(4')).toBe('2*(3+(4))')
  })

  it('drops a dangling operator', () => {
    expect(normalizeForEval('5+')).toBe('5')
    expect(normalizeForEval('5+×')).toBe('5')
  })
})

describe('evaluateState', () => {
  it('honours the angle mode', () => {
    expect(evaluateState(typeIn(['sin(', '3', '0', ')']), 'deg').result).toBe('0.5')
    expect(Number(evaluateState(typeIn(['sin(', '3', '0', ')']), 'rad').result)).toBeCloseTo(
      Math.sin(30),
      10
    )
  })

  it('evaluates an unclosed expression', () => {
    expect(evaluateState(typeIn(['sqrt(', '9']), 'rad').result).toBe('3')
  })

  it('surfaces a short engine message rather than a bare "Error"', () => {
    expect(evaluateState(typeIn(['sqrt(', '-', '1', ')']), 'rad').error).toMatch(/negative/)
  })

  it('is a no-op on an empty expression', () => {
    expect(evaluateState(INITIAL_SCI_STATE, 'rad')).toBe(INITIAL_SCI_STATE)
  })
})
