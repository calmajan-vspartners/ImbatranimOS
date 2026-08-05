import { useCallback, useState } from 'react'
import { formatResult } from '../engine/evaluate'

/**
 * Memory register and tape, shared by Basic and Scientific mode.
 *
 * Session state on purpose: it lives in the window and dies with it. That matches a physical
 * calculator (M is not a document), and it avoids inventing a storage schema for something
 * nobody expects to find again tomorrow — the brief says as much, and it is the cheap answer
 * as well as the right one.
 *
 * Programmer mode does not take part. It works in BigInt over a fixed 64-bit width, and a
 * double from the memory register has no honest meaning there.
 */

export type TapeEntry = {
  /** Monotonic id, so React keys survive an entry being trimmed off the end. */
  id: number
  expression: string
  /** Display form. */
  result: string
  /** Unrounded, so reusing an entry does not lose what `=` computed. */
  value: number
}

/** Kept short deliberately: this is a tape, not a history feature. */
export const MAX_TAPE_ENTRIES = 30

export function useCalcSession() {
  const [memory, setMemory] = useState<number | null>(null)
  const [tape, setTape] = useState<TapeEntry[]>([])

  const remember = useCallback((expression: string, value: number) => {
    if (!Number.isFinite(value)) return
    setTape((prev) => {
      // Newest first: the entry you want to reuse is almost always the last one. The id comes
      // from the current head rather than a separate counter, so it stays unique even after
      // older entries are trimmed off the tail.
      const entry: TapeEntry = {
        id: (prev[0]?.id ?? 0) + 1,
        expression,
        result: formatResult(value),
        value,
      }
      return [entry, ...prev].slice(0, MAX_TAPE_ENTRIES)
    })
  }, [])

  const clearTape = useCallback(() => setTape([]), [])

  /** M+ / M− start from zero when memory is empty, which is what the keys mean. */
  const addToMemory = useCallback((value: number) => {
    setMemory((prev) => (prev ?? 0) + value)
  }, [])

  const subtractFromMemory = useCallback((value: number) => {
    setMemory((prev) => (prev ?? 0) - value)
  }, [])

  const storeMemory = useCallback((value: number) => setMemory(value), [])
  const clearMemory = useCallback(() => setMemory(null), [])

  return {
    memory,
    tape,
    remember,
    clearTape,
    addToMemory,
    subtractFromMemory,
    storeMemory,
    clearMemory,
  }
}

export type CalcSession = ReturnType<typeof useCalcSession>
