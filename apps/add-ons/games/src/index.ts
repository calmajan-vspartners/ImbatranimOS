import { lazy } from 'react'
import { Bomb, Spade } from 'lucide-react'
import type { AddonManifest } from '@imbatranim/core'

/**
 * The identity-affirming tier (brief 98): the two games a Win7-shaped desktop
 * cannot not have. One package, two manifests — they share the stats store
 * and the registry takes AppConfig entries either way; a second package per
 * game would be scaffolding for its own sake.
 *
 * Both are pure client (no backend, no deps); each app is its own lazy chunk.
 */
export const minesweeperManifest: AddonManifest = {
  id: 'minesweeper',
  name: 'Minesweeper',
  description: 'Flags, chords and best times — the classic',
  meta: ['game', 'mines', 'flags', 'classic', 'puzzle'],
  icon: Bomb,
  component: lazy(() =>
    import('./minesweeper/Minesweeper').then((m) => ({ default: m.Minesweeper }))
  ),
  multiInstance: false,
  // Beginner (9×24px cells + chrome) fits without scrolling; bigger boards
  // scroll inside the window until the user grows it.
  defaultSize: { width: 340, height: 440 },
  minSize: { width: 300, height: 400 },
}

export const solitaireManifest: AddonManifest = {
  id: 'solitaire',
  name: 'Solitaire',
  description: 'Klondike — draw 1 or 3, unlimited undo, auto-finish',
  meta: ['game', 'cards', 'klondike', 'classic', 'patience'],
  icon: Spade,
  component: lazy(() => import('./solitaire/Solitaire').then((m) => ({ default: m.Solitaire }))),
  multiInstance: false,
  // Seven 48px columns + gaps + padding measure ~410; 560 leaves air for the
  // stacks to grow. Below 460×460 the tableau clips mid-card.
  defaultSize: { width: 560, height: 560 },
  minSize: { width: 460, height: 460 },
}
