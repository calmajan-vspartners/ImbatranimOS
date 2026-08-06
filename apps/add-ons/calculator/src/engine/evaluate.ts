import { DivisionByZeroError } from './errors'

/**
 * Tokenizer + shunting-yard evaluator for Basic *and* Scientific mode.
 *
 * Deliberately NOT `eval`/`new Function` — every character of the expression is parsed
 * explicitly. That is the reason this file exists at all and it is not up for revisiting:
 * this desktop is internet-exposable, and an expression string reaching an interpreter is
 * one XSS away from being someone else's code.
 *
 * One engine, not two. Scientific mode adds parentheses, functions, `^`, `!` and constants
 * to the *same* precedence machinery rather than forking it, because two evaluators drift
 * and the drift shows up as "the same sum gives different answers in different tabs".
 * Basic-mode expressions are a strict subset, so its behaviour is unchanged — the tests
 * pin the old cases as well as the new ones.
 *
 * Pure functions, unit-testable in isolation from any UI state.
 */

export type OperatorSymbol = '+' | '-' | '*' | '/' | '^'

/** Named single-argument functions, applied to a parenthesised argument. */
export type FunctionName =
  | 'sin'
  | 'cos'
  | 'tan'
  | 'asin'
  | 'acos'
  | 'atan'
  | 'log'
  | 'ln'
  | 'sqrt'
  | 'cbrt'
  | 'abs'
  | 'exp'

export type Token =
  | { type: 'number'; value: number }
  | { type: 'operator'; value: OperatorSymbol }
  | { type: 'function'; value: FunctionName }
  /** Postfix `!`, which applies to whatever operand precedes it. */
  | { type: 'postfix'; value: '!' }
  /**
   * Prefix unary minus applied to a *group*, function or constant — `-(2+3)`,
   * `-sin(0)`, `-π`. A minus that precedes a plain number literal is still folded
   * into the literal by `readNumber`; this token covers only the operands that
   * are not literals, and binds tighter than any binary operator.
   */
  | { type: 'unary'; value: '-' }
  | { type: 'lparen' }
  | { type: 'rparen' }

/** Whether trig functions take degrees or radians. */
export type AngleMode = 'deg' | 'rad'

// Accepts both the ASCII operators (keyboard input) and the Win7-classic
// glyphs the on-screen buttons emit (× ÷ −).
const OPERATOR_ALIASES: Record<string, OperatorSymbol> = {
  '+': '+',
  '-': '-',
  '−': '-', // −
  '*': '*',
  '×': '*', // ×
  '/': '/',
  '÷': '/', // ÷
  '^': '^',
}

const PRECEDENCE: Record<OperatorSymbol, number> = {
  '+': 1,
  '-': 1,
  '*': 2,
  '/': 2,
  // Above multiplication, and right-associative — see `toRPN`. `2^3^2` is 512, not 64.
  '^': 4,
}

const RIGHT_ASSOCIATIVE: Partial<Record<OperatorSymbol, boolean>> = { '^': true }

/** Constants, substituted at tokenize time so the rest of the pipeline only sees numbers. */
const CONSTANTS: Record<string, number> = {
  π: Math.PI,
  pi: Math.PI,
  e: Math.E,
  τ: Math.PI * 2,
}

// Longest first: `asin` must win over `a`… and `ln` must not be read as `l` + `n`.
const FUNCTION_NAMES: FunctionName[] = [
  'asin',
  'acos',
  'atan',
  'sqrt',
  'cbrt',
  'sin',
  'cos',
  'tan',
  'log',
  'exp',
  'abs',
  'ln',
]

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= '0' && c <= '9'
}

function isMinusLike(c: string | undefined): boolean {
  return c === '-' || c === '−'
}

/** Reads a (possibly signed) number literal starting at `start`; returns its end index. */
function readNumber(expr: string, start: number): { value: number; end: number } {
  let i = start
  const signed = isMinusLike(expr[i])
  if (signed) i++
  const digitsStart = i
  let sawDot = false
  while (i < expr.length && (isDigit(expr[i]) || (expr[i] === '.' && !sawDot))) {
    if (expr[i] === '.') sawDot = true
    i++
  }
  if (i === digitsStart) {
    throw new Error(`Expected a number at position ${start}`)
  }
  let value = Number(expr.slice(digitsStart, i))
  if (signed) value = -value
  // Trailing '%' divides the literal by 100, once per '%' typed.
  while (expr[i] === '%') {
    value /= 100
    i++
  }
  return { value, end: i }
}

/** `n!`, integers only. */
function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error('Factorial needs a whole number that is not negative')
  }
  // 171! overflows a double to Infinity; refusing is more useful than returning Infinity.
  if (n > 170) throw new Error('Factorial is too large')
  let out = 1
  for (let i = 2; i <= n; i++) out *= i
  return out
}

