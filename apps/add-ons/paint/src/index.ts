import { lazy } from 'react'
import { Palette } from 'lucide-react'
import type { AddonManifest } from '@imbatranim/core'

export const manifest: AddonManifest = {
  id: 'paint',
  name: 'Paint',
  description: 'Draw, annotate and edit images — pencil to crop, PNG and JPEG',
  meta: ['paint', 'draw', 'image', 'editor', 'canvas', 'crop', 'bitmap', 'sketch'],
  icon: Palette,
  component: lazy(() => import('./Paint').then((m) => ({ default: m.Paint }))),
  multiInstance: true,
  // The toolbar wraps below ~640; 900×640 fits an 800×600 canvas at 100%
  // inside a 720p-with-taskbar viewport after brief 52's clamp.
  defaultSize: { width: 900, height: 640 },
  minSize: { width: 640, height: 420 },
}
