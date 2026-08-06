import { lazy } from 'react'
import { Code2, FileDiff } from 'lucide-react'
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

/**
 * The Diff tool (brief 99) — a second app from this package, so it shares the
 * self-hosted Monaco + worker setup and the same lazy chunk graph. A separate
 * add-on would carry its own monaco-editor dependency wholesale for a
 * component that has been sitting in this one since brief 41.
 */
export const diffManifest: AddonManifest = {
  id: 'diff',
  name: 'Diff',
  description: 'Compare two files side by side, edit and save the right one',
  meta: ['diff', 'compare', 'merge', 'changes', 'delta', 'side by side'],
  icon: FileDiff,
  component: lazy(() => import('./DiffTool').then((m) => ({ default: m.DiffTool }))),
  multiInstance: true,
  defaultSize: { width: 960, height: 620 },
  // The floor where side-by-side still shows a useful column each (~300px)
  // beside Monaco's gutters; below that inline view is the honest mode, but
  // the window should not pretend to fit two columns it cannot.
  minSize: { width: 640, height: 320 },
}
