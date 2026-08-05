import { lazy } from 'react'
import { Calculator as CalculatorIcon } from 'lucide-react'
import type { AddonManifest } from '@imbatranim/core'

export const manifest: AddonManifest = {
  id: 'calculator',
  name: 'Calculator',
  description: 'Arithmetic, a scientific mode, and a programmer mode with bases + bitwise ops',
  meta: [
    'math',
    'arithmetic',
    'scientific',
    'trig',
    'sin',
    'cos',
    'log',
    'hex',
    'binary',
    'octal',
    'bitwise',
    'programmer',
  ],
  icon: CalculatorIcon,
  component: lazy(() => import('./Calculator').then((m) => ({ default: m.Calculator }))),
  // Single-instance: one calculator window at a time.
  multiInstance: false,
  /**
   * Measured, not guessed (brief 70). Scientific is the tallest mode: 276px of keypad + a 27px
   * memory/tape row + a 36px display floor = 339px of content, plus ~29px of tabs and ~32px of
   * window chrome — 400px before the display has anything to show. `minSize` is that plus a
   * usable display; `defaultSize` opens Scientific comfortably rather than exactly.
   *
   * Width: five function-key columns at the 11px label size need ~300px once padding and gaps
   * are counted.
   */
  defaultSize: { width: 340, height: 560 },
  minSize: { width: 300, height: 430 },
}
