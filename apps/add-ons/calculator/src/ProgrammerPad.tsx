import { useCallback, useReducer } from 'react'
import { Button, cn, useTopWindowKeydown } from '@imbatranim/ui'
import { validDigitsForBase, type Base } from './engine/programmer'
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
  type ProgOp,
  type ProgrammerState,
} from './engine/programmerInput'

type Action =
  | { type: 'digit'; digit: string }
  | { type: 'operator'; op: ProgOp }
  | { type: 'not' }
  | { type: 'backspace' }
  | { type: 'clear' }
  | { type: 'equals' }
  | { type: 'base'; base: Base }

function reducer(state: ProgrammerState, action: Action): ProgrammerState {
  switch (action.type) {
    case 'digit':
      return inputDigit(state, action.digit)
    case 'operator':
      return pressOperator(state, action.op)
    case 'not':
      return pressNot(state)
    case 'backspace':
      return backspace(state)
    case 'clear':
      return clearAll(state)
    case 'equals':
      return pressEquals(state)
    case 'base':
      return setBase(state, action.base)
  }
}

const BASES: { id: Base; label: string }[] = [
  { id: 16, label: 'HEX' },
  { id: 10, label: 'DEC' },
  { id: 8, label: 'OCT' },
  { id: 2, label: 'BIN' },
]

const HEX_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

