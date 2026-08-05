import { lazy } from 'react'
import { Scissors } from 'lucide-react'
import type { AddonManifest } from '@imbatranim/core'
import { APP_NAME } from './appName'

export const manifest: AddonManifest = {
  id: 'snipping-tool',
  name: APP_NAME,
  description: 'Capture, annotate, and save a screenshot of the desktop',
  meta: ['screenshot', 'capture', 'snip', 'grab', 'annotate', 'redact', 'pixelate'],
  icon: Scissors,
  component: lazy(() => import('./SnippingTool').then((m) => ({ default: m.SnippingTool }))),
  // Single-instance: only one capture session at a time.
  multiInstance: false,
  // The window now opens to the capture launcher and stays visible until a mode is armed,
  // so its size is real UI rather than a placeholder for a record that was never drawn.
  defaultSize: { width: 380, height: 320 },
  minSize: { width: 300, height: 260 },
}
