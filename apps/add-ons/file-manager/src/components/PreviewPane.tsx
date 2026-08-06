import { useState } from 'react'
import { File, Folder, FileImage, FileAudio, FileVideo, FileText, Files } from 'lucide-react'
import { cn, useSystem } from '@imbatranim/ui'
import dayjs from 'dayjs'
import type { FsEntry } from '../types'
import { usePreviewContentQuery } from '../queries/filesQueries'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import { getPreviewKind } from '../lib/fileKind'

const TEXT_SIZE_CAP_BYTES = 1024 * 1024 // ~1 MiB
const SELECTION_DEBOUNCE_MS = 150

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function kindIcon(entry: FsEntry) {
  if (entry.type === 'directory') return <Folder size={40} strokeWidth={1} />
  switch (getPreviewKind(entry.name)) {
    case 'image':
      return <FileImage size={40} strokeWidth={1} />
    case 'audio':
      return <FileAudio size={40} strokeWidth={1} />
    case 'video':
      return <FileVideo size={40} strokeWidth={1} />
    case 'text':
      return <FileText size={40} strokeWidth={1} />
    default:
      return <File size={40} strokeWidth={1} />
  }
}

function MetadataCard({ entry, note }: { entry: FsEntry; note?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-10 text-center">
      <div className="text-on-surface-variant">{kindIcon(entry)}</div>
      <div className="font-content text-on-surface w-full text-[13px] font-medium break-all">
        {entry.name}
      </div>
      <div className="font-ui text-on-surface-variant flex flex-col gap-0.5 text-[11px]">
        <span>{entry.type === 'directory' ? 'Folder' : formatSize(entry.size)}</span>
        <span>Modified {dayjs(entry.modifiedAt).format('MMM D, YYYY h:mm A')}</span>
      </div>
      {note && <div className="font-ui text-on-surface-variant text-[11px] italic">{note}</div>}
    </div>
  )
}

function EmptyState({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="text-on-surface-variant flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
      {icon}
      <span className="font-ui text-[12px]">{label}</span>
    </div>
  )
}

type SinglePreviewProps = {
  root: string
  entry: FsEntry
}

// Keyed by entry.path at the call site below, so a fresh selection always
// mounts a fresh instance — mediaFailed resets naturally without an effect.
function SinglePreview({ root, entry }: SinglePreviewProps) {
  const { fs } = useSystem()
  const [mediaFailed, setMediaFailed] = useState(false)

  if (entry.type === 'directory') {
    return <MetadataCard entry={entry} />
  }

  const kind = getPreviewKind(entry.name)
  const src = fs.downloadUrl(root, entry.path)

  if (mediaFailed && (kind === 'image' || kind === 'audio' || kind === 'video')) {
    // Native element failed to load — fall back to the metadata card rather
    // than a broken-image glyph or a dead player. Never an error in the pane.
    return <MetadataCard entry={entry} />
  }

  if (kind === 'image') {
    return (
      <div className="flex h-full items-center justify-center overflow-auto p-2">
        <img
          key={entry.path}
          src={src}
          alt={entry.name}
          className="max-h-full max-w-full object-contain"
          onError={() => setMediaFailed(true)}
        />
      </div>
    )
  }

  if (kind === 'audio') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4">
        <FileAudio size={40} strokeWidth={1} className="text-on-surface-variant" />
        <span className="font-content text-on-surface w-full text-center text-[13px] font-medium break-all">
          {entry.name}
        </span>
        <audio
          key={entry.path}
          controls
          src={src}
          className="w-full"
          onError={() => setMediaFailed(true)}
        />
      </div>
    )
  }

  if (kind === 'video') {
    return (
      <div className="flex h-full items-center justify-center overflow-auto p-2">
        <video
          key={entry.path}
          controls
          src={src}
          className="max-h-full max-w-full"
          onError={() => setMediaFailed(true)}
        />
      </div>
    )
  }

  if (kind === 'text') {
    if (entry.size > TEXT_SIZE_CAP_BYTES) {
      return <MetadataCard entry={entry} note="Too large to preview" />
    }
    return <TextPreview root={root} entry={entry} />
  }

  // pdf/office/anything unrecognized — expand later; metadata card for now.
  return <MetadataCard entry={entry} />
}

function TextPreview({ root, entry }: SinglePreviewProps) {
  const query = usePreviewContentQuery(root, entry.path, true)

  if (query.isLoading) {
    return <EmptyState icon={<FileText size={32} strokeWidth={1} />} label="Loading preview…" />
  }
  if (query.isError || query.data === undefined) {
    // Never show an error card — fall back to metadata instead.
    return <MetadataCard entry={entry} />
  }
  return (
    <pre className="text-on-surface h-full overflow-auto p-2 font-mono text-[11px] leading-snug break-words whitespace-pre-wrap">
      {query.data.content}
    </pre>
  )
}

export type PreviewPaneProps = {
  root: string
  selectedEntries: FsEntry[]
  className?: string
}

export function PreviewPane({ root, selectedEntries, className }: PreviewPaneProps) {
  const debounced = useDebouncedValue(selectedEntries, SELECTION_DEBOUNCE_MS)

  return (
    <div className={cn('bg-surface-container-lowest h-full min-h-0 overflow-hidden', className)}>
      {debounced.length === 0 && (
        <EmptyState icon={<File size={32} strokeWidth={1} />} label="Select a file to preview" />
      )}
      {debounced.length === 1 && (
        <SinglePreview key={debounced[0].path} root={root} entry={debounced[0]} />
      )}
      {debounced.length > 1 && (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-10 text-center">
          <Files size={40} strokeWidth={1} className="text-on-surface-variant" />
          <span className="font-ui text-on-surface-variant text-[12px]">
            {debounced.length} items selected
          </span>
        </div>
      )}
    </div>
  )
}
