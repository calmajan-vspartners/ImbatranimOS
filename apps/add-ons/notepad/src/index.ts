import { lazy } from 'react'
import { FileText } from 'lucide-react'
import type { AddonManifest } from '@imbatranim/core'

export const manifest: AddonManifest = {
  id: 'notepad',
  name: 'Notepad',
  description: 'Markdown text editor',
  meta: ['editor', 'markdown', 'text', 'write'],
  icon: FileText,
  component: lazy(() => import('./Notepad').then((m) => ({ default: m.Notepad }))),
  multiInstance: true,
  defaultSize: { width: 600, height: 500 },
  minSize: { width: 400, height: 300 },
}
