import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  FolderPlus,
  Clipboard,
  Upload,
  Trash2,
  RefreshCw,
  X,
  PanelRight,
  PanelRightClose,
} from 'lucide-react'
import { Button, notify, usePrompt } from '@imbatranim/core'
import { TrashDialog } from './components/TrashDialog'
import { PropertiesDialog } from './components/PropertiesDialog'
import { Input } from '@imbatranim/core'
import { Dialog } from '@imbatranim/core'
import { ScrollArea } from '@imbatranim/core'
import { Tooltip } from '@imbatranim/core'
import { cn } from '@imbatranim/core'
import { downloadUrl } from '@imbatranim/core'
import { useVirtualList } from '@imbatranim/core'
import { Breadcrumb } from './components/Breadcrumb'
import { FileList } from './components/FileList'
import { FolderTree } from './components/FolderTree'
import { UploadDropzone } from './components/UploadDropzone'
import { PreviewPane } from './components/PreviewPane'
import { ContextMenu } from './components/ContextMenu'
import { FS_ROOTS } from './types'
import type { FsEntry } from './types'
import { sortEntries } from './lib/fileKind'
import { resolveOpenApp } from './lib/openWith'
import { buildMenuItems } from './lib/buildMenuItems'
import {
  makeBlankFile,
  uniqueNewFileName,
  editorAppId,
  type NewFileKind,
} from './lib/newFileTemplates'
import { usePreviewPaneSettings } from './store/previewPaneStore'
import { useFileSelection } from './hooks/useFileSelection'
import { useFileClipboard } from './hooks/useFileClipboard'
import { useDeleteFlow } from './hooks/useDeleteFlow'
import { usePaneResize } from './hooks/usePaneResize'
import { useListKeyboardNav } from './hooks/useListKeyboardNav'
import {
  useDirectoryQuery,
  useCreateDirectoryMutation,
  useDeleteEntryMutation,
  useMoveEntryMutation,
  useCopyEntryMutation,
  useWriteContentMutation,
  useUploadFileMutation,
} from './queries/filesQueries'
import { openApp } from '@imbatranim/core'
import { useIntentStore } from '@imbatranim/core'

type MenuState = {
  x: number
  y: number
  entry: FsEntry | null
}

