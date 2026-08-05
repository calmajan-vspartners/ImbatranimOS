import { evaluate, formatResult, type AngleMode } from './evaluate'
import { DivisionByZeroError } from './errors'

/**
 * Pure input model for Scientific mode: a raw expression string, plus the cursor-free
 * operations a calculator keypad actually performs.
 *
 * Deliberately *not* Basic mode's alternating num/op token list. That model exists so
 * "the number being typed" is unambiguous, and it cannot represent `sin(`, a bare `(`, or a
 * half-written function — the things a scientific keypad emits. A scientific calculator is
 * expression-shaped, so this holds the expression.
 *
 * Everything here is a pure function over `{ expr, result, error }`, which is what makes the
 * awkward cases testable: a `=` with unclosed parentheses, `÷` pressed twice, and chaining a
 * result into the next expression without losing precision.
 */

export type SciInputState = {
  /** The expression as typed. */
  expr: string
  /** Formatted result of the last `=`, shown when `expr` is empty. */
  result: string | null
  /** That result unrounded, for chaining and for copy. */
  resultValue: number | null
  error: string | null
}

export const INITIAL_SCI_STATE: SciInputState = {
  expr: '',
  result: null,
  resultValue: null,
  error: null,
}

/** Characters that cannot be the *first* thing in an expression. */
const OPERATORS = ['+', '−', '×', '÷', '^']

/** Two operators in a row: the second replaces the first, as on every calculator. */
function appendOperator(expr: string, op: string): string {
  const last = expr.at(-1)
  if (last !== undefined && OPERATORS.includes(last)) return expr.slice(0, -1) + op
  return expr + op
}

export function displayExpr(state: SciInputState): string {
  if (state.error) return state.error
  if (state.expr === '') return state.result ?? '0'
  return state.expr
}

/**
 * Insert a key's text.
 *
 * A press after a finished calculation continues from the result when it is an operator
 * (`5 = ` then `×` means "times the answer") and starts fresh when it is a digit or a
 * function — which is what a physical calculator does, and the only reading that lets you
 * both chain and start over without a mode switch.
 */
export function insert(state: SciInputState, text: string): SciInputState {
  const isOperator = OPERATORS.includes(text)
  let expr = state.expr

  if (state.error) {
    if (isOperator) return state
    return { expr: text, result: null, resultValue: null, error: null }
  }

  if (expr === '' && state.result !== null) {
    // Chain from the exact value, not from the twelve digits on screen.
    if (isOperator) expr = state.resultValue !== null ? String(state.resultValue) : state.result
    else expr = ''
  }

  return {
    expr: isOperator ? appendOperator(expr, text) : expr + text,
    result: null,
    resultValue: null,
    error: null,
  }
}

export function backspace(state: SciInputState): SciInputState {
  if (state.error) return INITIAL_SCI_STATE
  if (state.expr === '') return state
  // Function names are deleted whole: dropping the `n` from `sin(` leaves `si(`, which is not
  // something the user can see is broken until they press `=`.
  const match = /(sin|cos|tan|asin|acos|atan|sqrt|cbrt|log|ln|abs|exp)\($/.exec(state.expr)
  const drop = match ? match[0].length : 1
  return { ...state, expr: state.expr.slice(0, -drop), result: null, resultValue: null }
}

export function clearAll(): SciInputState {
  return INITIAL_SCI_STATE
}

/** How many `(` are still open. */
export function openParens(expr: string): number {
  let depth = 0
  for (const ch of expr) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
  }
  return depth
}

/**
 * The expression as it will actually be evaluated.
 *
 * Unclosed parentheses are closed, and a dangling operator is dropped. Both are what a user
 * means: `sin(30` then `=` is a request for the sine of 30, not an error message, and
 * refusing it teaches nothing.
 */
export function normalizeForEval(expr: string): string {
  let out = expr.trimEnd()
  while (out.length > 0 && OPERATORS.includes(out.at(-1) as string)) out = out.slice(0, -1)
  return out + ')'.repeat(openParens(out))
}

export function evaluateState(state: SciInputState, angleMode: AngleMode): SciInputState {
  if (state.error || state.expr === '') return state
  const expr = normalizeForEval(state.expr)
  if (expr === '') return state
  try {
    const value = evaluate(expr, angleMode)
    if (!Number.isFinite(value)) {
      return { expr: '', result: null, resultValue: null, error: 'Out of range' }
    }
    return { expr: '', result: formatResult(value), resultValue: value, error: null }
  } catch (err) {
    const message =
      err instanceof DivisionByZeroError
        ? 'Division by zero'
        : err instanceof Error && err.message.length < 40
          ? err.message
          : 'Error'
    return { expr: '', result: null, resultValue: null, error: message }
  }
}
