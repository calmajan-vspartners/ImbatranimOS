import { useEffect, useMemo, useState } from 'react'
import { ArrowUp, File as FileIcon, Folder, HardDrive } from 'lucide-react'
import { api } from '../../../lib/axios'
import { Button } from '../ui/Button'
import { ScrollArea } from '../ui/ScrollArea'
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
  mode?: 'open' | 'save'
  suggestedName?: string
}) {
  const [root, setRoot] = useState('home')
  const [dir, setDir] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [name, setName] = useState(suggestedName ?? '')

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
      !extensions || extensions.length === 0 || showAll
        ? entries
        : entries.filter(
            (e) =>
              e.type === 'directory' ||
              extensions.includes(e.name.split('.').pop()?.toLowerCase() ?? '')
          )
    return [...filtered].sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1
    )
  }, [entries, extensions, showAll])

  const goUp = () => setDir((d) => d.split('/').slice(0, -1).join('/'))

  return (
    <div className="flex h-[340px] w-[520px] flex-col">
      <div className="border-outline-variant bg-surface-container-low flex flex-none items-center gap-1 border-b px-2 py-1">
        {ROOTS.map((r) => (
          <Button
            key={r.id}
            size="sm"
            variant={r.id === root ? 'primary' : 'ghost'}
            className="h-5 gap-1 px-1.5"
            onClick={() => {
              setRoot(r.id)
              setDir('')
            }}
          >
            <HardDrive size={11} />
            {r.label}
          </Button>
        ))}
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
          {loading ? (
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
                className={cn(
                  'border-outline-variant hover:bg-surface-container-low flex w-full items-center gap-2 border-b px-2 py-1 text-left',
                  'focus-visible:ring-primary outline-none focus-visible:ring-2 focus-visible:ring-inset'
                )}
                onClick={() => {
                  if (e.type === 'directory') setDir(e.path)
                  else if (mode === 'open') onPick({ root, path: e.path })
                  else setName(e.name)
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
        {extensions && extensions.length > 0 && (
          <label className="font-ui text-on-surface-variant flex items-center gap-1 text-[11px]">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(ev) => setShowAll(ev.target.checked)}
            />
            All files
          </label>
        )}
        <div className="flex-1" />
        {mode === 'save' && (
          <>
            <input
              className="border-outline-variant bg-surface-container-lowest font-ui text-on-surface min-w-0 flex-1 border px-1.5 py-0.5 text-[12px] outline-none"
              value={name}
              placeholder="File name"
              aria-label="File name"
              onChange={(ev) => setName(ev.target.value)}
            />
            <Button
              size="sm"
              variant="primary"
              disabled={!name.trim()}
              onClick={() => onPick({ root, path: dir ? `${dir}/${name.trim()}` : name.trim() })}
            >
              Save
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
