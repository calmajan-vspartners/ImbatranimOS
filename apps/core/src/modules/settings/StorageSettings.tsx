import { useEffect, useState } from 'react'
import { ChevronRight, RefreshCw, Trash2 } from 'lucide-react'
import { api } from '../../lib/axios'
import { Button } from '../../shared/components/ui/Button'
import { cn } from '../../lib/cn'
import { formatBytes } from '../../lib/formatBytes'

type DiskStats = {
  path: string
  totalBytes: number
  usedBytes: number
  freeBytes: number
  percent: number
}

type DirSize = {
  bytes: number
  files: number
  directories: number
  truncated: boolean
}

type Entry = { name: string; path: string; type: 'file' | 'directory' }

type Row = { name: string; path: string; size: DirSize | null }

/**
 * Settings → Storage.
 *
 * `getDiskStats()` has always known the volume was nearly full — the Tray shows
 * the percentage — but nothing could say *why*. Sizes come from the bounded
 * `/files/size` walk, so pointing this at a huge tree returns an honest floor
 * rather than hanging; a truncated row is marked with a `+` so the number is
 * never quietly wrong.
 */
export function StorageSettings() {
  const [dir, setDir] = useState('')
  const [nonce, setNonce] = useState(0)

  // State is tagged with the directory it describes, so `loading` is derived
  // and the effect never calls setState synchronously — and a slow size walk
  // for a folder the user has already left cannot overwrite the current view.
  const [data, setData] = useState<{
    dir: string
    disk: DiskStats | null
    rows: Row[]
  } | null>(null)

  const loading = data?.dir !== dir
  const rows = data?.dir === dir ? data.rows : null
  const disk = data?.disk ?? null

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [stats, listing] = await Promise.all([
        api
          .get<{ disk: DiskStats }>('/system/stats')
          .then((r) => r.data.disk)
          .catch(() => null),
        api
          .get<Entry[]>('/files', { params: { root: 'home', path: dir } })
          .then((r) => r.data)
          .catch(() => [] as Entry[]),
      ])
      if (cancelled) return

      const dirs = listing.filter((e) => e.type === 'directory')
      // Render the rows immediately, then fill each size in as it arrives — a
      // recursive walk per row is slow enough that waiting for all of them
      // would look like a hang.
      setData({
        dir,
        disk: stats,
        rows: dirs.map((d) => ({ name: d.name, path: d.path, size: null })),
      })

      for (const d of dirs) {
        const size = await api
          .get<DirSize>('/files/size', { params: { root: 'home', path: d.path } })
          .then((r) => r.data)
          .catch(() => null)
        if (cancelled) return
        setData((prev) =>
          prev && prev.dir === dir
            ? {
                ...prev,
                rows: prev.rows.map((r) => (r.path === d.path ? { ...r, size } : r)),
              }
            : prev
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [dir, nonce])

  const sorted = rows
    ? [...rows].sort((a, b) => (b.size?.bytes ?? -1) - (a.size?.bytes ?? -1))
    : null

  return (
    <div className="flex flex-col gap-3">
      {disk && (
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="font-ui text-on-surface-variant text-[11px]">{disk.path}</span>
            <span className="font-ui text-on-surface text-[12px] tabular-nums">
              {formatBytes(disk.usedBytes)} of {formatBytes(disk.totalBytes)} used ·{' '}
              {formatBytes(disk.freeBytes)} free
            </span>
          </div>
          <div className="border-outline-variant bg-surface-container-low h-2 w-full border">
            <div
              className={cn('h-full', disk.percent >= 90 ? 'bg-error' : 'bg-primary')}
              style={{ width: `${Math.min(100, disk.percent)}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="font-ui text-on-surface-variant min-w-0 flex-1 truncate text-[11px]">
          /{dir}
        </span>
        {dir && (
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-1.5"
            onClick={() => setDir(dir.split('/').slice(0, -1).join('/'))}
          >
            Up
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-5 w-5 p-0"
          aria-label="Recalculate"
          title="Recalculate"
          onClick={() => setNonce((n) => n + 1)}
        >
          <RefreshCw size={11} className={cn(loading && 'animate-spin')} />
        </Button>
      </div>

      <div className="border-outline-variant border">
        {sorted === null ? (
          <div className="text-on-surface-variant font-ui p-3 text-center text-[12px]">
            Measuring…
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-on-surface-variant font-ui p-3 text-center text-[12px]">
            No folders here
          </div>
        ) : (
          sorted.map((r, i) => (
            <button
              key={r.path}
              type="button"
              onClick={() => setDir(r.path)}
              className={cn(
                'hover:bg-surface-container-low flex w-full items-center gap-2 px-3 py-1.5 text-left',
                'focus-visible:ring-primary outline-none focus-visible:ring-2 focus-visible:ring-inset',
                i > 0 && 'border-outline-variant border-t'
              )}
            >
              {r.name === '.local' ? (
                <Trash2 size={12} strokeWidth={1.5} className="shrink-0" />
              ) : (
                <ChevronRight size={12} strokeWidth={1.5} className="shrink-0" />
              )}
              <span className="font-ui text-on-surface min-w-0 flex-1 truncate text-[12px]">
                {r.name}
              </span>
              <span className="font-ui text-on-surface-variant shrink-0 text-[11px] tabular-nums">
                {r.size === null
                  ? '…'
                  : `${formatBytes(r.size.bytes)}${r.size.truncated ? '+' : ''}`}
              </span>
            </button>
          ))
        )}
      </div>

      <p className="font-ui text-on-surface-variant text-[11px]">
        A <span className="text-on-surface font-semibold">+</span> means the walk hit its bound and
        the real total is larger. Deleted files still count until the Trash is emptied.
      </p>
    </div>
  )
}
