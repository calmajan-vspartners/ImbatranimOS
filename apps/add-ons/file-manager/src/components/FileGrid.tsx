import { Folder } from 'lucide-react'
import { cn } from '@imbatranim/ui'
import type { VirtualList } from '@imbatranim/ui'
import type { FsEntry } from '../types'
import { TILE_HEIGHT, TILE_WIDTH } from '../lib/fileSort'
import { getFileIcon } from '../lib/entryPresentation'

type FileGridProps = {
  /**
   * Already filtered and sorted by FileManager, exactly as FileList receives them.
   * Do not reorder here — the virtualizer's row indices and the keyboard
   * navigation are derived from this same array.
   */
  entries: FsEntry[]
  /** Row virtualizer over GRID ROWS, not entries. Created in FileManager. */
  virtualizer: VirtualList<HTMLElement>
  columns: number
  selected: Set<string>
  onSelect: (path: string, multi: boolean) => void
  onOpen: (entry: FsEntry) => void
  onContextMenu?: (entry: FsEntry, e: React.MouseEvent) => void
  renamingPath: string | null
  renameValue: string
  onRenameChange: (val: string) => void
  onRenameCommit: () => void
  onRenameCancel: () => void
}

/**
 * The Icons view.
 *
 * Virtualized like the Details list, but **one virtual item is a row of
 * `columns` tiles**, not one entry. Getting that mapping wrong is the whole risk
 * here: the virtualizer's `count` is the row count, while selection, keyboard
 * navigation and the context menu all speak in entry indices. The single
 * conversion lives in `slice()` below, and `FileManager` does the matching
 * `Math.floor(index / columns)` when it scrolls a selected entry into view.
 *
 * There is no `<thead>` in this mode, so `FileManager` feeds the virtualizer a
 * `scrollMargin` of 0 — a leftover header offset here would put every tile a
 * header's height off from where the virtualizer thinks it is.
 */
export function FileGrid({
  entries,
  virtualizer,
  columns,
  selected,
  onSelect,
  onOpen,
  onContextMenu,
  renamingPath,
  renameValue,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
}: FileGridProps) {
  const virtualRows = virtualizer.getVirtualItems()
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0
  const paddingBottom =
    virtualRows.length > 0
      ? virtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0

  if (entries.length === 0) {
    return (
      <div className="text-on-surface-variant flex flex-col items-center justify-center gap-2 py-12">
        <Folder size={32} strokeWidth={1} />
        <span className="font-ui text-[12px]">Empty folder</span>
      </div>
    )
  }

  return (
    <div className="font-ui p-1 text-[12px]">
      {paddingTop > 0 && <div aria-hidden style={{ height: paddingTop }} />}
      {virtualRows.map((vr) => {
        const first = vr.index * columns
        const row = entries.slice(first, first + columns)
        return (
          <div
            key={vr.index}
            data-index={vr.index}
            ref={virtualizer.measureElement}
            className="flex items-start"
          >
            {row.map((entry, col) => {
              const isSelected = selected.has(entry.path)
              const isRenaming = renamingPath === entry.path
              return (
                <div
                  key={entry.path}
                  data-entry-path={entry.path}
                  style={{ width: TILE_WIDTH, height: TILE_HEIGHT }}
                  onClick={(e) => {
                    // Same reason as the Details rows: without stopping the bubble
                    // the background container's "clear selection" handler runs in
                    // the same tick and undoes the select.
                    e.stopPropagation()
                    onSelect(entry.path, e.ctrlKey || e.metaKey)
                  }}
                  onDoubleClick={() => onOpen(entry)}
                  onContextMenu={(e) => {
                    if (!onContextMenu) return
                    e.preventDefault()
                    e.stopPropagation()
                    if (!selected.has(entry.path)) onSelect(entry.path, false)
                    onContextMenu(entry, e)
                  }}
                  className={cn(
                    'flex cursor-pointer flex-col items-center gap-1 px-1 py-2 text-center transition-colors',
                    isSelected
                      ? 'bg-primary-container text-on-primary-container'
                      : 'hover:bg-surface-container'
                  )}
                  // The last tile in a partly-filled row must not stretch; a fixed
                  // width above plus this keeps the grid aligned column-to-column
                  // across rows regardless of how full the last one is.
                  data-col={col}
                >
                  {getFileIcon(entry, 32)}
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => onRenameChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onRenameCommit()
                        if (e.key === 'Escape') onRenameCancel()
                      }}
                      onBlur={onRenameCommit}
                      onClick={(e) => e.stopPropagation()}
                      className="border-primary bg-surface-container-lowest font-content text-on-surface w-full border px-1 py-0 text-center text-[11px] outline-none"
                    />
                  ) : (
                    // Two lines then ellipsis: a long filename must not change the
                    // tile's height, or the virtualizer's row estimate drifts and
                    // scrolling jumps.
                    <span
                      title={entry.name}
                      className="line-clamp-2 leading-tight break-all select-none"
                    >
                      {entry.name}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
      {paddingBottom > 0 && <div aria-hidden style={{ height: paddingBottom }} />}
    </div>
  )
}
