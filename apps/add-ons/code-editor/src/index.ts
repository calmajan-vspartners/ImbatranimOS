import { lazy } from 'react'
import { Code2 } from 'lucide-react'
import type { AddonManifest } from '@imbatranim/core'

export const manifest: AddonManifest = {
  id: 'code-editor',
  name: 'Code Editor',
  description: 'Edit source files with syntax highlighting, tabs, and find/replace',
  meta: ['code', 'editor', 'monaco', 'source', 'syntax', 'ide', 'develop', 'programming'],
  icon: Code2,
  // Lazy so Monaco (heavy) lands in this chunk, never the eager desktop bundle.
  component: lazy(() => import('./CodeEditor').then((m) => ({ default: m.CodeEditor }))),
  multiInstance: true,
  // 620 so the window fits a 720px-tall viewport with the taskbar still on
  // screen; 680 did not, and the clamp in brief 52 had to shrink it on open.
  defaultSize: { width: 960, height: 620 },
  // Honest floor: below ~560 the menu bar wraps and Monaco's own find widget
  // has nowhere to sit.
  minSize: { width: 560, height: 320 },
}
