import { lazy } from 'react'
import { Presentation } from 'lucide-react'
import type { AddonManifest } from '@imbatranim/core'

export const manifest: AddonManifest = {
  id: 'slides',
  name: 'Slides',
  description: 'View PowerPoint presentations, with notes and a presenter mode',
  meta: ['slides', 'powerpoint', 'pptx', 'presentation', 'deck', 'view', 'present', 'notes'],
  icon: Presentation,
  component: lazy(() => import('./Slides').then((m) => ({ default: m.Slides }))),
  multiInstance: true,
  // 560 tall so it fits a 720px viewport with the taskbar; wider by default now
  // that a thumbnail rail takes 152px of it.
  defaultSize: { width: 960, height: 560 },
  // Below ~620 wide the toolbar wraps once the rail is showing, and the rail can
  // always be closed to reclaim it.
  minSize: { width: 620, height: 380 },
}
