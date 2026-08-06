import { useCallback, useEffect, useRef, useState } from 'react'
import { AxiosError } from 'axios'
import { AlertTriangle, Download, Loader2, RotateCcw, Upload } from 'lucide-react'
import { api } from '../../lib/axios'
import { Button, Input } from '../../shared/components/ui'
import { formatBytes } from '../../lib/formatBytes'
import { notify } from '../../shared/store/notificationStore'
import { useAuthStore } from '../auth/store/authStore'

type BackupInfo = {
  homeBytes: number
  homeBytesTruncated: boolean
  databaseBytes: number
  freeBytes: number
  excluded: string[]
  suggestedFilename: string
}

type RestoreEntry = { name: string; directory: boolean; replacesExisting: boolean }

type RestorePreview = {
  id: string
  manifest: { createdAt: string; imageVersion: string; excluded: string[] }
  entries: RestoreEntry[]
  fileCount: number
  totalBytes: number
  freeBytes: number
  fits: boolean
}

const CONFIRM_WORD = 'RESTORE'

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof AxiosError) {
    const m = err.response?.data?.message as string | string[] | undefined
    return Array.isArray(m) ? m.join(', ') : (m ?? fallback)
  }
  return fallback
}

/**
 * Settings → Backup (brief 80).
 *
 * The only backup the product used to offer was a `docker run` in the README —
 * useless to anyone on the kiosk ISO or handed a running instance, which is to
 * say useless to two of its own audiences.
 *
 * **The download is a plain browser navigation, not a fetch.** Reading the
 * archive through `fetch` to draw our own byte counter would mean holding the
 * entire home volume in the tab's heap before writing a single byte to disk —
 * the exact failure the streaming backend exists to avoid. The browser's own
 * download UI already shows progress, and it streams. What this panel adds
 * instead is the number the browser cannot know: how big the backup will be, and
 * what is deliberately left out of it.
 */