/**
 * Tokenizes an expression string (e.g. `12+50%×2`, `sin(30)+π`).
 *
 * Unary minus is allowed at the start of the expression, right after another operator, and
 * right after `(` — so `5−−3` subtracts a negative and `(-4)` is negative four, the
 * convention real calculators use.
 *
 * `!` becomes a postfix token. Folding it into the number as it is read was the first
 * attempt and it cannot express `(2+2)!` — at the closing paren the value does not exist
 * yet. As a token it goes straight to the RPN output, which gives it exactly the binding it
 * should have: tighter than any operator, including `^`.
 */
export function tokenize(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < expr.length) {
    const ch = expr[i]

    if (ch === ' ') {
      i++
      continue
    }

    const previous = tokens[tokens.length - 1]
    const atExpressionStart = tokens.length === 0
    const afterOperator = previous?.type === 'operator'
    const afterLparen = previous?.type === 'lparen'
    const afterUnary = previous?.type === 'unary'
    const unaryPosition = atExpressionStart || afterOperator || afterLparen || afterUnary

    // A minus directly in front of a number literal is its sign, folded into the
    // literal so `2^-3` stays `2 ^ (-3)`.
    const signedNumber =
      isMinusLike(ch) && unaryPosition && (isDigit(expr[i + 1]) || expr[i + 1] === '.')

    if (isDigit(ch) || ch === '.' || signedNumber) {
      const { value, end } = readNumber(expr, i)
      tokens.push({ type: 'number', value })
      i = end
      continue
    }

    // A minus in front of a group, function or constant (`-(2+3)`, `-sin(0)`,
    // `-π`) is a prefix negation, not a sign. It used to reach `readNumber`, which
    // threw "Expected a number" (L9).
    if (isMinusLike(ch) && unaryPosition) {
      tokens.push({ type: 'unary', value: '-' })
      i++
      continue
    }

    if (ch === '(') {
      tokens.push({ type: 'lparen' })
      i++
      continue
    }

    if (ch === ')') {
      tokens.push({ type: 'rparen' })
      i++
      continue
    }

    if (ch === '!') {
      const previous2 = tokens[tokens.length - 1]
      if (
        !previous2 ||
        (previous2.type !== 'number' && previous2.type !== 'rparen' && previous2.type !== 'postfix')
      ) {
        throw new Error('Nothing to take the factorial of')
      }
      tokens.push({ type: 'postfix', value: '!' })
      i++
      continue
    }

    const fn = FUNCTION_NAMES.find((name) => expr.startsWith(name, i))
    if (fn) {
      tokens.push({ type: 'function', value: fn })
      i += fn.length
      continue
    }

    // Constants after functions, so the `e` in `exp` is not read as Euler's number.
    const constant = Object.keys(CONSTANTS).find((name) => expr.startsWith(name, i))
    if (constant) {
      tokens.push({ type: 'number', value: CONSTANTS[constant] })
      i += constant.length
      continue
    }

    const op = OPERATOR_ALIASES[ch]
    if (op) {
      tokens.push({ type: 'operator', value: op })
      i++
      continue
    }

    throw new Error(`Unexpected character '${ch}' at position ${i}`)
  }

  return tokens
}

/**
 * Shunting-yard: infix tokens → RPN.
 *
 * Left-associative except for `^`: with `2^3^2`, popping the stacked `^` before pushing the
 * second would evaluate `(2^3)^2 = 64`, where every calculator and every maths convention
 * says `2^(3^2) = 512`.
 */
export function toRPN(tokens: Token[]): Token[] {
  const output: Token[] = []
  const stack: Token[] = []

  for (const token of tokens) {
    // A postfix operator applies to the operand already emitted, so it goes straight out —
    // which is also what gives it the tightest binding in the expression.
    if (token.type === 'number' || token.type === 'postfix') {
      output.push(token)
      continue
    }
    if (token.type === 'function' || token.type === 'lparen') {
      stack.push(token)
      continue
    }
    if (token.type === 'rparen') {
      let matched = false
      while (stack.length > 0) {
        const top = stack.pop() as Token
        if (top.type === 'lparen') {
          matched = true
          break
        }
        output.push(top)
      }
      if (!matched) throw new Error('Unbalanced parentheses')
      // A function immediately outside the parens applies to what they produced.
      if (stack[stack.length - 1]?.type === 'function') output.push(stack.pop() as Token)
      continue
    }

    // Prefix unary minus applies to what FOLLOWS it, so it is pushed without
    // displacing anything already on the stack — and it binds tighter than any
    // binary operator (see the pop below), so `2^-(3)` is `2 ^ (-3)`.
    if (token.type === 'unary') {
      stack.push(token)
      continue
    }

    while (stack.length > 0) {
      const top = stack[stack.length - 1]
      // A pending unary negation binds tighter than any binary operator, so it is
      // applied before this one is stacked.
      if (top.type === 'unary') {
        output.push(stack.pop() as Token)
        continue
      }
      if (top.type !== 'operator') break
      const higher = PRECEDENCE[top.value] > PRECEDENCE[token.value]
      const equalAndLeft =
        PRECEDENCE[top.value] === PRECEDENCE[token.value] && !RIGHT_ASSOCIATIVE[token.value]
      if (!higher && !equalAndLeft) break
      output.push(stack.pop() as Token)
    }
    stack.push(token)
  }

  while (stack.length > 0) {
    const top = stack.pop() as Token
    if (top.type === 'lparen') throw new Error('Unbalanced parentheses')
    output.push(top)
  }
  return output
}

