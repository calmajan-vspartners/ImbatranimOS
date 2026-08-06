import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCcw, Undo2 } from 'lucide-react'
import { Button, ScrollArea, Select, cn, useRegisteredHotkeys } from '@imbatranim/core'
import {
  autoFinishStep,
  autoPlace,
  canAutoFinish,
  draw,
  isRed,
  isWon,
  newGame,
  tableauToFoundation,
  tableauToTableau,
  wasteToFoundation,
  wasteToTableau,
  type Card,
  type DrawCount,
  type Game,
} from './model'
import { useGamesStats } from '../lib/statsStore'

const SUIT_GLYPH: Record<Card['suit'], string> = { S: '♠', H: '♥', D: '♦', C: '♣' }
const RANK_LABEL = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

/** Where a click came from — the selection model's vocabulary. */
type Source = { kind: 'waste' } | { kind: 'tableau'; column: number; cardIndex: number }

const UNDO_CAP = 500

function CardFace({ card, selected }: { card: Card; selected: boolean }) {
  return (
    <div
      className={cn(
        'border-outline-variant bg-surface-container-lowest h-16 w-12 border px-1 py-0.5 select-none',
        // Identity, not skins: red suits carry the accent, black suits the ink.
        isRed(card.suit) ? 'text-primary' : 'text-on-surface',
        selected && 'ring-primary ring-2 ring-inset'
      )}
    >
      <div className="font-ui flex items-start justify-between text-[11px] leading-none font-semibold">
        <span>{RANK_LABEL[card.rank]}</span>
        <span>{SUIT_GLYPH[card.suit]}</span>
      </div>
      <div className="flex h-8 items-center justify-center text-[18px]">
        {SUIT_GLYPH[card.suit]}
      </div>
    </div>
  )
}

function CardBack() {
  return (
    <div className="border-outline-variant bg-surface-container-high h-16 w-12 border select-none">
      <div className="bg-primary/15 m-1 h-[calc(100%-8px)]" />
    </div>
  )
}

function EmptySlot({ label }: { label?: string }) {
  return (
    <div className="border-outline-variant text-on-surface-variant/50 flex h-16 w-12 items-center justify-center border border-dashed text-[14px] select-none">
      {label ?? ''}
    </div>
  )
}

/**
 * Klondike over the pure model (./model). Click a face-up card to select it
 * (with the run below it), click a destination to move; double-click sends a
 * card to its best home. No free drag in v1 — click-to-place is the
 * accessible model and the pointer choreography of a good drag is its own
 * project; noted in the brief's outcome.
 */
