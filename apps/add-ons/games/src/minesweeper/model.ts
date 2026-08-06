/**
 * Minesweeper rules as pure functions over an immutable board (brief 98).
 *
 * The UI is a thin shell: every decision that can go wrong — a mine under the
 * first click, a flood reveal that leaks through a diagonal, a chord that
 * fires with the wrong flag count — lives here, testable without a DOM.
 */

export type Difficulty = 'beginner' | 'intermediate' | 'expert'

export const PRESETS: Record<Difficulty, { width: number; height: number; mines: number }> = {
  beginner: { width: 9, height: 9, mines: 10 },
  intermediate: { width: 16, height: 16, mines: 40 },
  expert: { width: 30, height: 16, mines: 99 },
}

export type Mark = 'none' | 'flag' | 'question'

export type Cell = {
  mine: boolean
  revealed: boolean
  mark: Mark
  /** Mines in the 8 neighbours; meaningless until mines are placed. */
  adjacent: number
}

export type Board = {
  width: number
  height: number
  mines: number
  /** Row-major. */
  cells: Cell[]
  /** Mines are placed on the first reveal so that click is always safe. */
  minesPlaced: boolean
  state: 'playing' | 'won' | 'lost'
  /** The mine that ended it, for the UI to mark. */
  lostAt: number | null
}

export function createBoard(width: number, height: number, mines: number): Board {
  return {
    width,
    height,
    mines,
    cells: Array.from({ length: width * height }, () => ({
      mine: false,
      revealed: false,
      mark: 'none' as Mark,
      adjacent: 0,
    })),
    minesPlaced: false,
    state: 'playing',
    lostAt: null,
  }
}

export function neighbors(board: Board, index: number): number[] {
  const x = index % board.width
  const y = Math.floor(index / board.width)
  const out: number[] = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || nx >= board.width || ny < 0 || ny >= board.height) continue
      out.push(ny * board.width + nx)
    }
  }
  return out
}

/**
 * Place mines everywhere except the first-clicked cell and (when the board
 * has room) its neighbours — the first click should not just survive, it
 * should usually open an area. `rng` is injected so tests are deterministic.
 */
export function placeMines(
  board: Board,
  safeIndex: number,
  rng: () => number = Math.random
): Board {
  const total = board.width * board.height
  const protectedSet = new Set<number>([safeIndex])
  if (total - board.mines >= 9) {
    for (const n of neighbors(board, safeIndex)) protectedSet.add(n)
  }
  const candidates: number[] = []
  for (let i = 0; i < total; i++) if (!protectedSet.has(i)) candidates.push(i)
  // Fisher–Yates over the candidates; the first `mines` become mines.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
  }
  const mineSet = new Set(candidates.slice(0, board.mines))

  const cells = board.cells.map((cell, i) => ({ ...cell, mine: mineSet.has(i) }))
  for (let i = 0; i < total; i++) {
    cells[i].adjacent = neighbors(board, i).filter((n) => mineSet.has(n)).length
  }
  return { ...board, cells, minesPlaced: true }
}

function countRevealed(cells: Cell[]): number {
  return cells.reduce((n, c) => (c.revealed ? n + 1 : n), 0)
}

function withWinCheck(board: Board): Board {
  const total = board.width * board.height
  if (board.state === 'playing' && countRevealed(board.cells) === total - board.mines) {
    return { ...board, state: 'won' }
  }
  return board
}

/**
 * Reveal a cell. Places mines on the first reveal (first-click-safe), floods
 * out from zero-adjacent cells, loses on a mine. Flagged cells are inert —
 * a flag exists to make the cell unclickable.
 */
export function reveal(board: Board, index: number, rng: () => number = Math.random): Board {
  if (board.state !== 'playing') return board
  let b = board.minesPlaced ? board : placeMines(board, index, rng)
  const cell = b.cells[index]
  if (cell.revealed || cell.mark === 'flag') return b

  if (cell.mine) {
    const cells = b.cells.map((c, i) => (i === index ? { ...c, revealed: true } : c))
    return { ...b, cells, state: 'lost', lostAt: index }
  }

  const cells = [...b.cells]
  const stack = [index]
  while (stack.length > 0) {
    const i = stack.pop()!
    const c = cells[i]
    if (c.revealed || c.mark === 'flag') continue
    cells[i] = { ...c, revealed: true, mark: 'none' }
    if (cells[i].adjacent === 0) {
      for (const n of neighbors(b, i)) {
        if (!cells[n].revealed) stack.push(n)
      }
    }
  }
  b = { ...b, cells }
  return withWinCheck(b)
}

/** none → flag → question → none, matching the classic right-click cycle. */
export function toggleMark(board: Board, index: number): Board {
  if (board.state !== 'playing') return board
  const cell = board.cells[index]
  if (cell.revealed) return board
  const next: Mark = cell.mark === 'none' ? 'flag' : cell.mark === 'flag' ? 'question' : 'none'
  const cells = board.cells.map((c, i) => (i === index ? { ...c, mark: next } : c))
  return { ...board, cells }
}

/**
 * Chord: clicking a revealed number whose neighbours carry exactly that many
 * flags reveals the remaining unflagged neighbours. A wrong flag makes this
 * lose — that is the game's rule, not a bug.
 */
export function chord(board: Board, index: number, rng: () => number = Math.random): Board {
  if (board.state !== 'playing') return board
  const cell = board.cells[index]
  if (!cell.revealed || cell.adjacent === 0) return board
  const ns = neighbors(board, index)
  const flags = ns.filter((n) => board.cells[n].mark === 'flag').length
  if (flags !== cell.adjacent) return board
  let b = board
  for (const n of ns) {
    if (b.state !== 'playing') break
    if (!b.cells[n].revealed && b.cells[n].mark !== 'flag') {
      b = reveal(b, n, rng)
    }
  }
  return b
}

/** Mines minus flags — the classic counter, allowed to go negative. */
export function minesRemaining(board: Board): number {
  const flags = board.cells.filter((c) => c.mark === 'flag').length
  return board.mines - flags
}
