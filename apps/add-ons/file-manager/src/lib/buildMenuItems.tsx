import {
  FileDiff,
  FolderPlus,
  Palette,
  Clipboard,
  Upload,
  Trash2,
  RefreshCw,
  Pencil,
  Copy,
  Scissors,
  Download,
  AppWindow,
  FolderOpen,
  FileSpreadsheet,
  FileText,
  FileArchive,
  Package,
  FilePlus,
  Info,
} from 'lucide-react'
import type { ContextMenuItem } from '../components/ContextMenu'
import type { FsEntry } from '../types'
import { resolveOpenApp, openAppLabel, type Associations } from './openWith'
import type { NewFileKind } from './newFileTemplates'

export type BuildMenuItemsCtx = {
  /** The right-clicked entry, or null for the empty-background menu. */
  entry: FsEntry | null
  root: string
  /** The handle's association registry — menus resolve labels against it. */
  assoc: Associations
  /** Whether the clipboard holds something (gates the Paste item). */
  hasClipboard: boolean
  onOpen: (entry: FsEntry) => void
  onDownload: (entry: FsEntry) => void
  onRename: (entry: FsEntry) => void
  onCopy: (entry: FsEntry) => void
  onCut: (entry: FsEntry) => void
  onDelete: (entry: FsEntry) => void
  onNewFile: () => void
  onNewFolder: () => void
  onProperties: (entry: FsEntry) => void
  onNewOfficeFile: (kind: NewFileKind) => void
  onUpload: () => void
  onPaste: () => void
  onRefresh: () => void
  /** Show the "Open with" chooser for this entry (brief 81). */
  onOpenWith: (entry: FsEntry) => void
  /** Extract an archive file (Archive Manager). */
  onExtract: (entry: FsEntry) => void
  /** Compress the current selection (or this entry) to a .zip (Archive Manager). */
  onCompress: (entry: FsEntry) => void
  /**
   * Compare the two selected files in the Diff tool (brief 99). Non-null only
   * when exactly two files are selected and the clicked entry is one of them —
   * the builder shows the item exactly when the action can mean something.
   */
  onCompare: (() => void) | null
  /** Open a bitmap in Paint (brief 95) — an Edit verb beside the viewer's Open. */
  onEditInPaint: (entry: FsEntry) => void
}

/** Archive files the "Extract here" item is offered for. */
const ARCHIVE_RE = /\.(zip|tar\.gz|tgz|tar)$/i

/** Bitmaps Paint can edit (brief 95) — the viewer keeps the double-click. */
const PAINTABLE_RE = /\.(png|jpe?g|gif|webp|bmp)$/i

/**
 * Pure builder for the right-click context menu descriptor tree. Same two-mode
 * shape as before: an entry-scoped menu (Open, optional Download, Rename, Copy,
 * Cut, Delete) versus the empty-background menu (New Folder / Spreadsheet /
 * Document, Upload, Paste, Refresh).
 */
export function buildMenuItems(ctx: BuildMenuItemsCtx): ContextMenuItem[] {
  const {
    entry,
    root,
    hasClipboard,
    onOpen,
    onDownload,
    onRename,
    onCopy,
    onCut,
    onDelete,
    onNewFile,
    onNewFolder,
    onProperties,
    onNewOfficeFile,
    onUpload,
    onPaste,
    onRefresh,
    onOpenWith,
    onExtract,
    onCompare,
    onEditInPaint,
    onCompress,
  } = ctx

  if (!entry) {
    return [
      {
        label: 'New File…',
        icon: <FilePlus size={13} />,
        onSelect: onNewFile,
      },
      {
        label: 'New Folder',
        icon: <FolderPlus size={13} />,
        onSelect: onNewFolder,
      },
      {
        label: 'New Spreadsheet',
        icon: <FileSpreadsheet size={13} />,
        onSelect: () => onNewOfficeFile('spreadsheet'),
      },
      {
        label: 'New Document',
        icon: <FileText size={13} />,
        onSelect: () => onNewOfficeFile('document'),
      },
      {
        label: 'Upload…',
        icon: <Upload size={13} />,
        onSelect: onUpload,
      },
      {
        label: 'Paste',
        icon: <Clipboard size={13} />,
        disabled: !hasClipboard,
        onSelect: onPaste,
      },
      { type: 'separator' },
      {
        label: 'Refresh',
        icon: <RefreshCw size={13} />,
        onSelect: onRefresh,
      },
    ]
  }

  return [
    {
      label:
        entry.type === 'directory'
          ? 'Open'
          : openAppLabel(ctx.assoc, resolveOpenApp(ctx.assoc, root, entry.name)),
      icon: <FolderOpen size={13} />,
      onSelect: () => onOpen(entry),
      // Never disabled for a file any more (brief 81): resolution always ends
      // somewhere, and when it genuinely cannot, `onOpen` shows the chooser
      // rather than nothing happening.
    },
    ...(entry.type === 'file'
      ? [
          {
            label: 'Open with…',
            icon: <AppWindow size={13} />,
            onSelect: () => onOpenWith(entry),
          } as ContextMenuItem,
        ]
      : []),
    ...(entry.type === 'file'
      ? [
          {
            label: 'Download',
            icon: <Download size={13} />,
            onSelect: () => onDownload(entry),
          } as ContextMenuItem,
        ]
      : []),
    ...(entry.type === 'file' && PAINTABLE_RE.test(entry.name)
      ? [
          {
            label: 'Edit in Paint',
            icon: <Palette size={13} />,
            onSelect: () => onEditInPaint(entry),
          } as ContextMenuItem,
        ]
      : []),
    ...(entry.type === 'file' && onCompare
      ? [
          {
            label: 'Compare',
            icon: <FileDiff size={13} />,
            onSelect: onCompare,
          } as ContextMenuItem,
        ]
      : []),
    ...(entry.type === 'file' && ARCHIVE_RE.test(entry.name)
      ? [
          {
            label: 'Extract here',
            icon: <FileArchive size={13} />,
            onSelect: () => onExtract(entry),
          } as ContextMenuItem,
        ]
      : []),
    {
      label: 'Compress to .zip',
      icon: <Package size={13} />,
      onSelect: () => onCompress(entry),
    },
    { type: 'separator' },
    {
      label: 'Rename',
      icon: <Pencil size={13} />,
      onSelect: () => onRename(entry),
    },
    {
      label: 'Copy',
      icon: <Copy size={13} />,
      onSelect: () => onCopy(entry),
    },
    {
      label: 'Cut',
      icon: <Scissors size={13} />,
      onSelect: () => onCut(entry),
    },
    { type: 'separator' },
    {
      label: 'Properties',
      icon: <Info size={13} />,
      onSelect: () => onProperties(entry),
    },
    { type: 'separator' },
    {
      label: 'Delete',
      icon: <Trash2 size={13} />,
      danger: true,
      onSelect: () => onDelete(entry),
    },
  ]
}
