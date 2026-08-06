import { useMemo, useState } from 'react'
import { AlertTriangle, File as FileIcon, Folder, Search, X } from 'lucide-react'
import { Button, ScrollArea, cn } from '@imbatranim/ui'
import type { ArchiveEntry, ArchiveListing } from '../types'
import { entrySize } from '../lib/archiveApi'

/**
 * Look inside an archive without extracting it — the headline of brief 78.
 *
 * Two things here are deliberate rather than incidental:
 *
 * 1. **Refused entries are shown, not hidden.** The backend reports any entry it
 *    would decline to extract (a `../` traversal, an absolute name). Dropping them
 *    silently would make this a listing that lies about the file; showing them is
 *    how the user learns the archive is hostile.
 * 2. **A repaired name is flagged.** A non-UTF8 entry name is decoded lossily, so
 *    the extracted file will not be called what the archive says. That is worth a
 *    marker rather than a surprise on disk.
 */
export function EntryBrowser({
  listing,
  selected,
  onToggle,
  onSelectAll,
  onClear,
}: {
  listing: ArchiveListing
  selected: ReadonlySet<string>
  onToggle: (name: string) => void
  onSelectAll: (names: string[]) => void
  onClear: () => void
}) {
  const [query, setQuery] = useState('')

  const files = useMemo(() => listing.entries.filter((e) => !e.directory), [listing.entries])
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return listing.entries
    return listing.entries.filter((e) => e.name.toLowerCase().includes(needle))
  }, [listing.entries, query])

  const totalBytes = files.reduce((n, e) => n + (e.size ?? 0), 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="border-outline-variant bg-surface-container-lowest flex min-w-0 flex-1 items-center gap-1 border px-1.5">
          <Search size={11} className="text-on-surface-variant shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
            }}
            placeholder="Search inside this archive…"
            aria-label="Search inside this archive"
            className="font-content text-on-surface placeholder:text-on-surface-variant min-w-0 flex-1 bg-transparent py-1 text-[12px] outline-none"
          />
          {query !== '' && (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Clear search"
              onClick={() => setQuery('')}
            >
              <X size={11} />
            </Button>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSelectAll(visible.filter((e) => !e.directory).map((e) => e.name))}
          disabled={visible.length === 0}
        >
          Select all
        </Button>
        <Button variant="ghost" size="sm" onClick={onClear} disabled={selected.size === 0}>
          Clear
        </Button>
      </div>

      {listing.encrypted && (
        <Banner>
          This zip is password-protected. Extracting it is not supported — the decryption would need
          a new dependency, and legacy zip encryption is broken anyway. Use the Terminal for this
          one.
        </Banner>
      )}
      {listing.truncated && (
        <Banner>This archive has more entries than can be listed; only the first are shown.</Banner>
      )}
      {listing.refused.length > 0 && (
        <Banner>
          {listing.refused.length} entr{listing.refused.length === 1 ? 'y' : 'ies'} in this archive
          would write outside the destination and {listing.refused.length === 1 ? 'is' : 'are'}{' '}
          refused:{' '}
          <span className="font-mono">
            {listing.refused
              .slice(0, 3)
              .map((r) => r.name)
              .join(', ')}
          </span>
          {listing.refused.length > 3 ? ' …' : ''}. Extracting this archive will fail.
        </Banner>
      )}

      <ScrollArea className="border-outline-variant min-h-0 flex-1 border">
        {visible.length === 0 ? (
          <div className="text-on-surface-variant px-2 py-3 text-[12px]">
            {listing.entries.length === 0
              ? 'This archive is empty'
              : `Nothing matches “${query.trim()}”`}
          </div>
        ) : (
          visible.map((entry) => (
            <EntryRow
              key={entry.name}
              entry={entry}
              checked={selected.has(entry.name)}
              onToggle={() => onToggle(entry.name)}
            />
          ))
        )}
      </ScrollArea>

      <div className="text-on-surface-variant font-ui flex items-center gap-2 text-[10px]">
        <span>
          {files.length} file{files.length === 1 ? '' : 's'} · {formatTotal(totalBytes)}
        </span>
        <span className="flex-1" />
        {selected.size > 0 && <span>{selected.size} selected</span>}
      </div>
    </div>
  )
}

function EntryRow({
  entry,
  checked,
  onToggle,
}: {
  entry: ArchiveEntry
  checked: boolean
  onToggle: () => void
}) {
  const depth = entry.name.replace(/\/$/, '').split('/').length - 1
  return (
    <label
      className={cn(
        'border-outline-variant hover:bg-surface-container-low flex items-center gap-2 border-b px-2 py-1 text-[11px] last:border-b-0',
        entry.directory && 'text-on-surface-variant'
      )}
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      <input
        type="checkbox"
        className="accent-primary shrink-0"
        checked={checked}
        // A directory is not an extractable member on its own; its files are.
        disabled={entry.directory}
        onChange={onToggle}
        aria-label={`Select ${entry.name}`}
      />
      {entry.directory ? (
        <Folder size={12} strokeWidth={1.75} className="text-on-surface-variant shrink-0" />
      ) : (
        <FileIcon size={12} strokeWidth={1.75} className="text-on-surface-variant shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate font-mono">
        {entry.name.replace(/\/$/, '').split('/').pop()}
      </span>
      {entry.nameRepaired && (
        <span
          className="text-error shrink-0"
          title="This name was not valid text in the archive and had to be repaired — the extracted file will be named differently"
        >
          repaired
        </span>
      )}
      {entry.modified && (
        <span className="text-on-surface-variant shrink-0 tabular-nums">
          {entry.modified.slice(0, 10)}
        </span>
      )}
      <span className="text-on-surface-variant w-16 shrink-0 text-right tabular-nums">
        {entrySize(entry)}
      </span>
    </label>
  )
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-error-container text-on-error-container flex items-start gap-1.5 px-2 py-1 text-[11px]">
      <AlertTriangle size={12} className="mt-px shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  )
}

function formatTotal(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`
}
