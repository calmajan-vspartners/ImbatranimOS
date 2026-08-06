import { lazy } from 'react'
import { Hash } from 'lucide-react'
import type { AddonManifest } from '@imbatranim/core'

export const manifest: AddonManifest = {
  id: 'markdown-editor',
  name: 'Markdown Editor',
  description: 'Edit markdown with a live preview',
  meta: ['markdown', 'md', 'editor', 'preview', 'write', 'docs'],
  icon: Hash,
  component: lazy(() => import('./MarkdownEditor').then((m) => ({ default: m.MarkdownEditor }))),
  opens: ['md', 'markdown'],
  multiInstance: true,
  defaultSize: { width: 860, height: 620 },
  minSize: { width: 480, height: 360 },
}