export function Solitaire() {
  const [game, setGame] = useState<Game>(() => newGame(1))
  const [history, setHistory] = useState<Game[]>([])
  const [selected, setSelected] = useState<Source | null>(null)
  const recordedRef = useRef(false)
  const recordWin = useGamesStats((s) => s.recordSolitaireWin)
  const recordLoss = useGamesStats((s) => s.recordSolitaireLoss)
  const stats = useGamesStats((s) => s.solitaire)
  const won = isWon(game)

  const start = useCallback(
    (drawCount: DrawCount, countAsLoss: boolean) => {
      if (countAsLoss) recordLoss()
      setGame(newGame(drawCount))
      setHistory([])
      setSelected(null)
      recordedRef.current = false
    },
    [recordLoss]
  )

  useEffect(() => {
    if (won && !recordedRef.current) {
      recordedRef.current = true
      recordWin()
    }
  }, [won, recordWin])

  /**
   * Apply a move if legal: push undo history, clear the selection. Plain
   * closures over this render's `game`/`history` — setState-inside-updater
   * would run twice under StrictMode and double-push the undo stack.
   */
  const apply = (next: Game | null): boolean => {
    if (!next) return false
    setHistory((h) => [...h.slice(-(UNDO_CAP - 1)), game])
    setGame(next)
    setSelected(null)
    return true
  }

  const undo = () => {
    if (history.length === 0) return
    setGame(history[history.length - 1])
    setHistory(history.slice(0, -1))
    setSelected(null)
  }

  // useRegisteredHotkeys captures handlers once per key set, so closures over
  // state would go stale — route them through a ref kept fresh in an effect
  // (the useSaveHotkey pattern).
  const actionsRef = useRef({ newGame: () => {}, undo: () => {} })
  useEffect(() => {
    actionsRef.current = {
      newGame: () => start(game.drawCount, !won && game.moves > 0),
      undo,
    }
  })

  useRegisteredHotkeys([
    {
      id: 'games.solitaire.new',
      keys: 'f2',
      description: 'New Solitaire game',
      scope: 'Editing',
      handler: () => actionsRef.current.newGame(),
    },
    {
      id: 'games.solitaire.undo',
      keys: 'mod+z',
      description: 'Undo the last Solitaire move',
      scope: 'Editing',
      handler: () => actionsRef.current.undo(),
    },
  ])

  const sameSource = (a: Source | null, b: Source): boolean =>
    a !== null &&
    (a.kind === 'waste'
      ? b.kind === 'waste'
      : b.kind === 'tableau' && a.column === b.column && a.cardIndex === b.cardIndex)

  /** Click on a movable card: select it, move the selection here, or clear. */
  const clickSource = (source: Source) => {
    if (sameSource(selected, source)) {
      setSelected(null)
      return
    }
    if (selected && source.kind === 'tableau') {
      // A second click on a column is a move attempt first.
      if (moveSelectionToColumn(source.column)) return
    }
    setSelected(source)
  }

  const moveSelectionToColumn = (column: number): boolean => {
    if (!selected) return false
    if (selected.kind === 'waste') return apply(wasteToTableau(game, column))
    return apply(tableauToTableau(game, selected.column, selected.cardIndex, column))
  }

  const clickFoundation = (foundationIndex: number) => {
    if (!selected) return
    if (selected.kind === 'waste') {
      apply(wasteToFoundation(game, foundationIndex))
      return
    }
    const column = game.tableau[selected.column]
    if (selected.cardIndex === column.length - 1) {
      apply(tableauToFoundation(game, selected.column, foundationIndex))
    }
  }

  const clickEmptyColumn = (column: number) => {
    if (selected) void moveSelectionToColumn(column)
  }

  const doubleClick = (source: Source) => {
    apply(autoPlace(game, source))
  }

  const runAutoFinish = () => {
    let g = game
    const trail: Game[] = []
    for (let next = autoFinishStep(g); next; next = autoFinishStep(g)) {
      trail.push(g)
      g = next
    }
    if (trail.length > 0) {
      setHistory((h) => [...h.slice(-(UNDO_CAP - trail.length)), ...trail])
      setGame(g)
      setSelected(null)
    }
  }

  const wasteTop = game.waste[game.waste.length - 1]

  return (
    <div className="bg-surface flex h-full flex-col">
      <div className="border-outline-variant bg-surface-container-low flex flex-none flex-wrap items-center gap-2 border-b px-2 py-1">
        <Button
          size="sm"
          variant="default"
          onClick={() => start(game.drawCount, !won && game.moves > 0)}
          title="New game (F2)"
        >
          <RotateCcw size={12} />
          New game
        </Button>
        <Select
          aria-label="Draw count"
          className="w-24"
          value={String(game.drawCount)}
          onValueChange={(v) => start(Number(v) as DrawCount, !won && game.moves > 0)}
          options={[
            { value: '1', label: 'Draw 1' },
            { value: '3', label: 'Draw 3' },
          ]}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={undo}
          disabled={history.length === 0}
          title="Undo (mod+Z)"
        >
          <Undo2 size={12} />
          Undo
        </Button>
        {canAutoFinish(game) && (
          <Button size="sm" variant="primary" onClick={runAutoFinish}>
            Auto-finish
          </Button>
        )}
        <div className="flex-1" />
        <span className="font-ui text-on-surface-variant text-[11px]">
          {game.moves} moves · {stats.wins}W {stats.losses}L
        </span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">
          {/* Top row: stock, waste, spacer, foundations */}
          <div className="flex gap-2">
            <button
              type="button"
              aria-label={game.stock.length > 0 ? 'Draw from stock' : 'Recycle the waste'}
              onClick={() => apply(draw(game))}
              className="focus-visible:ring-primary outline-none focus-visible:ring-2"
            >
              {game.stock.length > 0 ? <CardBack /> : <EmptySlot label="↺" />}
            </button>
            <button
              type="button"
              aria-label="Waste"
              disabled={!wasteTop}
              onClick={() => wasteTop && clickSource({ kind: 'waste' })}
              onDoubleClick={() => wasteTop && doubleClick({ kind: 'waste' })}
              className="focus-visible:ring-primary outline-none focus-visible:ring-2"
            >
              {wasteTop ? (
                <CardFace card={wasteTop} selected={selected?.kind === 'waste'} />
              ) : (
                <EmptySlot />
              )}
            </button>
            <div className="w-12" />
            {game.foundations.map((f, i) => {
              const top = f[f.length - 1]
              return (
                <button
                  key={i}
                  type="button"
                  aria-label={`Foundation ${i + 1}`}
                  onClick={() => clickFoundation(i)}
                  className="focus-visible:ring-primary outline-none focus-visible:ring-2"
                >
                  {top ? <CardFace card={top} selected={false} /> : <EmptySlot label="A" />}
                </button>
              )
            })}
          </div>

          {/* Tableau: seven overlapping columns */}
          <div className="flex items-start gap-2">
            {game.tableau.map((column, colIndex) => (
              <div key={colIndex} className="flex min-h-16 w-12 flex-col">
                {column.length === 0 ? (
                  <button
                    type="button"
                    aria-label={`Empty column ${colIndex + 1}`}
                    onClick={() => clickEmptyColumn(colIndex)}
                    className="focus-visible:ring-primary outline-none focus-visible:ring-2"
                  >
                    <EmptySlot label="K" />
                  </button>
                ) : (
                  column.map((c, cardIndex) => {
                    const overlap = cardIndex === 0 ? '' : c.faceUp ? '-mt-11' : '-mt-14'
                    if (!c.faceUp) {
                      return (
                        <div key={c.id} className={overlap}>
                          <CardBack />
                        </div>
                      )
                    }
                    const source: Source = { kind: 'tableau', column: colIndex, cardIndex }
                    const isSelected =
                      selected?.kind === 'tableau' &&
                      selected.column === colIndex &&
                      selected.cardIndex <= cardIndex
                    return (
                      <button
                        key={c.id}
                        type="button"
                        aria-label={`${RANK_LABEL[c.rank]} of ${c.suit}`}
                        onClick={() => clickSource(source)}
                        onDoubleClick={() => doubleClick(source)}
                        className={cn(
                          overlap,
                          'focus-visible:ring-primary outline-none focus-visible:ring-2'
                        )}
                      >
                        <CardFace card={c} selected={isSelected} />
                      </button>
                    )
                  })
                )}
              </div>
            ))}
          </div>
        </div>
      </ScrollArea>

      <div className="border-outline-variant bg-surface-container-low text-on-surface-variant flex h-6 flex-none items-center gap-2 border-t px-2 text-[10px]">
        {won ? (
          <span className="text-primary font-semibold">
            You won in {game.moves} moves — F2 deals again.
          </span>
        ) : (
          <span>Click a card, then its destination · double-click sends it home</span>
        )}
      </div>
    </div>
  )
}
