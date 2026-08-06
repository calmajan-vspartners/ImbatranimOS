import { describe, expect, it } from 'vitest'
import {
  PRESETS,
  chord,
  createBoard,
  minesRemaining,
  neighbors,
  placeMines,
  reveal,
  toggleMark,
  type Board,
} from './model'

/** Deterministic rng: cycles the given values. */
function rngOf(...values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]
}

/** A tiny fixed board for rule tests: 3×3, mines exactly where we say. */
function fixedBoard(mineAt: number[]): Board {
  const b = createBoard(3, 3, mineAt.length)
  const cells = b.cells.map((c, i) => ({ ...c, mine: mineAt.includes(i) }))
  for (let i = 0; i < 9; i++) {
    cells[i].adjacent = neighbors(b, i).filter((n) => mineAt.includes(n)).length
  }
  return { ...b, cells, minesPlaced: true }
}

describe('board generation', () => {
  it('the first click is never a mine, nor its neighbours when there is room', () => {
    for (const preset of Object.values(PRESETS)) {
      const board = createBoard(preset.width, preset.height, preset.mines)
      const clicked = Math.floor((preset.width * preset.height) / 2)
      const placed = placeMines(board, clicked, rngOf(0.9, 0.1, 0.5, 0.3, 0.7))
      expect(placed.cells[clicked].mine).toBe(false)
      for (const n of neighbors(placed, clicked)) {
        expect(placed.cells[n].mine).toBe(false)
      }
      expect(placed.cells.filter((c) => c.mine)).toHaveLength(preset.mines)
    }
  })

  it('adjacent counts describe the real neighbourhood', () => {
    const b = fixedBoard([0, 8]) // corners: top-left and bottom-right mines
    expect(b.cells[4].adjacent).toBe(2) // centre touches both
    expect(b.cells[1].adjacent).toBe(1)
    expect(b.cells[7].adjacent).toBe(1)
    expect(b.cells[2].adjacent).toBe(0)
  })
})

describe('reveal', () => {
  it('revealing a mine loses and marks where', () => {
    const b = reveal(fixedBoard([4]), 4)
    expect(b.state).toBe('lost')
    expect(b.lostAt).toBe(4)
  })

  it('flood reveal opens the whole zero region and its numbered rim', () => {
    // Mine in one corner: revealing the opposite corner floods everything
    // except the mine (win by full reveal).
    const b = reveal(fixedBoard([0]), 8)
    expect(b.state).toBe('won')
    expect(b.cells.filter((c) => c.revealed)).toHaveLength(8)
    expect(b.cells[0].revealed).toBe(false)
  })

  it('a flagged cell is inert to reveal', () => {
    const flagged = toggleMark(fixedBoard([4]), 4)
    const b = reveal(flagged, 4)
    expect(b.state).toBe('playing')
    expect(b.cells[4].revealed).toBe(false)
  })

  it('win means all non-mines revealed, not all mines flagged', () => {
    let b = fixedBoard([0, 1])
    for (let i = 2; i < 9; i++) b = reveal(b, i)
    expect(b.state).toBe('won')
  })
})

describe('marks and the counter', () => {
  it('cycles none → flag → question → none', () => {
    let b = fixedBoard([4])
    b = toggleMark(b, 0)
    expect(b.cells[0].mark).toBe('flag')
    b = toggleMark(b, 0)
    expect(b.cells[0].mark).toBe('question')
    b = toggleMark(b, 0)
    expect(b.cells[0].mark).toBe('none')
  })

  it('the counter is mines minus flags and may go negative', () => {
    let b = fixedBoard([4])
    expect(minesRemaining(b)).toBe(1)
    b = toggleMark(b, 0)
    b = toggleMark(b, 1)
    expect(minesRemaining(b)).toBe(-1)
  })
})

describe('chord', () => {
  it('reveals unflagged neighbours when the flag count matches', () => {
    // Mine at 0; reveal 4 (adjacent 1), flag 0, chord on 4.
    let b = fixedBoard([0])
    b = reveal(b, 4)
    b = toggleMark(b, 0)
    b = chord(b, 4)
    expect(b.state).toBe('won')
    expect(b.cells[1].revealed).toBe(true)
    expect(b.cells[8].revealed).toBe(true)
  })

  it('does nothing when the flag count is wrong', () => {
    let b = fixedBoard([0])
    b = reveal(b, 4)
    const before = b
    b = chord(b, 4) // no flags placed
    expect(b).toBe(before)
  })

  it('a wrong flag makes chording lose — the rule, not a bug', () => {
    let b = fixedBoard([0])
    b = reveal(b, 4)
    b = toggleMark(b, 1) // flag the WRONG neighbour
    b = chord(b, 4)
    expect(b.state).toBe('lost')
  })
})
