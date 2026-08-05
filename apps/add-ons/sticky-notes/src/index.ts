import { lazy } from 'react'
import { StickyNote } from 'lucide-react'
import type { AddonManifest } from '@imbatranim/core'

export const manifest: AddonManifest = {
  id: 'sticky-notes',
  name: 'Sticky Notes',
  description: 'Notes that live on the desktop, and a window to manage them',
  meta: ['post-it', 'memo', 'note', 'desktop', 'scrap'],
  icon: StickyNote,
  component: lazy(() => import('./StickyNotes').then((m) => ({ default: m.StickyNotes }))),
  /**
   * The notes themselves, painted on the desktop beneath every window (brief 74).
   *
   * Lazy for the same reason the window is: core mounts this for as long as the app
   * is enabled, whether or not the window is ever opened, so its cost belongs in a
   * chunk that loads when the desktop does rather than in the initial bundle.
   */
  desktopLayer: lazy(() => import('./DesktopNotes').then((m) => ({ default: m.DesktopNotes }))),
  multiInstance: true,
  defaultSize: { width: 360, height: 420 },
  /**
   * The manager needs more room than the old 240×200: a toolbar with New note plus
   * a search field, rows carrying a colour chip and two controls, and a status line.
   * Measured against those rather than guessed.
   */
  minSize: { width: 300, height: 260 },
}
