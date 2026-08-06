import { lazy } from 'react'
import { FileArchive } from 'lucide-react'
import type { AddonManifest } from '@imbatranim/core'
import { APP_NAME } from './appName'

export const manifest: AddonManifest = {
  id: 'archive-manager',
  name: APP_NAME,
  description: 'Extract .zip / .tar.gz archives and compress a selection, inside the home folder',
  meta: ['archive', 'zip', 'tar', 'extract', 'unzip', 'compress', 'gzip', 'tgz'],
  icon: FileArchive,
  component: lazy(() => import('./ArchiveManager').then((m) => ({ default: m.ArchiveManager }))),
  // One archive job window at a time; the file-manager launches it per action.
  // Declared so double-clicking an archive opens the browser view (brief 78)
  // instead of dead-ending, which is what it did before brief 81.
  opens: ['zip', 'tar', 'gz', 'tgz', 'bz2', 'tbz2', 'tbz', 'xz', 'txz'],
  multiInstance: false,
  defaultSize: { width: 460, height: 340 },
  minSize: { width: 360, height: 240 },
}
