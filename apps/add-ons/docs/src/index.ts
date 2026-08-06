import { lazy } from 'react'
import { FileText } from 'lucide-react'
import type { AddonManifest } from '@imbatranim/core'

export const manifest: AddonManifest = {
  id: 'docs',
  name: 'Docs',
  description: 'Edit documents (docx)',
  meta: ['docs', 'document', 'word', 'docx', 'text', 'editor', 'write'],
  icon: FileText,
  component: lazy(() => import('./Docs').then((m) => ({ default: m.Docs }))),
  opens: ['docx'],
  multiInstance: true,
  defaultSize: { width: 860, height: 680 },
  minSize: { width: 480, height: 380 },
}
