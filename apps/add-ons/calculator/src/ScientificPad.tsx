import { useCallback, useReducer, useState } from 'react'
import { Button, cn, useTopWindowKeydown } from '@imbatranim/ui'
import {
  INITIAL_SCI_STATE,
  backspace,
  clearAll,
  displayExpr,
  evaluateState,
  insert,
  normalizeForEval,
  type SciInputState,
} from './engine/sciInput'
import { fullPrecision, isRounded, type AngleMode } from './engine/evaluate'
import { CalcToolbar } from './components/CalcToolbar'
import { Tape } from './components/Tape'
import type { CalcSession } from './hooks/useCalcSession'

type Action =
  | { type: 'insert'; text: string }
  | { type: 'backspace' }
  | { type: 'clear' }
  | { type: 'equals'; angleMode: AngleMode }

function reducer(state: SciInputState, action: Action): SciInputState {
  switch (action.type) {
    case 'insert':
      return insert(state, action.text)
    case 'backspace':
      return backspace(state)
    case 'clear':
      return clearAll()
    case 'equals':
      return evaluateState(state, action.angleMode)
  }
}

/** One keypad button: what it inserts, and what it shows. */
type Key = { label: string; insert: string; title?: string; wide?: boolean }

const FUNCTION_KEYS: Key[][] = [
  [
    { label: 'sin', insert: 'sin(' },
    { label: 'cos', insert: 'cos(' },
    { label: 'tan', insert: 'tan(' },
    { label: 'ln', insert: 'ln(', title: 'Natural log' },
    { label: 'log', insert: 'log(', title: 'Log base 10' },
  ],
  [
    { label: 'sin⁻¹', insert: 'asin(', title: 'Inverse sine' },
    { label: 'cos⁻¹', insert: 'acos(', title: 'Inverse cosine' },
    { label: 'tan⁻¹', insert: 'atan(', title: 'Inverse tangent' },
    { label: 'eˣ', insert: 'exp(' },
    { label: '|x|', insert: 'abs(' },
  ],
  [
    { label: '√', insert: 'sqrt(', title: 'Square root' },
    { label: '∛', insert: 'cbrt(', title: 'Cube root' },
    { label: 'xʸ', insert: '^', title: 'Power' },
    { label: 'x!', insert: '!', title: 'Factorial' },
    { label: 'π', insert: 'π' },
  ],
]

const PAD_KEYS: Key[][] = [
  [
    { label: '(', insert: '(' },
    { label: ')', insert: ')' },
    { label: '%', insert: '%' },
    { label: '÷', insert: '÷' },
  ],
  [
    { label: '7', insert: '7' },
    { label: '8', insert: '8' },
    { label: '9', insert: '9' },
    { label: '×', insert: '×' },
  ],
  [
    { label: '4', insert: '4' },
    { label: '5', insert: '5' },
    { label: '6', insert: '6' },
    { label: '−', insert: '−' },
  ],
  [
    { label: '1', insert: '1' },
    { label: '2', insert: '2' },
    { label: '3', insert: '3' },
    { label: '+', insert: '+' },
  ],
  [
    { label: 'e', insert: 'e', title: 'Euler’s number' },
    { label: '0', insert: '0' },
    { label: '.', insert: '.' },
  ],
]

/**
 * Scientific mode: parentheses, trig, logs, powers, roots, factorial and constants, on the
 * same evaluator Basic mode uses.
 *
 * Layout follows the rule the brief is really about: **the keypad is privileged.** The display
 * is the flexible element and shrinks (its text stays right-aligned and truncates); the keys
 * are `flex-none`, because a calculator whose bottom row has been pushed off-screen is not a
 * calculator. The window's `minSize` is measured against this pad, which is the tallest of the
 * three.
 */
