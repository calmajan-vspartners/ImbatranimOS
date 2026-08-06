import { useEffect, useState } from 'react'
import { Dialog, useSystem } from '@imbatranim/ui'
import type { FsEntry } from '../types'

type DirSize = {
  bytes: number
  files: number
  directories: number
  truncated: boolean
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

function formatWhen(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-outline-variant flex items-baseline gap-3 border-b px-3 py-1.5 last:border-b-0">
      <span className="font-ui text-on-surface-variant w-28 shrink-0 text-[11px] font-semibold tracking-wider uppercase">
        {label}
      </span>
      <span className="font-ui text-on-surface min-w-0 flex-1 text-[12px] break-all">
        {children}
      </span>
    </div>
  )
}

/**
 * File / folder properties.
 *
 * Folder size comes from the bounded `/files/size` walk (brief 83) and is
 * fetched on open rather than with the listing — a recursive walk is slow
 * enough that doing it eagerly would make every right-click hesitate. When the
 * walk hits its bound the number is a floor, and that is shown rather than
 * quietly reported as exact.
 */
export function PropertiesDialog({
  entry,
  root,
  open,
  onOpenChange,
}: {
  entry: FsEntry | null
  root: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { http } = useSystem()
  const isDir = entry?.type === 'directory'
  const path = entry?.path

  // Tagged with the path it describes, so `loading` is derived rather than set
  // synchronously in the effect, and a slow walk for a folder the user has
  // already closed cannot land on the next one they open.
  const [measured, setMeasured] = useState<{
    path: string
    size: DirSize | null
  } | null>(null)
  const forThis = measured && measured.path === path ? measured : null
  const size = forThis?.size ?? null
  const sizeError = forThis !== null && forThis.size === null
  const measuring = isDir && measured?.path !== path

  useEffect(() => {
    if (!open || !isDir || !path) return
    let cancelled = false
    http
      .get<DirSize>('/files/size', { params: { root, path } })
      .then((r) => {
        if (!cancelled) setMeasured({ path, size: r.data })
      })
      .catch(() => {
        if (!cancelled) setMeasured({ path, size: null })
      })
    return () => {
      cancelled = true
    }
  }, [open, isDir, path, root, http])

  if (!entry) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Properties">
      <div className="w-[420px]">
        <Row label="Name">{entry.name}</Row>
        <Row label="Where">/{entry.path.split('/').slice(0, -1).join('/')}</Row>
        <Row label="Type">
          {isDir ? 'Folder' : 'File'}
          {entry.isSymlink ? ' (symlink)' : ''}
        </Row>
        <Row label="Size">
          {isDir ? (
            measuring ? (
              'Calculating…'
            ) : sizeError || size === null ? (
              'Could not measure'
            ) : (
              <>
                {formatBytes(size.bytes)}
                {size.truncated ? '+' : ''} · {size.files} file
                {size.files === 1 ? '' : 's'} in {size.directories} folder
                {size.directories === 1 ? '' : 's'}
                {size.truncated && (
                  <span className="text-on-surface-variant block text-[11px]">
                    The walk hit its bound — the real total is larger.
                  </span>
                )}
              </>
            )
          ) : (
            `${formatBytes(entry.size)} (${entry.size.toLocaleString()} bytes)`
          )}
        </Row>
        <Row label="Modified">{formatWhen(entry.modifiedAt)}</Row>
        <Row label="Created">{formatWhen(entry.createdAt)}</Row>
        <Row label="Permissions">{entry.mode ?? '—'}</Row>
      </div>
    </Dialog>
  )
}
