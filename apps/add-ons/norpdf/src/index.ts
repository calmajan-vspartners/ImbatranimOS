import { lazy } from 'react'
import { FilePen } from 'lucide-react'
import type { AddonManifest } from '@imbatranim/core'

export const manifest: AddonManifest = {
  id: 'norpdf',
  name: 'norPDF',
  description: 'Read, search and navigate PDF documents',
  meta: ['pdf', 'document', 'read', 'reader', 'view', 'search', 'annotate'],
  icon: FilePen,
  component: lazy(() => import('./NorPdf').then((m) => ({ default: m.NorPdf }))),
  multiInstance: true,
  // 560 tall so it fits a 720px viewport with the taskbar; 720 could not, and
  // brief 52's clamp had to shrink it on every open.
  defaultSize: { width: 1040, height: 560 },
  // Below ~680 wide the top bar wraps over the page once the side panel is open,
  // and the panel can always be closed to reclaim the width.
  minSize: { width: 680, height: 420 },
}
