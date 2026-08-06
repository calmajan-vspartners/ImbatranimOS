import { lazy } from 'react'
import { Table } from 'lucide-react'
import type { AddonManifest } from '@imbatranim/core'

export const manifest: AddonManifest = {
  id: 'sheets',
  name: 'Sheets',
  description: 'Edit spreadsheets (xlsx, csv)',
  meta: ['sheets', 'spreadsheet', 'excel', 'xlsx', 'csv', 'grid', 'table', 'formula'],
  icon: Table,
  component: lazy(() => import('./Sheets').then((m) => ({ default: m.Sheets }))),
  opens: ['xlsx', 'xls', 'csv'],
  multiInstance: true,
  // 560 so it fits a 720px viewport with the taskbar. The walkthrough found the
  // bottom row clipped at short viewports; brief 52 clamps the window, and this
  // is the app's half of that — an honest floor rather than a hopeful default.
  defaultSize: { width: 900, height: 560 },
  // Below ~600 wide the toolbar and the lossy note wrap over the grid, and below
  // 380 tall the column header plus one row is all that fits.
  minSize: { width: 600, height: 380 },
}
