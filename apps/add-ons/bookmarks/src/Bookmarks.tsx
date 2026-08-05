import { useCallback, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Download,
  Edit2,
  ExternalLink,
  Folder,
  FolderPlus,
  Link2,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  Button,
  Dialog,
  ScrollArea,
  Select,
  UploadTooLargeError,
  fetchFileBytes,
  notify,
  uploadFileBytes,
  useConfirm,
  useFileDialog,
  usePrompt,
} from '@imbatranim/core'
import {
  useBookmarkGroupsQuery,
  useCreateGroupMutation,
  useCreateLinkMutation,
  useDeleteGroupMutation,
  useDeleteLinkMutation,
  useImportMutation,
  useUpdateGroupMutation,
  useUpdateLinkMutation,
} from './queries/bookmarksQueries'
import {
  allFolderIds,
  buildTree,
  countTree,
  dedupeImport,
  findDuplicate,
  folderPath,
  searchTree,
  subtreeOf,
  toParsedTree,
  toRows,
  type Row,
} from './tree'
import { describeImport, parseNetscape, toNetscape } from './netscape'
import { completeUrl, normaliseUrl } from './urlNormalise'
import type { BookmarkGroup, BookmarkLink } from './types'

/**
 * Bookmarks: a folder tree, not a flat list.
 *
 * Brief 75 exists because brief 50 (the web browser) will consume this app rather
 * than build its own bookmark store, which turns the old flat one-level model into a
 * load-bearing limitation. So: nested folders, `url` instead of `href`, Netscape-HTML
 * import/export, search, and duplicate detection.
 *
 * It also pays this app's share of the style debt that brief 74 paid for
 * sticky-notes — kit `Button`s instead of raw `<button>`s, a real `<button>` for
 * every clickable row, and `notify()` on failure where the app previously had no
 * failure signal at all.
 */

/** Each nesting level indents by this much. Small: depth 6 must still fit 320px. */
const INDENT = 12

function rowKey(row: Row): string {
  return row.kind === 'folder' ? `f${row.group.id}` : `l${row.link.id}`
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
function FolderRow({
  group,
  depth,
  childCount,
  open,
  onToggle,
  onRename,
  onAddLink,
  onAddFolder,
  onDelete,
}: {
  group: BookmarkGroup
  depth: number
  childCount: number
  open: boolean
  onToggle: () => void
  onRename: () => void
  onAddLink: () => void
  onAddFolder: () => void
  onDelete: () => void
}) {
  return (
    <div className="group/row border-outline-variant hover:bg-surface-container-low flex h-7 items-center gap-1 border-b pr-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? `Collapse ${group.name}` : `Expand ${group.name}`}
        className="focus-visible:ring-primary flex min-w-0 flex-1 items-center gap-1.5 px-1.5 text-left focus-visible:ring-2 focus-visible:outline-none"
        style={{ paddingLeft: 6 + depth * INDENT }}
      >
        {open ? (
          <ChevronDown size={12} className="text-on-surface-variant shrink-0" />
        ) : (
          <ChevronRight size={12} className="text-on-surface-variant shrink-0" />
        )}
        <Folder size={13} strokeWidth={1.75} className="text-on-surface-variant shrink-0" />
        <span className="font-ui text-on-surface truncate text-[12px] font-semibold">
          {group.name}
        </span>
        <span className="font-ui text-on-surface-variant shrink-0 text-[11px]">{childCount}</span>
      </button>
      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
        <Button
          variant="ghost"
          size="sm"
          onClick={onAddLink}
          aria-label={`Add a bookmark to ${group.name}`}
          title="Add a bookmark here"
        >
          <Plus size={12} strokeWidth={2} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onAddFolder}
          aria-label={`Add a subfolder to ${group.name}`}
          title="Add a subfolder"
        >
          <FolderPlus size={12} strokeWidth={2} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRename}
          aria-label={`Rename ${group.name}`}
          title="Rename"
        >
          <Edit2 size={12} strokeWidth={2} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          aria-label={`Delete ${group.name}`}
          title="Delete folder"
          className="hover:text-error"
        >
          <Trash2 size={12} strokeWidth={2} />
        </Button>
      </div>
    </div>
  )
}

