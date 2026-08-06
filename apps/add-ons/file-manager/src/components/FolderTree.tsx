import { useState } from 'react'
import { ChevronRight, Folder, FolderOpen, HardDrive } from 'lucide-react'
import { cn } from '@imbatranim/ui'
import { useDirectoryQuery } from '../queries/filesQueries'
import type { FsEntry } from '../types'

type FolderTreeProps = {
  root: string
  rootLabel: string
  currentPath: string
  onNavigate: (path: string) => void
}

/**
 * Windows-explorer-style left pane: a lazily-expanding tree of folders.
 * Only directories are shown; files live in the right-hand list pane.
 */
export function FolderTree({ root, rootLabel, currentPath, onNavigate }: FolderTreeProps) {
  return (
    <div className="font-ui flex h-full flex-col gap-0.5 py-1 text-[12px]">
      <button
        onClick={() => onNavigate('')}
        className={cn(
          'flex items-center gap-1 px-2 py-0.5 text-left',
          currentPath === ''
            ? 'bg-primary-container text-on-primary-container'
            : 'text-on-surface hover:bg-surface-container'
        )}
      >
        <HardDrive size={14} strokeWidth={1.5} className="shrink-0" />
        <span className="truncate font-medium">{rootLabel}</span>
      </button>
      <TreeChildren
        root={root}
        parentPath=""
        depth={1}
        currentPath={currentPath}
        onNavigate={onNavigate}
      />
    </div>
  )
}

type TreeChildrenProps = {
  root: string
  parentPath: string
  depth: number
  currentPath: string
  onNavigate: (path: string) => void
}

function TreeChildren({ root, parentPath, depth, currentPath, onNavigate }: TreeChildrenProps) {
  const query = useDirectoryQuery(root, parentPath)
  const dirs = (query.data ?? []).filter((e) => e.type === 'directory')

  if (query.isLoading) {
    return (
      <div className="text-on-surface-variant px-2 py-0.5" style={{ paddingLeft: depth * 14 }}>
        …
      </div>
    )
  }

  return (
    <>
      {dirs
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((dir) => (
          <TreeNode
            key={dir.path}
            root={root}
            entry={dir}
            depth={depth}
            currentPath={currentPath}
            onNavigate={onNavigate}
          />
        ))}
    </>
  )
}

type TreeNodeProps = {
  root: string
  entry: FsEntry
  depth: number
  currentPath: string
  onNavigate: (path: string) => void
}

function TreeNode({ root, entry, depth, currentPath, onNavigate }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false)
  const isActive = currentPath === entry.path
  // Keep the ancestor chain of the active path visually open.
  const onActivePath = currentPath === entry.path || currentPath.startsWith(entry.path + '/')
  const open = expanded || onActivePath

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-0.5',
          isActive
            ? 'bg-primary-container text-on-primary-container'
            : 'text-on-surface hover:bg-surface-container'
        )}
        style={{ paddingLeft: depth * 14 - 8 }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
          className="text-on-surface-variant flex h-5 w-4 shrink-0 items-center justify-center"
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          <ChevronRight
            size={12}
            strokeWidth={2}
            className={cn('transition-transform', open && 'rotate-90')}
          />
        </button>
        <button
          onClick={() => onNavigate(entry.path)}
          className="flex min-w-0 flex-1 items-center gap-1 py-0.5 text-left"
        >
          {open ? (
            <FolderOpen size={14} strokeWidth={1.5} className="text-primary-container shrink-0" />
          ) : (
            <Folder size={14} strokeWidth={1.5} className="text-primary-container shrink-0" />
          )}
          <span className="truncate">{entry.name}</span>
        </button>
      </div>
      {open && (
        <TreeChildren
          root={root}
          parentPath={entry.path}
          depth={depth + 1}
          currentPath={currentPath}
          onNavigate={onNavigate}
        />
      )}
    </div>
  )
}