export function BackupSettings() {
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)

  const [info, setInfo] = useState<BackupInfo | null>(null)
  const [downloading, setDownloading] = useState(false)

  const [preview, setPreview] = useState<RestorePreview | null>(null)
  const [uploading, setUploading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    void api
      .get<BackupInfo>('/backup/info')
      .then((r) => {
        if (!cancelled) setInfo(r.data)
      })
      .catch(() => {
        if (!cancelled) setInfo(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const download = useCallback(() => {
    if (!info) return
    setDownloading(true)
    // Same-origin navigation so the session cookie rides along and the browser
    // streams the response straight to disk.
    const base = (import.meta.env.VITE_API_URL as string | undefined) ?? ''
    const frame = document.createElement('iframe')
    frame.style.display = 'none'
    frame.src = `${base}/backup`
    document.body.appendChild(frame)
    window.setTimeout(() => {
      frame.remove()
      setDownloading(false)
    }, 4000)
    notify({
      title: 'Backup started',
      body: 'Your browser is downloading the archive. Large volumes take a while.',
      level: 'info',
      appId: 'settings',
    })
  }, [info])

  const chooseFile = useCallback(async (file: File) => {
    setError(null)
    setPreview(null)
    setConfirmText('')
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await api.post<RestorePreview>('/backup/restore/inspect', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setPreview(res.data)
    } catch (err) {
      const message = errMessage(err, 'That file could not be read as a backup')
      setError(message)
      notify({ title: 'Cannot restore', body: message, level: 'error', appId: 'settings' })
    } finally {
      setUploading(false)
    }
  }, [])

  const applyRestore = useCallback(async () => {
    if (!preview || confirmText !== CONFIRM_WORD) return
    setApplying(true)
    setError(null)
    try {
      await api.post('/backup/restore/apply', { id: preview.id, confirm: CONFIRM_WORD })
      notify({
        title: 'Restore complete',
        body: 'Your home directory was replaced. Sign in again with the password from that backup.',
        level: 'success',
        appId: 'settings',
      })
      // The restored database carries the backup's credentials, so this session
      // is gone on the server. Drop to the lock screen rather than letting the
      // desktop 401 its way there one request at a time.
      setAuthenticated(false)
    } catch (err) {
      const message = errMessage(err, 'The restore failed')
      setError(message)
      notify({ title: 'Restore failed', body: message, level: 'error', appId: 'settings' })
      setPreview(null)
    } finally {
      setApplying(false)
      setConfirmText('')
    }
  }, [preview, confirmText, setAuthenticated])

  return (
    <div className="space-y-8">
      {/* Back up ───────────────────────────────────────────── */}
      <div>
        <p className="font-ui text-on-surface-variant mb-3 text-[11px] font-semibold tracking-widest uppercase">
          Back up
        </p>
        <p className="text-on-surface-variant mb-4 max-w-prose text-[12px]">
          Everything that makes this machine yours — your files, notes, passwords and app data — in
          one <span className="font-mono">.tar.gz</span> you can download and keep. No host shell
          required.
        </p>

        {info && (
          <dl className="border-outline-variant bg-surface-container-lowest mb-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 border p-3 text-[12px]">
            <dt className="text-on-surface-variant">Home directory</dt>
            <dd className="tabular-nums">
              {formatBytes(info.homeBytes)}
              {info.homeBytesTruncated && (
                <span className="text-on-surface-variant"> or more</span>
              )}{' '}
              <span className="text-on-surface-variant">before compression</span>
            </dd>
            <dt className="text-on-surface-variant">Database</dt>
            <dd className="tabular-nums">
              {formatBytes(info.databaseBytes)}{' '}
              <span className="text-on-surface-variant">snapshotted, not copied while open</span>
            </dd>
            <dt className="text-on-surface-variant">Left out</dt>
            <dd className="font-mono text-[11px]">{info.excluded.join(', ')}</dd>
          </dl>
        )}

        <Button variant="primary" onClick={download} disabled={!info || downloading}>
          {downloading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Download size={14} strokeWidth={1.75} />
          )}
          Download backup
        </Button>
      </div>

      {/* Restore ───────────────────────────────────────────── */}
      <div>
        <p className="font-ui text-on-surface-variant mb-3 text-[11px] font-semibold tracking-widest uppercase">
          Restore
        </p>
        <p className="text-on-surface-variant mb-4 max-w-prose text-[12px]">
          Replaces the folders the backup contains. Anything you have created since is left alone.
          You will be signed out afterwards, because the backup brings its own password with it.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept=".gz,.tgz,application/gzip,application/x-gzip"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void chooseFile(file)
          }}
        />
        <Button
          variant="default"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || applying}
        >
          {uploading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Upload size={14} strokeWidth={1.75} />
          )}
          Choose a backup file…
        </Button>

        {error && (
          <div className="bg-error-container text-on-error-container mt-4 flex items-start gap-2 p-2 text-[12px]">
            <AlertTriangle size={14} className="mt-px shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {preview && (
          <div className="border-outline-variant mt-4 border p-3">
            <p className="text-[12px] font-semibold">
              Backup from {new Date(preview.manifest.createdAt).toLocaleString()}
            </p>
            <p className="text-on-surface-variant mt-0.5 text-[11px]">
              ImbatranimOS {preview.manifest.imageVersion} · {preview.fileCount} files ·{' '}
              {formatBytes(preview.totalBytes)} once extracted
            </p>

            <p className="font-ui text-on-surface-variant mt-3 mb-1.5 text-[10px] font-semibold tracking-widest uppercase">
              These will be replaced
            </p>
            <ul className="max-h-40 overflow-auto text-[12px]">
              {preview.entries.map((entry) => (
                <li key={entry.name} className="flex items-center gap-2 py-0.5">
                  <span className="font-mono">{entry.name}</span>
                  <span className="text-on-surface-variant text-[11px]">
                    {entry.replacesExisting ? 'replaces what is there now' : 'new'}
                  </span>
                </li>
              ))}
            </ul>

            {!preview.fits && (
              <div className="bg-error-container text-on-error-container mt-3 flex items-start gap-2 p-2 text-[12px]">
                <AlertTriangle size={14} className="mt-px shrink-0" />
                <span>
                  This backup needs {formatBytes(preview.totalBytes)} but only{' '}
                  {formatBytes(preview.freeBytes)} is free. Free some space first — the restore will
                  refuse rather than fill the volume.
                </span>
              </div>
            )}

            <div className="border-outline-variant mt-3 border-t pt-3">
              <label
                htmlFor="restore-confirm"
                className="text-on-surface-variant mb-1.5 block text-[12px]"
              >
                Type <span className="text-on-surface font-mono">{CONFIRM_WORD}</span> to replace
                your home directory.
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="restore-confirm"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={CONFIRM_WORD}
                  autoComplete="off"
                  className="max-w-[180px]"
                />
                <Button
                  variant="primary"
                  onClick={() => void applyRestore()}
                  disabled={confirmText !== CONFIRM_WORD || !preview.fits || applying}
                >
                  {applying ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <RotateCcw size={14} strokeWidth={1.75} />
                  )}
                  Restore and sign out
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setPreview(null)
                    setConfirmText('')
                  }}
                  disabled={applying}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
