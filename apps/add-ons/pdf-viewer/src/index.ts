import { lazy } from 'react'
import { FileText } from 'lucide-react'
import type { AddonManifest } from '@imbatranim/core'

export const manifest: AddonManifest = {
  id: 'pdf-viewer',
  name: 'PDF Viewer',
  description: 'View PDF documents',
  meta: ['pdf', 'document', 'view', 'read', 'reader'],
  icon: FileText,
  component: lazy(() => import('./PdfViewer').then((m) => ({ default: m.PdfViewer }))),
  // Claims `.pdf` too, deliberately: it is the light option, offered through
  // Open with rather than as the default (brief 65).
  opens: ['pdf'],
  multiInstance: true,
  defaultSize: { width: 720, height: 640 },
  minSize: { width: 400, height: 360 },
}
