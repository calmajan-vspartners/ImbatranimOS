import { describe, expect, it } from 'vitest'
import { canReorder, sortTodos } from './sort'
import type { Todo } from './types'

const at = (y: number, m: number, d: number): number => new Date(y, m - 1, d).getTime()

let nextId = 1
function todo(over: Partial<Todo> = {}): Todo {
  const id = over.id ?? nextId++
  return {
    id,
    text: `todo ${id}`,
    completed: false,
    position: id,
    dueAt: null,
    priority: false,
    listId: null,
    createdAt: '2026-07-01T09:00:00Z',
    updatedAt: '2026-07-01T09:00:00Z',
    ...over,
  }
}

const texts = (list: Todo[]) => list.map((t) => t.text)

describe('manual order', () => {
  it('is exactly the stored positions', () => {
    const list = [
      todo({ id: 1, text: 'third', position: 3 }),
      todo({ id: 2, text: 'first', position: 1 }),
      todo({ id: 3, text: 'second', position: 2 }),
    ]
    expect(texts(sortTodos(list, 'manual'))).toEqual(['first', 'second', 'third'])
  })

  it('does NOT float priority to the top', () => {
    // Manual means manual. A list that silently reorders itself after you drag it
    // is not a list you can arrange; priority is a marker here, not a sort key.
    const list = [
      todo({ id: 1, text: 'plain', position: 1 }),
      todo({ id: 2, text: 'important', position: 2, priority: true }),
    ]
    expect(texts(sortTodos(list, 'manual'))).toEqual(['plain', 'important'])
  })

  it('breaks a position tie by id, so the order never flickers', () => {
    const list = [todo({ id: 9, text: 'b', position: 1 }), todo({ id: 4, text: 'a', position: 1 })]
    expect(texts(sortTodos(list, 'manual'))).toEqual(['a', 'b'])
  })
})

describe('due order', () => {
  it('sorts by due date, with undated todos last', () => {
    const list = [
      todo({ id: 1, text: 'none', dueAt: null }),
      todo({ id: 2, text: 'later', dueAt: at(2026, 7, 25) }),
      todo({ id: 3, text: 'sooner', dueAt: at(2026, 7, 20) }),
    ]
    expect(texts(sortTodos(list, 'due'))).toEqual(['sooner', 'later', 'none'])
  })

  it('puts priority first, then the dates', () => {
    const list = [
      todo({ id: 1, text: 'soon', dueAt: at(2026, 7, 20) }),
      todo({ id: 2, text: 'important later', dueAt: at(2026, 7, 30), priority: true }),
      todo({ id: 3, text: 'important sooner', dueAt: at(2026, 7, 22), priority: true }),
    ]
    expect(texts(sortTodos(list, 'due'))).toEqual(['important sooner', 'important later', 'soon'])
  })

  it('keeps undated priority todos above dated ordinary ones', () => {
    const list = [
      todo({ id: 1, text: 'dated', dueAt: at(2026, 7, 20) }),
      todo({ id: 2, text: 'important undated', priority: true }),
    ]
    expect(texts(sortTodos(list, 'due'))).toEqual(['important undated', 'dated'])
  })
})

describe('created order', () => {
  it('is oldest first', () => {
    const list = [
      todo({ id: 1, text: 'newer', createdAt: '2026-07-05T09:00:00Z' }),
      todo({ id: 2, text: 'older', createdAt: '2026-07-01T09:00:00Z' }),
    ]
    expect(texts(sortTodos(list, 'created'))).toEqual(['older', 'newer'])
  })

  it('puts priority first here too', () => {
    const list = [
      todo({ id: 1, text: 'old', createdAt: '2026-07-01T09:00:00Z' }),
      todo({ id: 2, text: 'new important', createdAt: '2026-07-09T09:00:00Z', priority: true }),
    ]
    expect(texts(sortTodos(list, 'created'))).toEqual(['new important', 'old'])
  })
})

describe('sortTodos', () => {
  it('never mutates its input — the array comes from the query cache', () => {
    const list = [todo({ id: 1, text: 'b', position: 2 }), todo({ id: 2, text: 'a', position: 1 })]
    const before = texts(list)
    sortTodos(list, 'manual')
    expect(texts(list)).toEqual(before)
  })

  it('handles an empty list', () => {
    expect(sortTodos([], 'due')).toEqual([])
  })
})

describe('canReorder', () => {
  it('allows dragging only when the visible order is the stored one', () => {
    // Dragging in a derived order would write positions the view is not showing.
    expect(canReorder('manual')).toBe(true)
    expect(canReorder('due')).toBe(false)
    expect(canReorder('created')).toBe(false)
  })
})
