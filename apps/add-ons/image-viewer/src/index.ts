import { lazy } from 'react'
import { Image } from 'lucide-react'
import type { AddonManifest } from '@imbatranim/core'

export const manifest: AddonManifest = {
  id: 'image-viewer',
  name: 'Image Viewer',
  description: 'View images with zoom, rotate, and folder navigation',
  meta: ['image', 'photo', 'picture', 'view', 'zoom', 'rotate', 'png', 'jpg', 'gif', 'svg'],
  icon: Image,
  component: lazy(() => import('./ImageViewer').then((m) => ({ default: m.ImageViewer }))),
  // Multi-instance: viewing several images side by side is a normal workflow.
  opens: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'],
  multiInstance: true,
  defaultSize: { width: 640, height: 560 },
  minSize: { width: 320, height: 260 },
}