const DEGREES_PER_RADIAN = 180 / Math.PI

function applyFunction(name: FunctionName, x: number, angleMode: AngleMode): number {
  const toRadians = (value: number) => (angleMode === 'deg' ? value / DEGREES_PER_RADIAN : value)
  const fromRadians = (value: number) => (angleMode === 'deg' ? value * DEGREES_PER_RADIAN : value)
  switch (name) {
    case 'sin':
      return Math.sin(toRadians(x))
    case 'cos':
      return Math.cos(toRadians(x))
    case 'tan':
      return Math.tan(toRadians(x))
    case 'asin':
      if (x < -1 || x > 1) throw new Error('asin needs a value between -1 and 1')
      return fromRadians(Math.asin(x))
    case 'acos':
      if (x < -1 || x > 1) throw new Error('acos needs a value between -1 and 1')
      return fromRadians(Math.acos(x))
    case 'atan':
      return fromRadians(Math.atan(x))
    case 'log':
      if (x <= 0) throw new Error('log needs a value above zero')
      return Math.log10(x)
    case 'ln':
      if (x <= 0) throw new Error('ln needs a value above zero')
      return Math.log(x)
    case 'sqrt':
      if (x < 0) throw new Error('sqrt needs a value that is not negative')
      return Math.sqrt(x)
    case 'cbrt':
      return Math.cbrt(x)
    case 'abs':
      return Math.abs(x)
    case 'exp':
      return Math.exp(x)
  }
}

export function evaluateRPN(rpn: Token[], angleMode: AngleMode = 'rad'): number {
  const stack: number[] = []
  for (const token of rpn) {
    if (token.type === 'number') {
      stack.push(token.value)
      continue
    }
    if (token.type === 'function') {
      const x = stack.pop()
      if (x === undefined) throw new Error('Malformed expression')
      stack.push(applyFunction(token.value, x, angleMode))
      continue
    }
    if (token.type === 'postfix') {
      const x = stack.pop()
      if (x === undefined) throw new Error('Nothing to take the factorial of')
      stack.push(factorial(x))
      continue
    }
    if (token.type === 'unary') {
      const x = stack.pop()
      if (x === undefined) throw new Error('Malformed expression')
      stack.push(-x)
      continue
    }
    if (token.type !== 'operator') throw new Error('Malformed expression')

    const b = stack.pop()
    const a = stack.pop()
    if (a === undefined || b === undefined) {
      throw new Error('Malformed expression')
    }
    switch (token.value) {
      case '+':
        stack.push(a + b)
        break
      case '-':
        stack.push(a - b)
        break
      case '*':
        stack.push(a * b)
        break
      case '/':
        if (b === 0) throw new DivisionByZeroError()
        stack.push(a / b)
        break
      case '^':
        stack.push(a ** b)
        break
    }
  }
  if (stack.length !== 1) throw new Error('Malformed expression')
  return stack[0]
}

/** Tokenize → shunting-yard → evaluate, respecting `^` over `× ÷` over `+ −`. */
export function evaluate(expr: string, angleMode: AngleMode = 'rad'): number {
  const tokens = tokenize(expr)
  if (tokens.length === 0) return 0
  return evaluateRPN(toRPN(tokens), angleMode)
}

/** Significant digits kept for display. */
const DISPLAY_PRECISION = 12

/**
 * Formats a numeric result for display: rounds to 12 significant digits so binary float
 * noise (e.g. `0.1 + 0.2` → `0.30000000000000004`) does not leak into the UI, then lets
 * `toString` trim the trailing zeros.
 *
 * This is a *display* transform only. The unrounded value is what gets carried into the next
 * operation — see `basicInput.ts`, where re-parsing this string was quietly costing precision
 * on every chained calculation.
 */
export function formatResult(n: number): string {
  if (!Number.isFinite(n)) return 'Error'
  if (n === 0) return '0'
  return Number(n.toPrecision(DISPLAY_PRECISION)).toString()
}

/**
 * The full stored value, for the copy action.
 *
 * `toString` on a double gives the shortest string that round-trips back to the same value,
 * which is exactly what "copy the real number" should mean — `0.1+0.2` copies as
 * `0.30000000000000004` while the display reads `0.3`.
 */
export function fullPrecision(n: number): string {
  return Number.isFinite(n) ? n.toString() : 'Error'
}

/** True when the display is a rounded view of a longer value, so a copy would differ. */
export function isRounded(n: number): boolean {
  return Number.isFinite(n) && formatResult(n) !== fullPrecision(n)
}
