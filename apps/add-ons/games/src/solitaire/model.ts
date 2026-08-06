/**
 * Klondike Solitaire rules as pure functions over an immutable game (brief 98).
 *
 * Every mutation returns a new `Game`; the UI keeps an undo stack of the
 * states it passed through. Nothing here touches the DOM, timers or storage.
 */

export type Suit = 'S' | 'H' | 'D' | 'C'
/** 1 = ace … 13 = king. */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13

export type Card = {
  suit: Suit
  rank: Rank
  faceUp: boolean
  /** Stable identity for React keys and move tracking, e.g. "S12". */
  id: string
}

export type DrawCount = 1 | 3

export type Game = {
  stock: Card[]
  waste: Card[]
  /** Four piles, ace → king, one per suit as they land. */
  foundations: [Card[], Card[], Card[], Card[]]
  /** Seven columns. */
  tableau: Card[][]
  drawCount: DrawCount
  moves: number
  /** Passes through the stock so a UI could someday limit draw-1 redeals. */
  redeals: number
}

const SUITS: Suit[] = ['S', 'H', 'D', 'C']

export function isRed(suit: Suit): boolean {
  return suit === 'H' || suit === 'D'
}

function freshDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (let rank = 1 as Rank; rank <= 13; rank++) {
      deck.push({ suit, rank: rank as Rank, faceUp: false, id: `${suit}${rank}` })
    }
  }
  return deck
}

export function newGame(drawCount: DrawCount, rng: () => number = Math.random): Game {
  const deck = freshDeck()
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  const tableau: Card[][] = []
  let cursor = 0
  for (let col = 0; col < 7; col++) {
    const pile = deck.slice(cursor, cursor + col + 1).map((c, i) => ({
      ...c,
      faceUp: i === col,
    }))
    cursor += col + 1
    tableau.push(pile)
  }
  return {
    stock: deck.slice(cursor).map((c) => ({ ...c, faceUp: false })),
    waste: [],
    foundations: [[], [], [], []],
    tableau,
    drawCount,
    moves: 0,
    redeals: 0,
  }
}

/** Draw 1 or 3 to the waste; an empty stock recycles the waste face-down. */
export function draw(game: Game): Game {
  if (game.stock.length === 0) {
    if (game.waste.length === 0) return game
    return {
      ...game,
      stock: [...game.waste].reverse().map((c) => ({ ...c, faceUp: false })),
      waste: [],
      moves: game.moves + 1,
      redeals: game.redeals + 1,
    }
  }
  const n = Math.min(game.drawCount, game.stock.length)
  const drawn = game.stock.slice(0, n).map((c) => ({ ...c, faceUp: true }))
  return {
    ...game,
    stock: game.stock.slice(n),
    waste: [...game.waste, ...drawn],
    moves: game.moves + 1,
  }
}

export function canPlaceOnFoundation(card: Card, foundation: Card[]): boolean {
  if (foundation.length === 0) return card.rank === 1
  const top = foundation[foundation.length - 1]
  return top.suit === card.suit && card.rank === top.rank + 1
}

export function canPlaceOnTableau(card: Card, column: Card[]): boolean {
  if (column.length === 0) return card.rank === 13
  const top = column[column.length - 1]
  if (!top.faceUp) return false
  return isRed(top.suit) !== isRed(card.suit) && card.rank === top.rank - 1
}

/** Flip a column's new tail face-up after cards left it. */
function flipTail(column: Card[]): Card[] {
  if (column.length === 0) return column
  const top = column[column.length - 1]
  if (top.faceUp) return column
  return [...column.slice(0, -1), { ...top, faceUp: true }]
}

function replaceColumn(tableau: Card[][], index: number, next: Card[]): Card[][] {
  return tableau.map((col, i) => (i === index ? next : col))
}

/** The top waste card to a foundation, or null if illegal. */
export function wasteToFoundation(game: Game, foundationIndex: number): Game | null {
  const card = game.waste[game.waste.length - 1]
  if (!card || !canPlaceOnFoundation(card, game.foundations[foundationIndex])) return null
  const foundations = game.foundations.map((f, i) =>
    i === foundationIndex ? [...f, card] : f
  ) as Game['foundations']
  return { ...game, waste: game.waste.slice(0, -1), foundations, moves: game.moves + 1 }
}

/** The top waste card to a tableau column, or null if illegal. */
export function wasteToTableau(game: Game, columnIndex: number): Game | null {
  const card = game.waste[game.waste.length - 1]
  if (!card || !canPlaceOnTableau(card, game.tableau[columnIndex])) return null
  const tableau = replaceColumn(game.tableau, columnIndex, [...game.tableau[columnIndex], card])
  return { ...game, waste: game.waste.slice(0, -1), tableau, moves: game.moves + 1 }
}

