import {
  Folder,
  FileText,
  File,
  FileImage,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  Presentation,
} from 'lucide-react'
import type { FsEntry } from '../types'

/**
 * How an entry looks — icon and human size.
 *
 * Extracted from `FileList` when the Icons view arrived, so a file cannot show one
 * icon in Details and a different one in Icons. Purely cosmetic: `lib/fileKind.ts`
 * classifies for the *preview pane*, which is a different question with a different
 * extension list, and `lib/openWith.ts` decides which app opens a file. Three lists,
 * three jobs; deliberately not merged.
 */

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function getFileIcon(entry: FsEntry, size = 16) {
  const props = { size, strokeWidth: 1.5 } as const
  if (entry.type === 'directory') return <Folder {...props} className="text-primary-container" />
  const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
  if (['md', 'txt', 'log'].includes(ext))
    return <FileText {...props} className="text-on-surface-variant" />
  if (ext === 'pdf') return <FileText {...props} className="text-error" />
  if (['xlsx', 'xls'].includes(ext)) return <FileSpreadsheet {...props} className="text-primary" />
  if (ext === 'docx') return <FileText {...props} className="text-secondary" />
  if (['pptx', 'ppt'].includes(ext)) return <Presentation {...props} className="text-tertiary" />
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext))
    return <FileImage {...props} className="text-secondary" />
  if (['zip', 'tar', 'gz', 'bz2', '7z'].includes(ext))
    return <FileArchive {...props} className="text-tertiary" />
  if (['ts', 'tsx', 'js', 'jsx', 'json', 'py', 'sh', 'css', 'html'].includes(ext))
    return <FileCode {...props} className="text-on-surface-variant" />
  return <File {...props} className="text-on-surface-variant" />
}
