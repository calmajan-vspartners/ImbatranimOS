/**
 * Bounded undo/redo over opaque snapshots (brief 95). Pure and generic so the
 * branch-discard rule — editing after an undo forgets the redo tail — is
 * tested without ImageData.
 */
export type UndoStack<T> = {
  /** Past states, oldest first. The present is NOT stored here. */
  past: T[]
  future: T[]
  cap: number
}

export function createUndoStack<T>(cap: number): UndoStack<T> {
  return { past: [], future: [], cap }
}

/** Record the present before a change. Discards any redo tail. */
export function push<T>(stack: UndoStack<T>, present: T): UndoStack<T> {
  const past = [...stack.past, present].slice(-stack.cap)
  return { ...stack, past, future: [] }
}

export function canUndo<T>(stack: UndoStack<T>): boolean {
  return stack.past.length > 0
}

export function canRedo<T>(stack: UndoStack<T>): boolean {
  return stack.future.length > 0
}

/** Undo: returns the state to restore and the new stack, given the present. */
export function undo<T>(stack: UndoStack<T>, present: T): { state: T; stack: UndoStack<T> } | null {
  if (stack.past.length === 0) return null
  const state = stack.past[stack.past.length - 1]
  return {
    state,
    stack: { ...stack, past: stack.past.slice(0, -1), future: [...stack.future, present] },
  }
}

/** Redo: returns the state to restore and the new stack, given the present. */
export function redo<T>(stack: UndoStack<T>, present: T): { state: T; stack: UndoStack<T> } | null {
  if (stack.future.length === 0) return null
  const state = stack.future[stack.future.length - 1]
  return {
    state,
    stack: { ...stack, past: [...stack.past, present], future: stack.future.slice(0, -1) },
  }
}
