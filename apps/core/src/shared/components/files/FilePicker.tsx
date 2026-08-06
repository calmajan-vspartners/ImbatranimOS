import { useEffect, useMemo, useState } from 'react'
import { ArrowUp, File as FileIcon, Folder, HardDrive, History } from 'lucide-react'
import { api } from '../../../lib/axios'
import { useRecentFilesQuery } from '../../../lib/recentFiles'
import { Button } from '../ui/Button'
import { ScrollArea } from '../ui/ScrollArea'
import { useConfirm } from '../ui/ConfirmDialog'
import { cn } from '../../../lib/cn'

export type PickerEntry = {
  name: string
  path: string
  type: 'file' | 'directory'
  size: number
  modifiedAt: string
}

const ROOTS = [
  { id: 'home', label: 'Home' },
  { id: 'notes', label: 'Notes' },
]

/**
 * Browse the container's own filesystem and choose a file.
 *
 * Deliberately NOT `<input type="file">`: that reads the *host* machine, and
 * "the computer is the container" — an Open dialog that browses the user's
 * laptop instead of the OS's home directory would be actively wrong here.
 *
 * Everything it renders comes from the authed `/files` endpoint, so it cannot
 * show or reach anything outside the FS jail.
 */
export function FilePicker({
  extensions,
  onPick,
  mode = 'open',
  suggestedName,
}: {
  /** Preferred extensions, lowercase and without the dot. A hint, not a jail. */
  extensions?: string[]
  onPick: (choice: { root: string; path: string }) => void
  /**
   * `directory` picks the folder currently browsed rather than a file — files
   * still render (so the user can see what is in there) but are inert.
   */
  mode?: 'open' | 'save' | 'directory'
  suggestedName?: string
}) {
  const [root, setRoot] = useState('home')
  const [dir, setDir] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [name, setName] = useState(suggestedName ?? '')
  // Recent tab (brief 94) — open mode only: picking a recent in save mode
  // would be a disguised overwrite, and in directory mode it is meaningless.
  const [showRecent, setShowRecent] = useState(false)
  const { data: recentFiles } = useRecentFilesQuery()
  const recent = useMemo(() => {
    const all = recentFiles ?? []
    if (!extensions || extensions.length === 0 || showAll) return all
    return all.filter((f) => extensions.includes(f.path.split('.').pop()?.toLowerCase() ?? ''))
  }, [recentFiles, extensions, showAll])
  // Save-mode overwrite confirmation (T1-3).
  const { confirm, confirmDialog } = useConfirm()

  // One piece of state tagged with the location it belongs to, rather than
  // separate entries/loading/error flags. `loading` is then derived, so the
  // effect never calls setState synchronously, and a slow response for a
  // folder the user has already navigated away from cannot overwrite the
  // current listing.
  const location = `${root}::${dir}`
  const [loaded, setLoaded] = useState<{
    location: string
    entries: PickerEntry[]
    error: string | null
  } | null>(null)
  const loading = loaded?.location !== location
  const entries = loaded?.location === location ? loaded.entries : []
  const error = loaded?.location === location ? loaded.error : null

  useEffect(() => {
    let cancelled = false
    api
      .get<PickerEntry[]>('/files', { params: { root, path: dir } })
      .then((res) => {
        if (!cancelled) setLoaded({ location, entries: res.data, error: null })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ location, entries: [], error: 'Could not read that folder.' })
      })
    return () => {
      cancelled = true
    }
  }, [location, root, dir])

  const visible = useMemo(() => {
    const filtered =
      !extensions || extensions.length === 0 || showAll || mode === 'directory'
        ? entries
        : entries.filter(
            (e) =>
              e.type === 'directory' ||
              extensions.includes(e.name.split('.').pop()?.toLowerCase() ?? '')
          )
    return [...filtered].sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1
    )
  }, [entries, extensions, showAll, mode])

  const goUp = () => setDir((d) => d.split('/').slice(0, -1).join('/'))

  // Save mode: guard an overwrite. Without this, saving over an existing file
  // (and the click-to-fill that pre-populates an existing name) silently clobbered it.
  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) return
    const clash = entries.some((e) => e.type === 'file' && e.name === trimmed)
    if (clash) {
      const ok = await confirm({
        title: 'Replace file?',
        message: (
          <>
            A file named <strong>{trimmed}</strong> already exists in this folder. Replace it?
          </>
        ),
        confirmLabel: 'Replace',
        destructive: true,
      })
      if (!ok) return
    }
    onPick({ root, path: dir ? `${dir}/${trimmed}` : trimmed })
  }

  return (
    <div className="flex h-[340px] w-[520px] flex-col">
      <div className="border-outline-variant bg-surface-container-low flex flex-none items-center gap-1 border-b px-2 py-1">
        {ROOTS.map((r) => (
          <Button
            key={r.id}
            size="sm"
            variant={r.id === root && !showRecent ? 'primary' : 'ghost'}
            className="h-5 gap-1 px-1.5"
            onClick={() => {
              setShowRecent(false)
              setRoot(r.id)
              setDir('')
            }}
          >
            <HardDrive size={11} />
            {r.label}
          </Button>
        ))}
        {mode === 'open' && (
          <Button
            size="sm"
            variant={showRecent ? 'primary' : 'ghost'}
            className="h-5 gap-1 px-1.5"
            onClick={() => setShowRecent(true)}
          >
            <History size={11} />
            Recent
          </Button>
        )}
        <div className="w-px" />
        <Button
          size="sm"
          variant="ghost"
          className="h-5 w-5 p-0"
          aria-label="Up one folder"
          title="Up one folder"
          disabled={!dir}
          onClick={goUp}
        >
          <ArrowUp size={11} />
        </Button>
        <span className="font-ui text-on-surface-variant min-w-0 truncate text-[11px]">/{dir}</span>
      </div>

      <div className="min-h-0 flex-1">
        <ScrollArea className="h-full w-full">
          {showRecent && mode === 'open' ? (
            recent.length === 0 ? (
              <div className="text-on-surface-variant flex flex-col items-center justify-center gap-2 py-12">
                <History size={32} strokeWidth={1} />
                <span className="font-ui text-[12px]">Nothing opened recently</span>
              </div>
            ) : (
              recent.map((f) => (
                <button
                  key={`${f.root}:${f.path}`}
                  type="button"
                  className={cn(
                    'border-outline-variant flex w-full items-center gap-2 border-b px-2 py-1 text-left',
                    'focus-visible:ring-primary outline-none focus-visible:ring-2 focus-visible:ring-inset',
                    'hover:bg-surface-container-low'
                  )}
                  onClick={() => onPick({ root: f.root, path: f.path })}
                >
                  <FileIcon size={12} strokeWidth={1.5} className="shrink-0" />
                  <span className="font-ui text-on-surface min-w-0 flex-1 truncate text-[12px]">
                    {f.path.split('/').pop() ?? f.path}
                  </span>
                  <span className="font-ui text-on-surface-variant min-w-0 shrink truncate text-[10px]">
                    {ROOTS.find((r) => r.id === f.root)?.label ?? f.root}/{f.path}
                  </span>
                </button>
              ))
            )
          ) : loading ? (
            <div className="text-on-surface-variant font-ui p-4 text-center text-[12px]">
              Loading…
            </div>
          ) : error ? (
            <div className="text-error font-ui p-4 text-center text-[12px]">{error}</div>
          ) : visible.length === 0 ? (
            <div className="text-on-surface-variant flex flex-col items-center justify-center gap-2 py-12">
              <Folder size={32} strokeWidth={1} />
              <span className="font-ui text-[12px]">Nothing here</span>
            </div>
          ) : (
            visible.map((e) => (
              <button
                key={e.path}
                type="button"
                // In directory mode a file is context, not a target: showing it
                // greyed out is more honest than hiding it, since "is my file
                // already in here?" is exactly what the user is checking.
                disabled={mode === 'directory' && e.type === 'file'}
                className={cn(
                  'border-outline-variant flex w-full items-center gap-2 border-b px-2 py-1 text-left',
                  'focus-visible:ring-primary outline-none focus-visible:ring-2 focus-visible:ring-inset',
                  mode === 'directory' && e.type === 'file'
                    ? 'text-on-surface-variant/50 cursor-default'
                    : 'hover:bg-surface-container-low'
                )}
                onClick={() => {
                  if (e.type === 'directory') setDir(e.path)
                  else if (mode === 'open') onPick({ root, path: e.path })
                  else if (mode === 'save') setName(e.name)
                }}
              >
                {e.type === 'directory' ? (
                  <Folder size={12} strokeWidth={1.5} className="shrink-0" />
                ) : (
                  <FileIcon size={12} strokeWidth={1.5} className="shrink-0" />
                )}
                <span className="font-ui text-on-surface min-w-0 flex-1 truncate text-[12px]">
                  {e.name}
                </span>
              </button>
            ))
          )}
        </ScrollArea>
      </div>

      <div className="border-outline-variant bg-surface-container-low flex flex-none items-center gap-2 border-t px-2 py-1">
        {extensions && extensions.length > 0 && mode !== 'directory' && (
          <label className="font-ui text-on-surface-variant flex items-center gap-1 text-[11px]">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(ev) => setShowAll(ev.target.checked)}
            />
            All files
          </label>
        )}
        {mode === 'directory' && (
          <span className="font-ui text-on-surface-variant min-w-0 truncate text-[11px]">
            {ROOTS.find((r) => r.id === root)?.label ?? root}/{dir}
          </span>
        )}
        <div className="flex-1" />
        {mode === 'directory' && (
          <Button size="sm" variant="primary" onClick={() => onPick({ root, path: dir })}>
            Select this folder
          </Button>
        )}
        {mode === 'save' && (
          <>
            <input
              className="border-outline-variant bg-surface-container-lowest font-ui text-on-surface min-w-0 flex-1 border px-1.5 py-0.5 text-[12px] outline-none"
              value={name}
              placeholder="File name"
              aria-label="File name"
              onChange={(ev) => setName(ev.target.value)}
            />
            <Button size="sm" variant="primary" disabled={!name.trim()} onClick={handleSave}>
              Save
            </Button>
          </>
        )}
      </div>
      {confirmDialog}
    </div>
  )
}
