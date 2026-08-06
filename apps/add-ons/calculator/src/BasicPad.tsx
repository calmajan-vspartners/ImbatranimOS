import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Button, cn, useTopWindowKeydown } from '@imbatranim/ui'
import {
  INITIAL_BASIC_STATE,
  applyPercent,
  backspace,
  clearAll,
  displayString,
  evaluateState,
  inputDigit,
  inputOperator,
  toggleSign,
  type BasicInputState,
  type OpGlyph,
} from './engine/basicInput'
import { fullPrecision, isRounded } from './engine/evaluate'
import { CalcToolbar } from './components/CalcToolbar'
import { Tape } from './components/Tape'
import type { CalcSession } from './hooks/useCalcSession'

type Action =
  | { type: 'digit'; digit: string }
  | { type: 'operator'; symbol: OpGlyph }
  | { type: 'sign' }
  | { type: 'percent' }
  | { type: 'backspace' }
  | { type: 'clear' }
  | { type: 'equals' }

function reducer(state: BasicInputState, action: Action): BasicInputState {
  switch (action.type) {
    case 'digit':
      return inputDigit(state, action.digit)
    case 'operator':
      return inputOperator(state, action.symbol)
    case 'sign':
      return toggleSign(state)
    case 'percent':
      return applyPercent(state)
    case 'backspace':
      return backspace(state)
    case 'clear':
      return clearAll()
    case 'equals':
      return evaluateState(state)
  }
}

/**
 * Basic mode: `+ − × ÷`, `%`, `±`, decimal, clear/back, precedence-correct `=`.
 *
 * The keypad is the privileged element in this layout. The display is `flex-1` and shrinks
 * (with a floor, so it never vanishes); the keys are `flex-none`. That ordering plus an honest
 * `minSize` is what keeps the bottom row — `0 . =`, the entire point of the app — on screen
 * at a short window height.
 */
export function BasicPad({
  windowId: _windowId,
  session,
}: {
  windowId: string
  session: CalcSession
}) {
  const [state, dispatch] = useReducer(reducer, INITIAL_BASIC_STATE)
  const [tapeOpen, setTapeOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  /** `=` also writes the tape entry, using the expression as it was before evaluating. */
  const equals = useCallback(() => {
    const expression = displayString(state)
    const next = evaluateState(state)
    if (next.resultValue !== null && state.tokens.length > 0) {
      session.remember(expression, next.resultValue)
    }
    dispatch({ type: 'equals' })
  }, [session, state])

  // The keyboard handler is deliberately deps-free (it is bound once); `equals` changes every
  // time the expression does, so it is reached through a ref rather than re-binding.
  const equalsRef = useRef(equals)
  useEffect(() => {
    equalsRef.current = equals
  }, [equals])

  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key >= '0' && e.key <= '9') {
      e.preventDefault()
      dispatch({ type: 'digit', digit: e.key })
      return
    }
    switch (e.key) {
      case '.':
        e.preventDefault()
        dispatch({ type: 'digit', digit: '.' })
        break
      case '+':
        e.preventDefault()
        dispatch({ type: 'operator', symbol: '+' })
        break
      case '-':
        e.preventDefault()
        dispatch({ type: 'operator', symbol: '−' })
        break
      case '*':
        e.preventDefault()
        dispatch({ type: 'operator', symbol: '×' })
        break
      case '/':
        e.preventDefault()
        dispatch({ type: 'operator', symbol: '÷' })
        break
      case '%':
        e.preventDefault()
        dispatch({ type: 'percent' })
        break
      case 'Enter':
      case '=':
        e.preventDefault()
        equalsRef.current()
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
  }, [])
  useTopWindowKeydown(onKey)

  const display = displayString(state)
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

  /** What the memory keys act on: the last result, else the number being typed. */
  const currentValue = useCallback((): number | null => {
    if (state.resultValue !== null) return state.resultValue
    const last = state.tokens[state.tokens.length - 1]
    if (!last || last.kind !== 'num') return null
    const value = Number(last.exact ?? last.text)
    return Number.isFinite(value) ? value : null
  }, [state.resultValue, state.tokens])

  return (
    <div className="flex h-full flex-col">
      <div className="border-outline-variant bg-surface-container-lowest flex min-h-[44px] flex-1 flex-col items-end justify-end overflow-hidden border-b px-3 py-2">
        <span
          className={cn(
            'font-ui w-full truncate text-right text-3xl font-medium tabular-nums',
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
          if (session.memory === null) return
          for (const ch of String(session.memory)) {
            if (ch === '-') dispatch({ type: 'sign' })
            else dispatch({ type: 'digit', digit: ch })
          }
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
          onReuse={(_value, display2) => {
            dispatch({ type: 'clear' })
            for (const ch of display2) {
              if (ch === '-') dispatch({ type: 'sign' })
              else dispatch({ type: 'digit', digit: ch })
            }
          }}
        />
      )}

      <div className="bg-surface-container-low grid flex-none grid-cols-4 gap-1 p-2">
        <Button className="w-full" onClick={() => dispatch({ type: 'clear' })}>
          C
        </Button>
        <Button
          className="w-full"
          title="Backspace"
          onClick={() => dispatch({ type: 'backspace' })}
        >
          ⌫
        </Button>
        <Button className="w-full" onClick={() => dispatch({ type: 'percent' })}>
          %
        </Button>
        <Button className="w-full" onClick={() => dispatch({ type: 'operator', symbol: '÷' })}>
          ÷
        </Button>

        <Button className="w-full" onClick={() => dispatch({ type: 'digit', digit: '7' })}>
          7
        </Button>
        <Button className="w-full" onClick={() => dispatch({ type: 'digit', digit: '8' })}>
          8
        </Button>
        <Button className="w-full" onClick={() => dispatch({ type: 'digit', digit: '9' })}>
          9
        </Button>
        <Button className="w-full" onClick={() => dispatch({ type: 'operator', symbol: '×' })}>
          ×
        </Button>

        <Button className="w-full" onClick={() => dispatch({ type: 'digit', digit: '4' })}>
          4
        </Button>
        <Button className="w-full" onClick={() => dispatch({ type: 'digit', digit: '5' })}>
          5
        </Button>
        <Button className="w-full" onClick={() => dispatch({ type: 'digit', digit: '6' })}>
          6
        </Button>
        <Button className="w-full" onClick={() => dispatch({ type: 'operator', symbol: '−' })}>
          −
        </Button>

        <Button className="w-full" onClick={() => dispatch({ type: 'digit', digit: '1' })}>
          1
        </Button>
        <Button className="w-full" onClick={() => dispatch({ type: 'digit', digit: '2' })}>
          2
        </Button>
        <Button className="w-full" onClick={() => dispatch({ type: 'digit', digit: '3' })}>
          3
        </Button>
        <Button className="w-full" onClick={() => dispatch({ type: 'operator', symbol: '+' })}>
          +
        </Button>

        <Button className="w-full" title="Toggle sign" onClick={() => dispatch({ type: 'sign' })}>
          ±
        </Button>
        <Button className="w-full" onClick={() => dispatch({ type: 'digit', digit: '0' })}>
          0
        </Button>
        <Button className="w-full" onClick={() => dispatch({ type: 'digit', digit: '.' })}>
          .
        </Button>
        <Button variant="primary" className="w-full" onClick={equals}>
          =
        </Button>
      </div>
    </div>
  )
}