/**
 * A face-up run starting at `cardIndex` from one column onto another, or null.
 * The run itself is already ordered by construction; only its head must fit
 * the destination.
 */
export function tableauToTableau(
  game: Game,
  fromColumn: number,
  cardIndex: number,
  toColumn: number
): Game | null {
  if (fromColumn === toColumn) return null
  const from = game.tableau[fromColumn]
  const moving = from.slice(cardIndex)
  if (moving.length === 0 || !moving[0].faceUp) return null
  if (!canPlaceOnTableau(moving[0], game.tableau[toColumn])) return null
  let tableau = replaceColumn(game.tableau, fromColumn, flipTail(from.slice(0, cardIndex)))
  tableau = replaceColumn(tableau, toColumn, [...game.tableau[toColumn], ...moving])
  return { ...game, tableau, moves: game.moves + 1 }
}

/** A column's top card to a foundation, or null. */
export function tableauToFoundation(
  game: Game,
  columnIndex: number,
  foundationIndex: number
): Game | null {
  const column = game.tableau[columnIndex]
  const card = column[column.length - 1]
  if (!card || !card.faceUp) return null
  if (!canPlaceOnFoundation(card, game.foundations[foundationIndex])) return null
  const foundations = game.foundations.map((f, i) =>
    i === foundationIndex ? [...f, card] : f
  ) as Game['foundations']
  const tableau = replaceColumn(game.tableau, columnIndex, flipTail(column.slice(0, -1)))
  return { ...game, foundations, tableau, moves: game.moves + 1 }
}

/** A foundation's top card back to a tableau column (digging), or null. */
export function foundationToTableau(
  game: Game,
  foundationIndex: number,
  columnIndex: number
): Game | null {
  const foundation = game.foundations[foundationIndex]
  const card = foundation[foundation.length - 1]
  if (!card || !canPlaceOnTableau(card, game.tableau[columnIndex])) return null
  const foundations = game.foundations.map((f, i) =>
    i === foundationIndex ? f.slice(0, -1) : f
  ) as Game['foundations']
  const tableau = replaceColumn(game.tableau, columnIndex, [...game.tableau[columnIndex], card])
  return { ...game, foundations, tableau, moves: game.moves + 1 }
}

/**
 * Click-to-place: the best legal home for the card at a location — a
 * foundation first (it is always progress for a top card), then tableau
 * columns left to right. Returns the moved game or null.
 */
export function autoPlace(
  game: Game,
  source: { kind: 'waste' } | { kind: 'tableau'; column: number; cardIndex: number }
): Game | null {
  if (source.kind === 'waste') {
    for (let f = 0; f < 4; f++) {
      const next = wasteToFoundation(game, f)
      if (next) return next
    }
    for (let c = 0; c < 7; c++) {
      const next = wasteToTableau(game, c)
      if (next) return next
    }
    return null
  }
  const column = game.tableau[source.column]
  const isTop = source.cardIndex === column.length - 1
  if (isTop) {
    for (let f = 0; f < 4; f++) {
      const next = tableauToFoundation(game, source.column, f)
      if (next) return next
    }
  }
  for (let c = 0; c < 7; c++) {
    const next = tableauToTableau(game, source.column, source.cardIndex, c)
    if (next) return next
  }
  return null
}

export function isWon(game: Game): boolean {
  return game.foundations.every((f) => f.length === 13)
}

/**
 * Auto-finish is offered only when it is provably just bookkeeping: nothing
 * hidden anywhere (stock, waste and every tableau card face-up).
 */
export function canAutoFinish(game: Game): boolean {
  if (isWon(game)) return false
  if (game.stock.length > 0 || game.waste.length > 0) return false
  return game.tableau.every((col) => col.every((c) => c.faceUp))
}

/** One auto-finish step: the lowest-ranked playable top card to its foundation. */
export function autoFinishStep(game: Game): Game | null {
  let best: { game: Game; rank: number } | null = null
  for (let c = 0; c < 7; c++) {
    const column = game.tableau[c]
    const card = column[column.length - 1]
    if (!card) continue
    for (let f = 0; f < 4; f++) {
      if (!canPlaceOnFoundation(card, game.foundations[f])) continue
      const next = tableauToFoundation(game, c, f)
      if (next && (best === null || card.rank < best.rank)) {
        best = { game: next, rank: card.rank }
      }
    }
  }
  return best?.game ?? null
}
