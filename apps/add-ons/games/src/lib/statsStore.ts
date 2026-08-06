import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Difficulty } from '../minesweeper/model'

/**
 * Win/loss records and best times (brief 98). User config in the house key
 * style, shared by both games — interrupted games are session state and die
 * with the window; only finished results persist.
 */
type GamesStats = {
  minesweeper: {
    wins: number
    losses: number
    /** Best completion time in seconds, per difficulty. */
    best: Partial<Record<Difficulty, number>>
  }
  solitaire: {
    wins: number
    losses: number
  }
  recordMinesweeper: (result: 'win' | 'loss', difficulty: Difficulty, seconds: number) => void
  recordSolitaireWin: () => void
  recordSolitaireLoss: () => void
}

export const useGamesStats = create<GamesStats>()(
  persist(
    (set) => ({
      minesweeper: { wins: 0, losses: 0, best: {} },
      solitaire: { wins: 0, losses: 0 },
      recordMinesweeper: (result, difficulty, seconds) =>
        set((s) => ({
          minesweeper: {
            wins: s.minesweeper.wins + (result === 'win' ? 1 : 0),
            losses: s.minesweeper.losses + (result === 'loss' ? 1 : 0),
            best:
              result === 'win' &&
              (s.minesweeper.best[difficulty] === undefined ||
                seconds < s.minesweeper.best[difficulty]!)
                ? { ...s.minesweeper.best, [difficulty]: seconds }
                : s.minesweeper.best,
          },
        })),
      recordSolitaireWin: () =>
        set((s) => ({ solitaire: { ...s.solitaire, wins: s.solitaire.wins + 1 } })),
      recordSolitaireLoss: () =>
        set((s) => ({ solitaire: { ...s.solitaire, losses: s.solitaire.losses + 1 } })),
    }),
    { name: 'imbatranimos:games' }
  )
)
