import { describe, expect, it } from 'vitest'
import {
  autoFinishStep,
  autoPlace,
  canAutoFinish,
  canPlaceOnFoundation,
  canPlaceOnTableau,
  draw,
  foundationToTableau,
  isWon,
  newGame,
  tableauToTableau,
  wasteToFoundation,
  type Card,
  type Game,
  type Rank,
  type Suit,
} from './model'

function card(suit: Suit, rank: Rank, faceUp = true): Card {
  return { suit, rank, faceUp, id: `${suit}${rank}` }
}

/** A hand-built position; anything not given is empty. */
function position(over: Partial<Game>): Game {
  return {
    stock: [],
    waste: [],
    foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
    drawCount: 1,
    moves: 0,
    redeals: 0,
    ...over,
  }
}

describe('deal', () => {
  it('deals 1..7 columns with only each tail face-up, 24 in stock', () => {
    const g = newGame(1, () => 0.42)
    expect(g.tableau.map((c) => c.length)).toEqual([1, 2, 3, 4, 5, 6, 7])
    for (const col of g.tableau) {
      col.forEach((c, i) => expect(c.faceUp).toBe(i === col.length - 1))
    }
    expect(g.stock).toHaveLength(24)
    expect(g.stock.every((c) => !c.faceUp)).toBe(true)
    // All 52 distinct cards are somewhere.
    const ids = new Set([...g.stock, ...g.tableau.flat()].map((c) => c.id))
    expect(ids.size).toBe(52)
  })
})

describe('draw and recycle', () => {
  it('draw-3 turns three cards; a short stock turns what is left', () => {
    let g = position({ drawCount: 3, stock: [card('S', 1, false), card('S', 2, false)] })
    g = draw(g)
    expect(g.stock).toHaveLength(0)
    expect(g.waste.map((c) => c.rank)).toEqual([1, 2])
    expect(g.waste.every((c) => c.faceUp)).toBe(true)
  })

  it('an empty stock recycles the waste face-down in reverse', () => {
    let g = position({ waste: [card('S', 1), card('S', 2), card('S', 3)] })
    g = draw(g)
    expect(g.waste).toHaveLength(0)
    expect(g.stock.map((c) => c.rank)).toEqual([3, 2, 1])
    expect(g.stock.every((c) => !c.faceUp)).toBe(true)
    expect(g.redeals).toBe(1)
  })
})

describe('placement rules', () => {
  it('foundations build ace → king in suit', () => {
    expect(canPlaceOnFoundation(card('H', 1), [])).toBe(true)
    expect(canPlaceOnFoundation(card('H', 2), [])).toBe(false)
    expect(canPlaceOnFoundation(card('H', 2), [card('H', 1)])).toBe(true)
    expect(canPlaceOnFoundation(card('S', 2), [card('H', 1)])).toBe(false)
    expect(canPlaceOnFoundation(card('H', 3), [card('H', 1)])).toBe(false)
  })

  it('tableau builds down in alternating colour; kings to empty columns', () => {
    expect(canPlaceOnTableau(card('H', 12), [card('S', 13)])).toBe(true)
    expect(canPlaceOnTableau(card('D', 12), [card('H', 13)])).toBe(false)
    expect(canPlaceOnTableau(card('H', 11), [card('S', 13)])).toBe(false)
    expect(canPlaceOnTableau(card('S', 13), [])).toBe(true)
    expect(canPlaceOnTableau(card('S', 12), [])).toBe(false)
    // A face-down top card accepts nothing.
    expect(canPlaceOnTableau(card('H', 12), [card('S', 13, false)])).toBe(false)
  })
})

describe('moves', () => {
  it('moving a run keeps its order and flips the exposed tail', () => {
    const g = position({
      tableau: [
        [card('C', 9, false), card('S', 8), card('H', 7), card('S', 6)],
        [card('D', 9)],
        [],
        [],
        [],
        [],
        [],
      ],
    })
    const next = tableauToTableau(g, 0, 1, 1)
    expect(next).not.toBeNull()
    expect(next!.tableau[1].map((c) => c.id)).toEqual(['D9', 'S8', 'H7', 'S6'])
    expect(next!.tableau[0].map((c) => c.faceUp)).toEqual([true])
  })

  it('a face-down card cannot head a move', () => {
    const g = position({
      tableau: [[card('C', 9, false), card('S', 8)], [card('D', 10)], [], [], [], [], []],
    })
    expect(tableauToTableau(g, 0, 0, 1)).toBeNull()
  })

  it('waste → foundation and foundation → tableau both work', () => {
    let g = position({
      waste: [card('H', 1)],
      tableau: [[card('S', 2)], [], [], [], [], [], []],
    })
    g = wasteToFoundation(g, 0)!
    expect(g.foundations[0].map((c) => c.id)).toEqual(['H1'])
    const dug = foundationToTableau(g, 0, 0)
    expect(dug!.tableau[0].map((c) => c.id)).toEqual(['S2', 'H1'])
  })
})

describe('autoPlace (click-to-place)', () => {
  it('prefers a foundation for a top card', () => {
    const g = position({
      foundations: [[card('H', 1)], [], [], []],
      tableau: [[card('H', 2)], [card('S', 3)], [], [], [], [], []],
    })
    const next = autoPlace(g, { kind: 'tableau', column: 0, cardIndex: 0 })
    expect(next!.foundations[0].map((c) => c.id)).toEqual(['H1', 'H2'])
  })

  it('falls back to a tableau home, and a run skips foundations entirely', () => {
    const g = position({
      tableau: [[card('S', 8), card('H', 7)], [card('H', 9)], [], [], [], [], []],
    })
    const next = autoPlace(g, { kind: 'tableau', column: 0, cardIndex: 0 })
    expect(next!.tableau[1].map((c) => c.id)).toEqual(['H9', 'S8', 'H7'])
  })

  it('returns null when the card has no home', () => {
    const g = position({
      tableau: [[card('S', 5)], [card('H', 9)], [], [], [], [], []],
    })
    expect(autoPlace(g, { kind: 'tableau', column: 0, cardIndex: 0 })).toBeNull()
  })
})

describe('auto-finish', () => {
  it('is offered only with nothing hidden', () => {
    const allUp = position({
      tableau: [[card('H', 1)], [], [], [], [], [], []],
    })
    expect(canAutoFinish(allUp)).toBe(true)
    expect(canAutoFinish({ ...allUp, stock: [card('S', 2, false)] })).toBe(false)
    expect(
      canAutoFinish(position({ tableau: [[card('H', 1, false)], [], [], [], [], [], []] }))
    ).toBe(false)
  })

  it('steps lowest-rank-first so no foundation starves', () => {
    const g = position({
      foundations: [[card('H', 1)], [card('S', 1)], [], []],
      tableau: [[card('H', 3), card('S', 2)], [card('H', 2)], [], [], [], [], []],
    })
    const step1 = autoFinishStep(g)!
    // Both twos are playable; either is rank 2 — but never H3 first.
    expect(step1.foundations.flat().filter((c) => c.rank === 3)).toHaveLength(0)
    const step2 = autoFinishStep(step1)!
    const step3 = autoFinishStep(step2)!
    expect(step3.foundations[0].map((c) => c.rank)).toEqual([1, 2, 3])
    expect(autoFinishStep(step3)).toBeNull()
  })

  it('isWon needs all four suits complete', () => {
    const full = (suit: Suit) => Array.from({ length: 13 }, (_, i) => card(suit, (i + 1) as Rank))
    const g = position({
      foundations: [full('S'), full('H'), full('D'), full('C')],
    })
    expect(isWon(g)).toBe(true)
  })
})
