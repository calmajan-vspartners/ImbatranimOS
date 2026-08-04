import { useCallback, useState } from 'react'
import type { SortDir, SortKey } from '../lib/fileSort'

// Same shape as previewPaneStore: hand-rolled localStorage persistence rather
// than zustand, because this add-on has no zustand dependency and stays at zero
// new deps.

export type ViewMode = 'details' | 'icons'

export type FileViewSettings = {
  sortKey: SortKey
  sortDir: SortDir
  showHidden: boolean
  viewMode: ViewMode
}

const STORAGE_KEY = 'imbatranim:file-manager:view'

/**
 * Name-ascending, dotfiles hidden, Details view.
 *
 * Hidden-by-default is the change the brief asks for: the backend lists dotfiles
 * unconditionally, so `.imbatranim`, `.local` and friends were permanently in the
 * user's face in their own home directory with no way to hide them.
 */
const DEFAULTS: FileViewSettings = {
  sortKey: 'name',
  sortDir: 'asc',
  showHidden: false,
  viewMode: 'details',
}

const SORT_KEYS = new Set<string>(['name', 'size', 'modified'])
const SORT_DIRS = new Set<string>(['asc', 'desc'])
const VIEW_MODES = new Set<string>(['details', 'icons'])

function loadSettings(): FileViewSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<FileViewSettings>
    // Each field is validated against its allowed set rather than trusted. This
    // value survives upgrades, so a key removed in a later version must not come
    // back out of storage and index into an undefined comparator.
    return {
      sortKey: SORT_KEYS.has(parsed.sortKey as string)
        ? (parsed.sortKey as SortKey)
        : DEFAULTS.sortKey,
      sortDir: SORT_DIRS.has(parsed.sortDir as string)
        ? (parsed.sortDir as SortDir)
        : DEFAULTS.sortDir,
      showHidden: typeof parsed.showHidden === 'boolean' ? parsed.showHidden : DEFAULTS.showHidden,
      viewMode: VIEW_MODES.has(parsed.viewMode as string)
        ? (parsed.viewMode as ViewMode)
        : DEFAULTS.viewMode,
    }
  } catch {
    return DEFAULTS
  }
}

function saveSettings(settings: FileViewSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // quota exceeded or private mode — silently skip
  }
}

export function useFileViewSettings() {
  const [settings, setSettings] = useState<FileViewSettings>(loadSettings)

  const update = useCallback((patch: Partial<FileViewSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
  }, [])

  const setSort = useCallback(
    (next: { key: SortKey; dir: SortDir }) => update({ sortKey: next.key, sortDir: next.dir }),
    [update]
  )
  const toggleHidden = useCallback(
    () =>
      setSettings((prev) => {
        const next = { ...prev, showHidden: !prev.showHidden }
        saveSettings(next)
        return next
      }),
    []
  )
  const setViewMode = useCallback((viewMode: ViewMode) => update({ viewMode }), [update])

  return {
    sort: { key: settings.sortKey, dir: settings.sortDir },
    showHidden: settings.showHidden,
    viewMode: settings.viewMode,
    setSort,
    toggleHidden,
    setViewMode,
  }
}