/** Programmer mode: HEX/DEC/OCT/BIN display + base switch, bitwise + shifts, on a 64-bit bigint. */
export function ProgrammerPad({ windowId: _windowId }: { windowId: string }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_PROGRAMMER_STATE)
  const enabledDigits = new Set(validDigitsForBase(state.base))

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const upper = e.key.toUpperCase()
      if (/^[0-9A-F]$/.test(upper) && validDigitsForBase(state.base).includes(upper)) {
        e.preventDefault()
        dispatch({ type: 'digit', digit: upper })
        return
      }
      switch (e.key) {
        case '+':
          e.preventDefault()
          dispatch({ type: 'operator', op: '+' })
          break
        case '-':
          e.preventDefault()
          dispatch({ type: 'operator', op: '−' })
          break
        case '*':
          e.preventDefault()
          dispatch({ type: 'operator', op: '×' })
          break
        case '/':
          e.preventDefault()
          dispatch({ type: 'operator', op: '÷' })
          break
        case '&':
          e.preventDefault()
          dispatch({ type: 'operator', op: 'AND' })
          break
        case '|':
          e.preventDefault()
          dispatch({ type: 'operator', op: 'OR' })
          break
        case '^':
          e.preventDefault()
          dispatch({ type: 'operator', op: 'XOR' })
          break
        case '~':
          e.preventDefault()
          dispatch({ type: 'not' })
          break
        case 'Enter':
        case '=':
          e.preventDefault()
          dispatch({ type: 'equals' })
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
    [state.base]
  )
  useTopWindowKeydown(onKey)

  const display = displayString(state)
  const isError = Boolean(state.error)

  return (
    <div className="flex h-full flex-col">
      <div className="border-outline-variant bg-surface-container-low flex flex-none items-center gap-0.5 border-b px-1 py-1">
        {BASES.map((b) => {
          const active = state.base === b.id
          return (
            <button
              key={b.id}
              onClick={() => dispatch({ type: 'base', base: b.id })}
              className={cn(
                'font-ui flex-1 border px-2 py-1 text-[11px] font-semibold tracking-wider uppercase transition-colors',
                active
                  ? 'border-primary bg-primary text-on-primary'
                  : 'text-on-surface-variant hover:border-outline-variant hover:text-on-surface border-transparent'
              )}
            >
              {b.label}
            </button>
          )
        })}
      </div>

      <div className="border-outline-variant bg-surface-container-lowest flex flex-1 items-end justify-end overflow-hidden border-b px-3 py-3">
        <span
          className={cn(
            'font-ui truncate text-2xl font-medium tabular-nums',
            isError ? 'text-error' : 'text-on-surface'
          )}
          title={display}
        >
          {display}
        </span>
      </div>

      <div className="bg-surface-container-low flex flex-none gap-1 p-2 pb-1">
        {HEX_LETTERS.map((letter) => (
          <Button
            key={letter}
            className="flex-1"
            disabled={!enabledDigits.has(letter)}
            onClick={() => dispatch({ type: 'digit', digit: letter })}
          >
            {letter}
          </Button>
        ))}
      </div>

      <div className="bg-surface-container-low grid flex-none grid-cols-4 gap-1 p-2 pt-1">
        <Button className="w-full" onClick={() => dispatch({ type: 'operator', op: 'AND' })}>
          AND
        </Button>
        <Button className="w-full" onClick={() => dispatch({ type: 'operator', op: 'OR' })}>
          OR
        </Button>
        <Button className="w-full" onClick={() => dispatch({ type: 'operator', op: 'XOR' })}>
          XOR
        </Button>
        <Button className="w-full" onClick={() => dispatch({ type: 'not' })}>
          NOT
        </Button>

        <Button className="w-full" onClick={() => dispatch({ type: 'operator', op: '<<' })}>
          {'<<'}
        </Button>
        <Button className="w-full" onClick={() => dispatch({ type: 'operator', op: '>>' })}>
          {'>>'}
        </Button>
        <Button className="w-full" onClick={() => dispatch({ type: 'clear' })}>
          AC
        </Button>
        <Button
          className="w-full"
          title="Backspace"
          onClick={() => dispatch({ type: 'backspace' })}
        >
          ⌫
        </Button>

        <Button
          className="w-full"
          disabled={!enabledDigits.has('7')}
          onClick={() => dispatch({ type: 'digit', digit: '7' })}
        >
          7
        </Button>
        <Button
          className="w-full"
          disabled={!enabledDigits.has('8')}
          onClick={() => dispatch({ type: 'digit', digit: '8' })}
        >
          8
        </Button>
        <Button
          className="w-full"
          disabled={!enabledDigits.has('9')}
          onClick={() => dispatch({ type: 'digit', digit: '9' })}
        >
          9
        </Button>
        <Button className="w-full" onClick={() => dispatch({ type: 'operator', op: '÷' })}>
          ÷
        </Button>

        <Button
          className="w-full"
          disabled={!enabledDigits.has('4')}
          onClick={() => dispatch({ type: 'digit', digit: '4' })}
        >
          4
        </Button>
        <Button
          className="w-full"
          disabled={!enabledDigits.has('5')}
          onClick={() => dispatch({ type: 'digit', digit: '5' })}
        >
          5
        </Button>
        <Button
          className="w-full"
          disabled={!enabledDigits.has('6')}
          onClick={() => dispatch({ type: 'digit', digit: '6' })}
        >
          6
        </Button>
        <Button className="w-full" onClick={() => dispatch({ type: 'operator', op: '×' })}>
          ×
        </Button>

        <Button
          className="w-full"
          disabled={!enabledDigits.has('1')}
          onClick={() => dispatch({ type: 'digit', digit: '1' })}
        >
          1
        </Button>
        <Button
          className="w-full"
          disabled={!enabledDigits.has('2')}
          onClick={() => dispatch({ type: 'digit', digit: '2' })}
        >
          2
        </Button>
        <Button
          className="w-full"
          disabled={!enabledDigits.has('3')}
          onClick={() => dispatch({ type: 'digit', digit: '3' })}
        >
          3
        </Button>
        <Button className="w-full" onClick={() => dispatch({ type: 'operator', op: '−' })}>
          −
        </Button>

        <Button
          className="col-span-2 w-full"
          disabled={!enabledDigits.has('0')}
          onClick={() => dispatch({ type: 'digit', digit: '0' })}
        >
          0
        </Button>
        <Button className="w-full" onClick={() => dispatch({ type: 'operator', op: '+' })}>
          +
        </Button>
        <Button variant="primary" className="w-full" onClick={() => dispatch({ type: 'equals' })}>
          =
        </Button>
      </div>
    </div>
  )
}
