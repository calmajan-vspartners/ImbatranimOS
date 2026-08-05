import { describe, expect, it } from 'vitest'
import {
  applyPercent,
  backspace,
  clearAll,
  displayString,
  evaluateState,
  inputDigit,
  inputOperator,
  INITIAL_BASIC_STATE,
  toggleSign,
  type BasicInputState,
} from './basicInput'

/** Type a sequence: digits, `.`, and the operator glyphs. */
function type(keys: string): BasicInputState {
  let state = INITIAL_BASIC_STATE
  for (const key of keys) {
    if ('+−×÷'.includes(key)) state = inputOperator(state, key as '+')
    else state = inputDigit(state, key)
  }
  return state
}

describe('typing', () => {
  it('builds an expression and shows it', () => {
    expect(displayString(type('12+5'))).toBe('12+5')
  })

  it('starts at 0 and refuses a second decimal point', () => {
    expect(displayString(INITIAL_BASIC_STATE)).toBe('0')
    expect(displayString(type('1.2.3'))).toBe('1.23')
  })

  it('replaces a leading zero and keeps 0. intact', () => {
    expect(displayString(type('05'))).toBe('5')
    expect(displayString(type('.5'))).toBe('0.5')
  })

  it('replaces one operator with the next rather than stacking them', () => {
    expect(displayString(type('5+×'))).toBe('5×')
  })

  it('ignores an operator when there is nothing to operate on', () => {
    expect(displayString(inputOperator(INITIAL_BASIC_STATE, '+'))).toBe('0')
  })
})

describe('evaluation', () => {
  it('computes with precedence', () => {
    expect(evaluateState(type('2+3×4')).result).toBe('14')
  })

  it('drops a dangling operator', () => {
    expect(evaluateState(type('12+')).result).toBe('12')
  })

  it('hides float noise', () => {
    // The whole reason `formatResult` exists.
    expect(evaluateState(type('0.1+0.2')).result).toBe('0.3')
  })

  it('reports division by zero in words', () => {
    const state = evaluateState(type('1÷0'))
    expect(state.error).toBe('Division by zero')
    expect(displayString(state)).toBe('Division by zero')
  })

  it('reports an overflow instead of showing Infinity', () => {
    let state = type('9')
    for (let i = 0; i < 3; i++) state = inputDigit(state, '9')
    // 9999^9999 overflows a double.
    state = inputOperator(state, '×')
    state = evaluateState({ ...state, tokens: [...state.tokens, { kind: 'num', text: '1e400' }] })
    expect(state.error).toBeTruthy()
  })
})

describe('chaining keeps full precision', () => {
  it('multiplies a third back to one', () => {
    // The bug this fixes: `=` used to store only the twelve-digit display string, so the next
    // operation re-parsed `0.333333333333` and produced `0.999999999999`.
    const third = evaluateState(type('1÷3'))
    expect(third.result).toBe('0.333333333333')
    const back = evaluateState(inputDigit(inputOperator(third, '×'), '3'))
    expect(back.result).toBe('1')
  })

  it('shows the ROUNDED value in the expression while evaluating the exact one', () => {
    const third = evaluateState(type('1÷3'))
    expect(displayString(inputOperator(third, '×'))).toBe('0.333333333333×')
  })

  it('keeps the exact value across sign and percent', () => {
    const third = evaluateState(type('1÷3'))
    expect(toggleSign(third).resultValue).toBeCloseTo(-1 / 3, 15)
    expect(applyPercent(third).resultValue).toBeCloseTo(1 / 300, 15)
  })

  it('forgets the exact value once the text is edited', () => {
    const third = evaluateState(type('1÷3'))
    const edited = inputDigit(inputOperator(third, '×'), '9')
    expect(edited.resultValue).toBeNull()
  })
})

describe('percent', () => {
  it('scales the number being typed', () => {
    expect(displayString(applyPercent(type('50')))).toBe('0.5')
  })

  it('scales a finished result', () => {
    expect(applyPercent(evaluateState(type('200'))).result).toBe('2')
  })
})

describe('backspace and clear', () => {
  it('removes one character, then the operator', () => {
    expect(displayString(backspace(type('12+')))).toBe('12')
    expect(displayString(backspace(type('12')))).toBe('1')
  })

  it('clears an error entirely', () => {
    const errored = evaluateState(type('1÷0'))
    expect(backspace(errored)).toEqual(INITIAL_BASIC_STATE)
    expect(clearAll()).toEqual(INITIAL_BASIC_STATE)
  })

  it('leaves a shown result alone — C is how you clear that', () => {
    const done = evaluateState(type('2+2'))
    expect(backspace(done).result).toBe('4')
  })
})

describe('sign', () => {
  it('flips the number being typed and flips back', () => {
    expect(displayString(toggleSign(type('5')))).toBe('-5')
    expect(displayString(toggleSign(toggleSign(type('5'))))).toBe('5')
  })

  it('is ignored while an operator is the last thing typed', () => {
    const state = type('5+')
    expect(toggleSign(state)).toBe(state)
  })
})
