import { useCallback, useEffect, useRef, useState } from 'react'
import { Bomb, Flag, Trophy } from 'lucide-react'
import { Button, ScrollArea, Select, cn, useRegisteredHotkeys } from '@imbatranim/core'
import {
  PRESETS,
  chord,
  createBoard,
  minesRemaining,
  reveal,
  toggleMark,
  type Board,
  type Difficulty,
} from './model'
import { useGamesStats } from '../lib/statsStore'

function boardFor(difficulty: Difficulty): Board {
  const p = PRESETS[difficulty]
  return createBoard(p.width, p.height, p.mines)
}

/**
 * The board is pure (./model); this component owns only the session: which
 * difficulty, the running clock, focus for keyboard play, and pushing the
 * result into the stats store once per game.
 */
export function Minesweeper() {
  const [difficulty, setDifficulty] = useState<Difficulty>('beginner')
  const [board, setBoard] = useState<Board>(() => boardFor('beginner'))
  const [seconds, setSeconds] = useState(0)
  const startRef = useRef<number | null>(null)
  const recordedRef = useRef(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const recordResult = useGamesStats((s) => s.recordMinesweeper)
  const best = useGamesStats((s) => s.minesweeper.best[difficulty])

  const newGame = useCallback(
    (nextDifficulty: Difficulty = difficulty) => {
      setDifficulty(nextDifficulty)
      setBoard(boardFor(nextDifficulty))
      setSeconds(0)
      startRef.current = null
      recordedRef.current = false
    },
    [difficulty]
  )

  // The clock runs from the first reveal to the end of the game. Timestamp
  // arithmetic, not a counter — a throttled background tab must not slow it.
  useEffect(() => {
    if (board.state !== 'playing' || !board.minesPlaced) return
    const id = setInterval(() => {
      if (startRef.current !== null) {
        setSeconds(Math.min(999, Math.floor((Date.now() - startRef.current) / 1000)))
      }
    }, 250)
    return () => clearInterval(id)
  }, [board.state, board.minesPlaced])

  // Record each finished game exactly once.
  useEffect(() => {
    if (board.state === 'playing' || recordedRef.current) return
    recordedRef.current = true
    recordResult(board.state === 'won' ? 'win' : 'loss', difficulty, seconds)
  }, [board.state, difficulty, seconds, recordResult])

  // The clock starts when the first reveal places the mines — observed via
  // state (an effect may read the clock; a render-created handler may not).
  useEffect(() => {
    if (board.minesPlaced && startRef.current === null) startRef.current = Date.now()
  }, [board.minesPlaced])

  const handleReveal = (index: number) => {
    setBoard((b) => {
      const cell = b.cells[index]
      // Clicking a revealed number chords; clicking a covered cell reveals.
      return cell.revealed ? chord(b, index) : reveal(b, index)
    })
  }

  const handleMark = (index: number) => {
    setBoard((b) => toggleMark(b, index))
  }

  // Keyboard play: arrows move focus across the grid, Enter/Space reveal
  // (buttons do that natively), F marks. Roving focus over real <button>s.
  const moveFocus = (from: number, dx: number, dy: number) => {
    const x = (from % board.width) + dx
    const y = Math.floor(from / board.width) + dy
    if (x < 0 || x >= board.width || y < 0 || y >= board.height) return
    const target = gridRef.current?.querySelector<HTMLButtonElement>(
      `[data-index="${y * board.width + x}"]`
    )
    target?.focus()
  }

  // useRegisteredHotkeys captures handlers once per key set — keep the real
  // action in a ref so F2 starts a game at the CURRENT difficulty, not the
  // one from the first render (the useSaveHotkey pattern).
  const newGameRef = useRef(newGame)
  useEffect(() => {
    newGameRef.current = newGame
  })

  useRegisteredHotkeys([
    {
      id: 'games.minesweeper.new',
      keys: 'f2',
      description: 'New Minesweeper game',
      scope: 'Editing',
      handler: () => newGameRef.current(),
    },
  ])

  const face = board.state === 'lost' ? '×' : board.state === 'won' ? '★' : '☺'

  return (
    <div className="bg-surface flex h-full flex-col">
      <div className="border-outline-variant bg-surface-container-low flex flex-none flex-wrap items-center gap-2 border-b px-2 py-1">
        <span className="text-on-surface w-10 font-mono text-[13px] tabular-nums">
          {String(Math.max(-99, minesRemaining(board))).padStart(3, '0')}
        </span>
        <Button
          size="sm"
          variant="default"
          aria-label="New game"
          title="New game (F2)"
          className="h-6 w-8 p-0 text-[13px]"
          onClick={() => newGame()}
        >
          {face}
        </Button>
        <span className="text-on-surface w-10 font-mono text-[13px] tabular-nums">
          {String(seconds).padStart(3, '0')}
        </span>
        <div className="flex-1" />
        <Select
          aria-label="Difficulty"
          className="w-32"
          value={difficulty}
          onValueChange={(v) => newGame(v as Difficulty)}
          options={[
            { value: 'beginner', label: 'Beginner' },
            { value: 'intermediate', label: 'Intermediate' },
            { value: 'expert', label: 'Expert' },
          ]}
        />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          <div
            ref={gridRef}
            role="grid"
            aria-label="Minesweeper board"
            className="inline-grid gap-px"
            style={{ gridTemplateColumns: `repeat(${board.width}, 24px)` }}
          >
            {board.cells.map((cell, i) => {
              const lostHere = board.lostAt === i
              return (
                <button
                  key={i}
                  type="button"
                  data-index={i}
                  aria-label={`Cell ${(i % board.width) + 1}, ${Math.floor(i / board.width) + 1}`}
                  disabled={board.state !== 'playing' && !cell.revealed}
                  onClick={() => handleReveal(i)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    handleMark(i)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') moveFocus(i, -1, 0)
                    else if (e.key === 'ArrowRight') moveFocus(i, 1, 0)
                    else if (e.key === 'ArrowUp') moveFocus(i, 0, -1)
                    else if (e.key === 'ArrowDown') moveFocus(i, 0, 1)
                    else if (e.key.toLowerCase() === 'f') {
                      e.preventDefault()
                      handleMark(i)
                    } else return
                    e.preventDefault()
                  }}
                  className={cn(
                    'flex h-6 w-6 items-center justify-center font-mono text-[12px] font-bold select-none',
                    'focus-visible:ring-primary outline-none focus-visible:ring-2 focus-visible:ring-inset',
                    cell.revealed
                      ? lostHere
                        ? 'bg-primary text-on-primary'
                        : 'bg-surface-container-lowest text-primary'
                      : 'border-outline-variant bg-surface-container-high hover:bg-surface-container border'
                  )}
                >
                  {cell.revealed ? (
                    cell.mine ? (
                      <Bomb size={13} strokeWidth={2} />
                    ) : cell.adjacent > 0 ? (
                      cell.adjacent
                    ) : (
                      ''
                    )
                  ) : cell.mark === 'flag' ? (
                    <Flag size={12} strokeWidth={2} className="text-primary" />
                  ) : cell.mark === 'question' ? (
                    '?'
                  ) : board.state !== 'playing' && cell.mine ? (
                    <Bomb size={13} strokeWidth={1.5} className="opacity-50" />
                  ) : (
                    ''
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </ScrollArea>

      <div className="border-outline-variant bg-surface-container-low text-on-surface-variant flex h-6 flex-none items-center gap-2 border-t px-2 text-[10px]">
        {board.state === 'won' && <span className="text-primary font-semibold">Cleared!</span>}
        {board.state === 'lost' && <span>Boom. F2 for a new game.</span>}
        {board.state === 'playing' && (
          <span>Right-click or F to flag · click a number to chord</span>
        )}
        <div className="flex-1" />
        {best !== undefined && (
          <span className="flex items-center gap-1">
            <Trophy size={10} />
            best {best}s
          </span>
        )}
      </div>
    </div>
  )
}