function triggerDownload(root: string, entry: FsEntry) {
  const a = document.createElement('a')
  a.href = downloadUrl(root, entry.path)
  a.download = entry.name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function FileManager({ windowId }: { windowId: string }) {
  const [root, setRoot] = useState(FS_ROOTS[0].id)
  const rootCfg = FS_ROOTS.find((r) => r.id === root) ?? FS_ROOTS[0]
  const [path, setPath] = useState('')

  // Drain a one-shot navigate intent (from the command palette's file search)
  // exactly once — ref-guarded so StrictMode's double-mount can't consume twice.
  // `navigatePath` is separate from the editor apps' `openPath` intent: it moves
  // *this* window to a directory rather than opening a file elsewhere. An empty
  // navigatePath ('') means the root itself, so guard on `!== undefined`.
  const navConsumedRef = useRef(false)
  useEffect(() => {
    if (navConsumedRef.current) return
    navConsumedRef.current = true
    const intent = useIntentStore.getState().consumeIntent(windowId) as
      | { navigatePath?: string; root?: string }
      | undefined
    if (intent?.navigatePath !== undefined && intent.root) {
      // Draining a one-shot open-intent on mount is the intended "sync from an
      // external system" use of an effect; it runs at most once (ref-guarded).
      /* eslint-disable react-hooks/set-state-in-effect */
      setRoot(intent.root)
      setPath(intent.navigatePath)
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [windowId])

  // Rename state
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Create folder dialog
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  // Surfaced error for batch delete/upload failures (no toast system here).
  const [actionError, setActionError] = useState<string | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  const [propsEntry, setPropsEntry] = useState<FsEntry | null>(null)

  // Right-click context menu
  const [menu, setMenu] = useState<MenuState | null>(null)

  // File input ref for upload picker
  const fileInputRef = useRef<HTMLInputElement>(null)
  const openFilePicker = useCallback(() => fileInputRef.current?.click(), [])

  // Preview pane: on/off + width persist across sessions; visibility also
  // collapses at small app-window widths regardless of the persisted setting.
  const previewPane = usePreviewPaneSettings()
  const { containerRef, resizing, previewPaneVisible, handlePaneResizeStart } =
    usePaneResize(previewPane)

  const dirQuery = useDirectoryQuery(root, path)
  const createDirMutation = useCreateDirectoryMutation(root, path)
  const writeContentMutation = useWriteContentMutation(root, path)
  const { prompt: promptName, promptDialog } = usePrompt()
  const deleteMutation = useDeleteEntryMutation(root, path)
  const moveMutation = useMoveEntryMutation(root, path)
  const copyMutation = useCopyEntryMutation(root, path)
  const uploadMutation = useUploadFileMutation(root, path)

  const selection = useFileSelection()
  const { selected, setSelected } = selection
  const clipboard = useFileClipboard({ path, copyMutation, moveMutation })
  const deleteFlow = useDeleteFlow({
    selected,
    setSelected,
    deleteMutation,
    onError: setActionError,
    // Only the home root has a Trash; notes is a separate tree.
    trashEnabled: root === 'home',
    onTrashed: (label, count) =>
      notify({
        title: count === 1 ? 'Moved to Trash' : `Moved ${count} items to Trash`,
        body: count === 1 ? label : undefined,
        level: 'info',
        appId: 'file-manager',
      }),
  })

  function switchRoot(nextRoot: string) {
    setRoot(nextRoot)
    setPath('')
    selection.clear()
    clipboard.clear()
  }

  function navigate(nextPath: string) {
    setPath(nextPath)
    selection.clear()
  }

  function handleOpen(entry: FsEntry) {
    if (entry.type === 'directory') {
      navigate(entry.path)
      return
    }
    // Extension → app routing lives in ./lib/openWith (shared by double-click
    // and Enter). Viewers are root-aware and get `{ root }`; Notepad ignores it
    // (Notes root only, enforced by the map's onlyRoots).
    const appId = resolveOpenApp(root, entry.name)
    if (appId) {
      openApp(appId, { openPath: entry.path, root })
    }
  }

  function handleRename(entry: FsEntry) {
    setRenamingPath(entry.path)
    setRenameValue(entry.name)
  }

  function handleRenameCommit() {
    if (!renamingPath || !renameValue.trim()) {
      setRenamingPath(null)
      return
    }
    const dir = renamingPath.includes('/')
      ? renamingPath.substring(0, renamingPath.lastIndexOf('/'))
      : ''
    const newPath = dir ? `${dir}/${renameValue.trim()}` : renameValue.trim()
    if (newPath !== renamingPath) {
      moveMutation.mutate({ from: renamingPath, to: newPath })
    }
    setRenamingPath(null)
  }

  function handleCreateFolder() {
    if (!newFolderName.trim()) return
    createDirMutation.mutate(newFolderName.trim(), {
      onSuccess: () => {
        setShowNewFolder(false)
        setNewFolderName('')
      },
    })
  }

  async function handleNewFile() {
    const name = await promptName({
      title: 'New file',
      message: 'Include the extension — it decides which app opens the file.',
      placeholder: 'notes.md',
    })
    if (!name) return
    const trimmed = name.trim()
    // A filename, not a path: the backend jails this anyway, but refusing here
    // gives a real message instead of a 400.
    if (!trimmed || /[\\/]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
      setActionError('That name is not a valid filename.')
      return
    }
    if ((dirQuery.data ?? []).some((e) => e.name === trimmed)) {
      setActionError(`"${trimmed}" already exists here.`)
      return
    }
    const filePath = path ? `${path}/${trimmed}` : trimmed
    writeContentMutation.mutate(
      { path: filePath, content: '' },
      {
        onSuccess: () =>
          handleOpen({ name: trimmed, path: filePath, type: 'file', size: 0, modifiedAt: '' }),
        onError: () => setActionError(`Could not create "${trimmed}".`),
      }
    )
  }

  function handleNewOfficeFile(kind: NewFileKind) {
    // Born in the file manager: write a blank template at the current directory
    // under a non-colliding name, then open it straight into the editor.
    const existing = (dirQuery.data ?? []).map((e) => e.name)
    const name = uniqueNewFileName(kind, existing)
    const filePath = path ? `${path}/${name}` : name
    const file = makeBlankFile(kind, name)
    uploadMutation.mutate(
      { path: filePath, file },
      { onSuccess: () => openApp(editorAppId(kind), { openPath: filePath, root }) }
    )
  }

  async function handleUploadFiles(files: File[]) {
    const results = await Promise.allSettled(
      files.map((file) => {
        const filePath = path ? `${path}/${file.name}` : file.name
        return uploadMutation.mutateAsync({ path: filePath, file })
      })
    )
    const failed = files.filter((_, i) => results[i].status === 'rejected')
    if (failed.length > 0) {
      setActionError(
        `Failed to upload ${failed.length} file${failed.length !== 1 ? 's' : ''}: ${failed
          .map((f) => f.name)
          .join(', ')}.`
      )
    }
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (files && files.length > 0) {
      handleUploadFiles(Array.from(files))
      e.target.value = ''
    }
  }

  function openEntryMenu(entry: FsEntry, e: React.MouseEvent) {
    setMenu({ x: e.clientX, y: e.clientY, entry })
  }

  function openBackgroundMenu(e: React.MouseEvent) {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, entry: null })
  }

  // `openFilePicker` reads fileInputRef, but only when the Upload item is
  // clicked (an event handler) — never during render. react-hooks/refs can't
  // see that through buildMenuItems, so its warning here is a false positive.
  /* eslint-disable react-hooks/refs */
  const menuItems = menu
    ? buildMenuItems({
        entry: menu.entry,
        root,
        hasClipboard: !!clipboard.clipboard,
        onOpen: handleOpen,
        onDownload: (entry) => triggerDownload(root, entry),
        onRename: handleRename,
        onCopy: clipboard.copy,
        onCut: clipboard.cut,
        onDelete: deleteFlow.requestSingle,
        onNewFile: () => void handleNewFile(),
        onNewFolder: () => setShowNewFolder(true),
        onProperties: (entry) => setPropsEntry(entry),
        onNewOfficeFile: handleNewOfficeFile,
        onUpload: openFilePicker,
        onPaste: clipboard.paste,
        onRefresh: () => dirQuery.refetch(),
        onExtract: (entry) =>
          openApp('archive-manager', { action: 'extract', root, path: entry.path }),
        onCompress: (entry) => {
          const paths =
            selected.has(entry.path) && selected.size > 1
              ? orderedEntries.filter((e) => selected.has(e.path)).map((e) => e.path)
              : [entry.path]
          const base = paths.length > 1 ? 'archive' : entry.name
          openApp('archive-manager', {
            action: 'compress',
            root,
            paths,
            dest: `${base}.zip`,
            format: 'zip',
          })
        },
      })
    : []
  /* eslint-enable react-hooks/refs */

  const entries = dirQuery.data ?? []
  const isLoading = dirQuery.isLoading
  const isError = dirQuery.isError

  const orderedEntries = sortEntries(entries)
  const selectedEntries = orderedEntries.filter((e) => selected.has(e.path))

  // The scroll container is the ScrollArea viewport that wraps the list; we get
  // it directly via `viewportRef` (no reliance on library-internal DOM attrs).
  // The virtualizer is created here so both the list rendering and keyboard nav
  // share one instance — the latter needs `scrollToIndex` to reveal off-screen
  // rows. `listContainerRef` points at the list wrapper for header measurement.
  const viewportRef = useRef<HTMLDivElement>(null)
  const listContainerRef = useRef<HTMLDivElement>(null)

  // FileList keeps its (non-virtualized) <thead> inside the same scroll
  // container, so the rows start `headerHeight` px down. Feeding that as
  // `scrollMargin` keeps scrollToIndex and the row offsets accurate.
  const [headerHeight, setHeaderHeight] = useState(0)
  const showList = !isLoading && !isError && orderedEntries.length > 0
  useLayoutEffect(() => {
    if (!showList) return
    const thead = listContainerRef.current?.querySelector('thead')
    if (thead) setHeaderHeight(thead.getBoundingClientRect().height)
  }, [showList])

  const rowVirtualizer = useVirtualList<HTMLTableRowElement>({
    count: orderedEntries.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 29,
    scrollMargin: headerHeight,
  })

  const { handleListKeyDown } = useListKeyboardNav({
    orderedEntries,
    selectedEntries,
    renamingPath,
    onOpen: handleOpen,
    setSelected,
    scrollToIndex: rowVirtualizer.scrollToIndex,
  })

  return (
    <div ref={containerRef} className="bg-surface-container-lowest flex h-full flex-col">
      {/* Toolbar */}
      <div className="border-outline-variant bg-surface-container-low flex items-center gap-1 border-b px-2 py-1">
        {/* Root switcher */}
        <div className="mr-1 flex items-center gap-0.5">
          {FS_ROOTS.map((r) => (
            <Button
              key={r.id}
              variant={r.id === root ? 'primary' : 'default'}
              size="sm"
              onClick={() => switchRoot(r.id)}
            >
              {r.label}
            </Button>
          ))}
        </div>

        <div className="bg-outline-variant mx-1 h-4 w-px" />

        <Button
          variant="default"
          size="sm"
          className="flex items-center gap-1"
          onClick={() => setShowNewFolder(true)}
        >
          <FolderPlus size={12} />
          New Folder
        </Button>

        <Button
          variant="default"
          size="sm"
          className="flex items-center gap-1"
          onClick={openFilePicker}
        >
          <Upload size={12} />
          Upload
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileInputChange}
        />

        {clipboard.clipboard && (
          <Button
            variant="default"
            size="sm"
            className="flex items-center gap-1"
            onClick={clipboard.paste}
          >
            <Clipboard size={12} />
            Paste{' '}
            <span className="text-on-surface-variant">
              ({clipboard.clipboard.mode === 'cut' ? 'move' : 'copy'}:{' '}
              {clipboard.clipboard.entry.name})
            </span>
          </Button>
        )}

        {selected.size > 1 && (
          <Button
            variant="destructive"
            size="sm"
            className="flex items-center gap-1"
            onClick={(e) => deleteFlow.requestBatch(e.shiftKey)}
          >
            <Trash2 size={12} />
            Delete {selected.size}
          </Button>
        )}

        {clipboard.clipboard && (
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={clipboard.clear}>
            <X size={11} />
          </Button>
        )}

        {root === 'home' && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 gap-1 px-1.5"
            title="Open the Trash"
            onClick={() => setTrashOpen(true)}
          >
            <Trash2 size={11} />
            Trash
          </Button>
        )}

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0"
          onClick={() => dirQuery.refetch()}
        >
          <RefreshCw size={12} className={cn(dirQuery.isFetching && 'animate-spin')} />
        </Button>

        <Tooltip content={previewPane.open ? 'Hide preview pane' : 'Show preview pane'}>
          <Button
            variant={previewPane.open ? 'primary' : 'ghost'}
            size="sm"
            className="h-5 w-5 p-0"
            onClick={previewPane.toggle}
          >
            {previewPane.open ? <PanelRightClose size={12} /> : <PanelRight size={12} />}
          </Button>
        </Tooltip>
      </div>

      {/* Breadcrumb */}
      <Breadcrumb root={root} rootLabel={rootCfg.label} path={path} onNavigate={navigate} />

      {/* Action error banner (batch delete / upload failures) */}
      {actionError && (
        <div className="border-outline-variant bg-surface-container-low flex items-center gap-2 border-b px-2 py-1">
          <span className="font-ui text-error flex-1 text-[12px]">{actionError}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            onClick={() => setActionError(null)}
          >
            <X size={11} />
          </Button>
        </div>
      )}

      {/* Body: tree pane | list pane */}
      <div className="flex min-h-0 flex-1">
        {/* Left: folder tree */}
        <div className="border-outline-variant bg-surface-container-low w-52 shrink-0 border-r">
          <ScrollArea className="h-full w-full">
            <FolderTree
              root={root}
              rootLabel={rootCfg.label}
              currentPath={path}
              onNavigate={navigate}
            />
          </ScrollArea>
        </div>

        {/* Right: file listing */}
        <UploadDropzone onFiles={handleUploadFiles} className="min-w-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full w-full" viewportRef={viewportRef}>
            {isLoading && (
              <div className="text-on-surface-variant font-ui flex items-center justify-center py-12 text-[12px]">
                Loading…
              </div>
            )}
            {isError && (
              <div className="text-error font-ui flex items-center justify-center py-12 text-[12px]">
                Failed to load directory.
              </div>
            )}
            {!isLoading && !isError && (
              <div
                ref={listContainerRef}
                onClick={selection.clear}
                onContextMenu={openBackgroundMenu}
                onKeyDown={handleListKeyDown}
                tabIndex={0}
                className="min-h-full outline-none"
              >
                <FileList
                  entries={entries}
                  virtualizer={rowVirtualizer}
                  root={root}
                  selected={selected}
                  onSelect={selection.select}
                  onOpen={handleOpen}
                  onRename={handleRename}
                  onCopy={clipboard.copy}
                  onCut={clipboard.cut}
                  onDelete={deleteFlow.requestSingle}
                  onContextMenu={openEntryMenu}
                  renamingPath={renamingPath}
                  renameValue={renameValue}
                  onRenameChange={setRenameValue}
                  onRenameCommit={handleRenameCommit}
                  onRenameCancel={() => setRenamingPath(null)}
                />
              </div>
            )}
          </ScrollArea>
        </UploadDropzone>

        {/* Resize handle + preview pane */}
        {previewPaneVisible && (
          <>
            <div
              onMouseDown={handlePaneResizeStart}
              className={cn(
                'bg-outline-variant hover:bg-primary w-1 shrink-0 cursor-col-resize transition-colors',
                resizing && 'bg-primary'
              )}
            />
            <div
              style={{ width: previewPane.width }}
              className="border-outline-variant bg-surface-container-low shrink-0 border-l"
            >
              <PreviewPane root={root} selectedEntries={selectedEntries} className="h-full" />
            </div>
          </>
        )}
      </div>

      {/* Status bar */}
      <div className="border-outline-variant bg-surface-container-low flex items-center border-t px-2 py-0.5">
        <span className="font-ui text-on-surface-variant text-[11px]">
          {entries.length} item{entries.length !== 1 ? 's' : ''}
          {selected.size > 0 && ` · ${selected.size} selected`}
          {clipboard.clipboard &&
            ` · Clipboard: ${clipboard.clipboard.entry.name} (${clipboard.clipboard.mode})`}
        </span>
      </div>

      {/* Right-click context menu */}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}

      {/* New folder dialog */}
      <Dialog open={showNewFolder} onOpenChange={setShowNewFolder} title="New Folder">
        <div className="flex flex-col gap-3">
          <Input
            label="Folder Name"
            id="new-folder-name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateFolder()
              if (e.key === 'Escape') setShowNewFolder(false)
            }}
            autoFocus
            placeholder="e.g. new-folder"
          />
          <div className="flex justify-end gap-2">
            <Button variant="default" size="sm" onClick={() => setShowNewFolder(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleCreateFolder}
              disabled={!newFolderName.trim() || createDirMutation.isPending}
            >
              Create
            </Button>
          </div>
        </div>
      </Dialog>

      {promptDialog}

      <PropertiesDialog
        entry={propsEntry}
        root={root}
        open={propsEntry !== null}
        onOpenChange={(o) => !o && setPropsEntry(null)}
      />

      <TrashDialog
        open={trashOpen}
        onOpenChange={setTrashOpen}
        root={root}
        currentPath={path}
        onRestored={(p) =>
          notify({
            title: 'Restored from Trash',
            body: p,
            level: 'success',
            appId: 'file-manager',
          })
        }
        onError={setActionError}
      />

      {/* Delete confirm dialog */}
      <Dialog
        open={deleteFlow.dialogOpen}
        onOpenChange={(open) => {
          if (!open) deleteFlow.cancel()
        }}
        title={deleteFlow.willTrash ? 'Move to Trash' : 'Delete permanently'}
      >
        <div className="flex flex-col gap-3">
          {/* The copy must match what actually happens: claiming "cannot be
              undone" for a move to the Trash would train the user to distrust
              the warning that matters. */}
          <p className="font-content text-on-surface text-[13px]">
            {deleteFlow.willTrash ? 'Move ' : 'Permanently delete '}
            <span className="font-semibold">{deleteFlow.deleteLabel}</span>
            {deleteFlow.willTrash
              ? ' to the Trash? You can restore it from there.'
              : '? This cannot be undone.'}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="default" size="sm" onClick={deleteFlow.cancel}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={deleteFlow.confirm}
              disabled={deleteFlow.isPending}
            >
              {deleteFlow.willTrash ? 'Move to Trash' : 'Delete permanently'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