export function ScientificPad({
  windowId: _windowId,
  session,
}: {
  windowId: string
  session: CalcSession
}) {
  const [state, dispatch] = useReducer(reducer, INITIAL_SCI_STATE)
  const [angleMode, setAngleMode] = useState<AngleMode>('deg')
  const [tapeOpen, setTapeOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  /** `=`, plus the tape entry it produces. */
  const equals = useCallback(() => {
    const expression = normalizeForEval(state.expr)
    const next = evaluateState(state, angleMode)
    if (next.resultValue !== null && expression !== '')
      session.remember(expression, next.resultValue)
    dispatch({ type: 'equals', angleMode })
  }, [angleMode, session, state])

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault()
        dispatch({ type: 'insert', text: e.key })
        return
      }
      const direct: Record<string, string> = {
        '.': '.',
        '+': '+',
        '-': '−',
        '*': '×',
        '/': '÷',
        '^': '^',
        '(': '(',
        ')': ')',
        '%': '%',
        '!': '!',
      }
      if (direct[e.key]) {
        e.preventDefault()
        dispatch({ type: 'insert', text: direct[e.key] })
        return
      }
      switch (e.key) {
        case 'Enter':
        case '=':
          e.preventDefault()
          equals()
          break
        case 'Backspace':
          e.preventDefault()
          dispatch({ type: 'backspace' })
          break
        case 'Escape':
          e.preventDefault()
          dispatch({ type: 'clear' })
          break
      }
    },
    [equals]
  )
  useTopWindowKeydown(onKey)

  const display = displayExpr(state)
  const isError = Boolean(state.error)
  const shown = state.resultValue
  const copyValue = shown === null ? '' : fullPrecision(shown)

  const copy = useCallback(() => {
    if (copyValue === '') return
    void navigator.clipboard?.writeText(copyValue).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      },
      () => undefined
    )
  }, [copyValue])

  /** The value the memory keys and the tape act on: the last result, else what is typed. */
  const currentValue = useCallback((): number | null => {
    if (state.resultValue !== null) return state.resultValue
    const asNumber = Number(state.expr)
    return Number.isFinite(asNumber) && state.expr !== '' ? asNumber : null
  }, [state.expr, state.resultValue])

  const key =
    'font-ui border-outline-variant text-on-surface hover:bg-surface-container-high ' +
    'flex h-7 items-center justify-center border text-[11px]'

  return (
    <div className="flex h-full flex-col">
      {/* Display: the flexible element, so the keypad never loses the layout fight. */}
      <div className="border-outline-variant bg-surface-container-lowest flex min-h-[36px] flex-1 flex-col items-end justify-end overflow-hidden border-b px-3 py-2">
        <span
          className={cn(
            'font-ui w-full truncate text-right text-2xl font-medium tabular-nums',
            isError ? 'text-error' : 'text-on-surface'
          )}
          title={shown !== null && isRounded(shown) ? `Exactly ${copyValue}` : display}
        >
          {display}
        </span>
        {shown !== null && isRounded(shown) && (
          <span className="text-on-surface-variant font-ui text-[9px]">rounded · {copyValue}</span>
        )}
      </div>

      <CalcToolbar
        memory={session.memory}
        onMemoryClear={session.clearMemory}
        onMemoryRecall={() => {
          if (session.memory !== null) dispatch({ type: 'insert', text: String(session.memory) })
        }}
        onMemoryAdd={() => {
          const value = currentValue()
          if (value !== null) session.addToMemory(value)
        }}
        onMemorySubtract={() => {
          const value = currentValue()
          if (value !== null) session.subtractFromMemory(value)
        }}
        tapeOpen={tapeOpen}
        onToggleTape={() => setTapeOpen((open) => !open)}
        onCopy={copy}
        copied={copied}
        copyTitle={copyValue}
        copyEnabled={copyValue !== ''}
      />

      {tapeOpen && (
        <Tape
          entries={session.tape}
          onClear={session.clearTape}
          onReuse={(value) => dispatch({ type: 'insert', text: String(value) })}
        />
      )}

      <div className="bg-surface-container-low flex flex-none flex-col gap-1 p-2">
        <div className="flex items-center gap-1">
          {(['deg', 'rad'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setAngleMode(mode)}
              aria-pressed={angleMode === mode}
              className={cn(
                'font-ui border-outline-variant h-6 flex-1 border text-[10px] font-semibold uppercase',
                angleMode === mode
                  ? 'bg-primary text-on-primary border-primary'
                  : 'text-on-surface hover:bg-surface-container-high'
              )}
            >
              {mode}
            </button>
          ))}
          <button
            type="button"
            onClick={() => dispatch({ type: 'clear' })}
            className="font-ui border-outline-variant text-on-surface hover:bg-surface-container-high h-6 flex-1 border text-[10px] font-semibold"
          >
            C
          </button>
          <button
            type="button"
            aria-label="Backspace"
            title="Backspace"
            onClick={() => dispatch({ type: 'backspace' })}
            className="font-ui border-outline-variant text-on-surface hover:bg-surface-container-high h-6 flex-1 border text-[11px]"
          >
            ⌫
          </button>
        </div>

        {FUNCTION_KEYS.map((row) => (
          <div key={row[0].label} className="grid grid-cols-5 gap-1">
            {row.map((k) => (
              <button
                key={k.label}
                type="button"
                title={k.title ?? k.label}
                onClick={() => dispatch({ type: 'insert', text: k.insert })}
                className={key}
              >
                {k.label}
              </button>
            ))}
          </div>
        ))}

        {PAD_KEYS.map((row) => (
          <div key={row[0].label} className="grid grid-cols-4 gap-1">
            {row.map((k) => (
              <Button
                key={k.label}
                className="w-full"
                title={k.title}
                onClick={() => dispatch({ type: 'insert', text: k.insert })}
              >
                {k.label}
              </Button>
            ))}
            {row.length === 3 && (
              <Button variant="primary" className="w-full" onClick={equals}>
                =
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