function LinkRow({
  link,
  depth,
  onOpen,
  onEdit,
  onMove,
  onDelete,
}: {
  link: BookmarkLink
  depth: number
  onOpen: () => void
  onEdit: () => void
  onMove: () => void
  onDelete: () => void
}) {
  return (
    <div className="group/row border-outline-variant hover:bg-surface-container-low flex h-7 items-center gap-1 border-b pr-1">
      {/*
        A real button rather than a bare `<a>` wrapped in a div: activating a bookmark
        is an app action (and becomes `openApp('browser', …)` once brief 50 lands), so
        the row must not depend on anchor semantics that will change. The separate
        `<a>` below stays for "open in a new tab", where an anchor is the right thing.
      */}
      <button
        type="button"
        onClick={onOpen}
        className="focus-visible:ring-primary flex min-w-0 flex-1 items-center gap-1.5 px-1.5 text-left focus-visible:ring-2 focus-visible:outline-none"
        style={{ paddingLeft: 6 + depth * INDENT }}
        title={link.url}
      >
        <Link2 size={12} strokeWidth={1.75} className="text-on-surface-variant shrink-0" />
        <span className="font-content text-on-surface truncate text-[12px]">{link.title}</span>
        <span className="font-ui text-on-surface-variant min-w-0 flex-1 truncate text-[11px]">
          {link.url.replace(/^https?:\/\//, '')}
        </span>
      </button>
      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
        <Button
          variant="ghost"
          size="sm"
          onClick={onEdit}
          aria-label={`Edit ${link.title}`}
          title="Edit"
        >
          <Edit2 size={12} strokeWidth={2} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onMove}
          aria-label={`Move ${link.title}`}
          title="Move to another folder"
        >
          <Folder size={12} strokeWidth={2} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          aria-label={`Delete ${link.title}`}
          title="Delete bookmark"
          className="hover:text-error"
        >
          <Trash2 size={12} strokeWidth={2} />
        </Button>
      </div>
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-on-surface-variant hover:text-primary focus-visible:ring-primary shrink-0 p-1 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
        aria-label={`Open ${link.title} in a new tab`}
        title="Open in a new tab"
      >
        <ExternalLink size={12} strokeWidth={2} />
      </a>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------
export function Bookmarks({ windowId }: { windowId: string }) {
  const { data: groups, isPending } = useBookmarkGroupsQuery()
  const createGroup = useCreateGroupMutation()
  const updateGroup = useUpdateGroupMutation()
  const removeGroup = useDeleteGroupMutation()
  const createLink = useCreateLinkMutation()
  const updateLink = useUpdateLinkMutation()
  const removeLink = useDeleteLinkMutation()
  const runImport = useImportMutation()
  const { confirm, confirmDialog } = useConfirm()
  const { prompt, promptDialog } = usePrompt()
  const { openFile, saveFile, fileDialog } = useFileDialog(windowId)

  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [moving, setMoving] = useState<BookmarkLink | null>(null)

  // `groups ?? []` inline would be a fresh array on every render, so every memo below
  // it would recompute the whole tree on every keystroke.
  const all = useMemo(() => groups ?? [], [groups])
  const tree = useMemo(() => buildTree(all), [all])
  const search = useMemo(() => searchTree(tree, query), [tree, query])

  // Folders are open by default and the state tracks what the user CLOSED. That way
  // a newly created or imported folder appears open, instead of a fresh id being
  // absent from an "expanded" set and silently hiding its contents.
  const expanded = useMemo(() => {
    const ids = new Set(allFolderIds(search.nodes))
    for (const id of collapsed) if (!search.expand.has(id)) ids.delete(id)
    return ids
  }, [search.nodes, search.expand, collapsed])

  const rows = useMemo(() => toRows(search.nodes, expanded), [search.nodes, expanded])
  const linkCount = all.reduce((n, group) => n + group.links.length, 0)

  const toggle = useCallback((id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // -------------------------------------------------------------------------
  // folders
  // -------------------------------------------------------------------------
  async function addFolder(parentId: number | null) {
    const name = await prompt({
      title: parentId === null ? 'New folder' : 'New subfolder',
      message: 'Folder name',
      confirmLabel: 'Create',
    })
    if (name === null) return
    createGroup.mutate({ name, parentId })
  }

  async function renameFolder(group: BookmarkGroup) {
    const name = await prompt({
      title: 'Rename folder',
      message: 'Folder name',
      initialValue: group.name,
      confirmLabel: 'Rename',
    })
    if (name === null || name === group.name) return
    updateGroup.mutate({ id: group.id, data: { name } })
  }

  async function deleteFolder(group: BookmarkGroup) {
    // Say what is actually about to be lost. This app used to ask "Delete group and
    // all its links?" while the server orphaned the links instead of deleting them —
    // the confirm was telling the truth and the code was not.
    const subtree = subtreeOf(buildTree(all), group.id)
    const links = subtree.reduce((n, g) => n + g.links.length, 0)
    const folders = subtree.length - 1
    const parts = [`${links} bookmark${links === 1 ? '' : 's'}`]
    if (folders > 0) parts.push(`${folders} subfolder${folders === 1 ? '' : 's'}`)
    const ok = await confirm({
      title: 'Delete folder',
      message:
        links === 0 && folders === 0
          ? `Delete the empty folder “${group.name}”?`
          : `Delete “${group.name}” and everything in it — ${parts.join(' and ')}? This cannot be undone.`,
      destructive: true,
    })
    if (ok) removeGroup.mutate(group.id)
  }

  // -------------------------------------------------------------------------
  // bookmarks
  // -------------------------------------------------------------------------
  async function addLink(groupId: number) {
    const raw = await prompt({
      title: 'Add a bookmark',
      message: 'Web address',
      confirmLabel: 'Next',
    })
    if (raw === null) return
    // `example.com` is what a person types; the backend requires a scheme, so
    // complete it here rather than rejecting the input as malformed.
    const url = completeUrl(raw)

    const duplicate = findDuplicate(all, url)
    if (duplicate) {
      const ok = await confirm({
        title: 'Already bookmarked',
        message: `“${duplicate.link.title}” already points at this address${
          duplicate.path ? ` in ${duplicate.path}` : ''
        }. Add it again anyway?`,
        confirmLabel: 'Add anyway',
      })
      if (!ok) return
    }

    const title = await prompt({
      title: 'Add a bookmark',
      message: 'Title',
      initialValue: titleFromUrl(url),
      confirmLabel: 'Add',
    })
    if (title === null) return
    createLink.mutate({ groupId, title, url })
  }

  async function editLink(link: BookmarkLink) {
    const title = await prompt({
      title: 'Edit bookmark',
      message: 'Title',
      initialValue: link.title,
      confirmLabel: 'Next',
    })
    if (title === null) return
    const raw = await prompt({
      title: 'Edit bookmark',
      message: 'Web address',
      initialValue: link.url,
      confirmLabel: 'Save',
    })
    if (raw === null) return
    const url = completeUrl(raw)
    if (title === link.title && normaliseUrl(url) === normaliseUrl(link.url)) return
    updateLink.mutate({ id: link.id, data: { title, url } })
  }

  function moveLink(link: BookmarkLink) {
    // A picker, not a typed folder name: the tree can be deep and two folders may
    // share a name, so asking the user to retype `Work / Specs` exactly would be a
    // spelling test. The dialog is rendered at the bottom of this component.
    if (all.length < 2) {
      notify({
        title: 'Nowhere to move it',
        body: 'Create another folder first.',
        appId: 'bookmarks',
        level: 'info',
      })
      return
    }
    setMoving(link)
  }

  async function deleteBookmark(link: BookmarkLink) {
    const ok = await confirm({
      title: 'Delete bookmark',
      message: `Delete “${link.title}”?`,
      destructive: true,
    })
    if (ok) removeLink.mutate(link.id)
  }

  // -------------------------------------------------------------------------
  // import / export
  // -------------------------------------------------------------------------
  async function handleImport() {
    const choice = await openFile({ title: 'Import bookmarks', extensions: ['html', 'htm'] })
    if (!choice) return
    setBusy(true)
    try {
      const bytes = await fetchFileBytes(choice.root, choice.path)
      const parsed = parseNetscape(new TextDecoder().decode(bytes))
      // Loose top-level bookmarks need somewhere to live; a browser export always
      // has folders, but a hand-written file may not.
      const folders = [...parsed.folders]
      if (parsed.looseLinks.length > 0) {
        folders.push({ name: 'Imported', links: parsed.looseLinks, folders: [] })
      }

      const { folders: fresh, duplicates } = dedupeImport(folders, all)
      const counts = countTree(fresh)
      if (counts.links === 0 && counts.folders === 0) {
        notify({
          title: 'Nothing to import',
          body:
            duplicates > 0
              ? `All ${duplicates} bookmarks in that file are already here.`
              : 'That file contained no web bookmarks.',
          appId: 'bookmarks',
          level: 'info',
        })
        return
      }

      const result = await runImport.mutateAsync({ folders: fresh })
      notify({
        title: 'Bookmarks imported',
        body:
          describeImport({ ...result, skipped: parsed.skipped, flattened: parsed.flattened }) +
          (duplicates > 0 ? ` ${duplicates} already here.` : ''),
        appId: 'bookmarks',
        level: 'success',
      })
    } catch (error) {
      if (error instanceof UploadTooLargeError) {
        notify({ title: 'That file is too large', appId: 'bookmarks', level: 'error' })
      } else {
        notify({
          title: 'Could not read that file',
          body: 'It does not look like a bookmarks export.',
          appId: 'bookmarks',
          level: 'error',
        })
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleExport() {
    if (all.length === 0) {
      notify({ title: 'Nothing to export', appId: 'bookmarks', level: 'info' })
      return
    }
    const choice = await saveFile({
      title: 'Export bookmarks',
      suggestedName: 'bookmarks.html',
      extensions: ['html'],
    })
    if (!choice) return
    setBusy(true)
    try {
      const html = toNetscape(toParsedTree(buildTree(all)))
      await uploadFileBytes(
        choice.root,
        choice.path,
        new TextEncoder().encode(html),
        choice.path.split('/').pop() ?? 'bookmarks.html'
      )
      notify({
        title: 'Bookmarks exported',
        body: `${linkCount} bookmark${linkCount === 1 ? '' : 's'} written. Any browser can import this file.`,
        appId: 'bookmarks',
        level: 'success',
      })
    } catch (error) {
      notify({
        title: 'Export failed',
        body: error instanceof UploadTooLargeError ? error.message : 'The file was not written.',
        appId: 'bookmarks',
        level: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  // -------------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------------
  return (
    <div className="bg-surface-container-lowest flex h-full flex-col">
      <div className="border-outline-variant bg-surface-container-low flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1">
        <Button variant="primary" size="sm" className="gap-1" onClick={() => void addFolder(null)}>
          <FolderPlus size={12} strokeWidth={2} />
          New folder
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          onClick={() => void handleImport()}
          disabled={busy}
          title="Import a bookmarks file exported from any browser"
        >
          <Upload size={12} strokeWidth={2} />
          Import
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          onClick={() => void handleExport()}
          disabled={busy}
          title="Write a file any browser can import"
        >
          <Download size={12} strokeWidth={2} />
          Export
        </Button>
        <div className="border-outline-variant bg-surface-container-lowest flex min-w-0 flex-1 items-center gap-1 border px-1.5">
          <Search size={11} className="text-on-surface-variant shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
            }}
            placeholder="Search bookmarks…"
            aria-label="Search bookmarks"
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
      </div>

      {isPending ? (
        <div className="font-ui text-on-surface-variant flex flex-1 items-center justify-center text-[12px]">
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-on-surface-variant flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <Folder size={32} strokeWidth={1} />
          <span className="font-ui text-[12px]">
            {query !== '' ? `Nothing matches “${query.trim()}”` : 'No bookmarks yet'}
          </span>
          {query === '' && (
            <Button variant="ghost" size="sm" onClick={() => void handleImport()}>
              Import from a browser
            </Button>
          )}
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          {rows.map((row) =>
            row.kind === 'folder' ? (
              <FolderRow
                key={rowKey(row)}
                group={row.group}
                depth={row.depth}
                childCount={row.childCount}
                open={expanded.has(row.group.id)}
                onToggle={() => toggle(row.group.id)}
                onRename={() => void renameFolder(row.group)}
                onAddLink={() => void addLink(row.group.id)}
                onAddFolder={() => void addFolder(row.group.id)}
                onDelete={() => void deleteFolder(row.group)}
              />
            ) : (
              <LinkRow
                key={rowKey(row)}
                link={row.link}
                depth={row.depth}
                // Until brief 50 lands, activating a bookmark keeps doing exactly
                // what it did — the brief is explicit that this must not change yet.
                onOpen={() => window.open(row.link.url, '_blank', 'noopener,noreferrer')}
                onEdit={() => void editLink(row.link)}
                onMove={() => void moveLink(row.link)}
                onDelete={() => void deleteBookmark(row.link)}
              />
            )
          )}
        </ScrollArea>
      )}

      <div className="border-outline-variant bg-surface-container-low text-on-surface-variant flex h-5 shrink-0 items-center gap-1 border-t px-2 text-[10px]">
        {query === ''
          ? `${linkCount} bookmark${linkCount === 1 ? '' : 's'} · ${all.length} folder${all.length === 1 ? '' : 's'}`
          : `${search.matches} match${search.matches === 1 ? '' : 'es'}`}
      </div>

      {moving && (
        <MoveDialog
          link={moving}
          groups={all}
          onClose={() => setMoving(null)}
          onMove={(groupId) => {
            updateLink.mutate({ id: moving.id, data: { groupId } })
            setMoving(null)
          }}
        />
      )}
      {confirmDialog}
      {promptDialog}
      {fileDialog}
    </div>
  )
}

/** Pick a destination folder for a bookmark, by full path so depth is unambiguous. */
function MoveDialog({
  link,
  groups,
  onClose,
  onMove,
}: {
  link: BookmarkLink
  groups: BookmarkGroup[]
  onClose: () => void
  onMove: (groupId: number) => void
}) {
  const options = groups
    .filter((group) => group.id !== link.groupId)
    .map((group) => ({ value: String(group.id), label: folderPath(groups, group.id) }))
    .sort((a, b) => a.label.localeCompare(b.label))
  const [value, setValue] = useState(options[0]?.value ?? '')

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()} title="Move bookmark">
      <p className="text-on-surface-variant mb-3 text-[12px]">
        Move “{link.title}” out of {folderPath(groups, link.groupId)}.
      </p>
      <Select
        label="Destination folder"
        options={options}
        value={value}
        onValueChange={(next) => setValue(String(next))}
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="default" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={value === ''}
          onClick={() => onMove(Number(value))}
        >
          Move
        </Button>
      </div>
    </Dialog>
  )
}

/** A sensible default title so the user does not have to invent one. */
function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const last = parsed.pathname.split('/').filter(Boolean).pop()
    return last
      ? `${parsed.hostname.replace(/^www\./, '')} — ${last}`
      : parsed.hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
