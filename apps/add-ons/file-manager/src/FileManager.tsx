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
  Eye,
  EyeOff,
  LayoutGrid,
  List,
} from 'lucide-react'
import { Button, ConfirmDialog, notify, usePrompt } from '@imbatranim/core'
import { TrashDialog } from './components/TrashDialog'
import { PropertiesDialog } from './components/PropertiesDialog'
import { Input } from '@imbatranim/core'
import { Dialog } from '@imbatranim/core'
import { ScrollArea } from '@imbatranim/core'
import { Tooltip } from '@imbatranim/core'
import { cn } from '@imbatranim/core'
import { downloadUrl } from '@imbatranim/core'
import { useVirtualList } from '@imbatranim/core'
import { useElementSize } from '@imbatranim/core'
import { Breadcrumb } from './components/Breadcrumb'
import { FileList } from './components/FileList'
import { FileGrid } from './components/FileGrid'
import { FolderTree } from './components/FolderTree'
import { UploadDropzone } from './components/UploadDropzone'
import { PreviewPane } from './components/PreviewPane'
import { ContextMenu } from './components/ContextMenu'
import { FS_ROOTS } from './types'
import type { FsEntry } from './types'
import { resolveOpenApp } from './lib/openWith'
import { OpenWithDialog } from './components/OpenWithDialog'
import { buildMenuItems } from './lib/buildMenuItems'
import {
  makeBlankFile,
  uniqueNewFileName,
  editorAppId,
  type NewFileKind,
} from './lib/newFileTemplates'
import {
  sortEntries,
  filterHidden,
  nextSort,
  gridColumns,
  gridRowCount,
  TILE_HEIGHT,
} from './lib/fileSort'
import { usePreviewPaneSettings } from './store/previewPaneStore'
import { useFileViewSettings } from './store/fileViewStore'
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
import { openApp, recordRecentFile } from '@imbatranim/core'
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
  /** The file whose "Open with" chooser is showing, if any (brief 81). */
  const [openWithFor, setOpenWithFor] = useState<FsEntry | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Create folder dialog
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  // Surfaced error for batch delete / upload / create failures.
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
  /**
   * Report a failed action once, to both places.
   *
   * The banner alone was not enough — a background File Manager's failed upload or
   * delete is invisible until the user comes back to the window, and the comment
   * here used to say "(no toast system here)" long after `notify()` shipped in
   * brief 34. Raising the notification *and* keeping the inline banner is
   * deliberate: the notification is what gets noticed, the banner is what stays
   * readable while the user fixes it. One function so the two cannot drift, the
   * same reason `reportFileFailure` exists in core.
   */
  const failAction = useCallback((message: string) => {
    setActionError(message)
    notify({ title: 'File Manager', body: message, level: 'error', appId: 'file-manager' })
  }, [])

  // Sort key/direction, hidden-file visibility and view mode — persisted.
  const view = useFileViewSettings()

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
    onError: failAction,
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
    // Routing goes through core's association registry (brief 81): the user's
    // choice, then whichever app declares the type, then a text fallback.
    const appId = resolveOpenApp(root, entry.name)
    if (appId) {
      openApp(appId, { openPath: entry.path, root })
      // OS-wide recents (brief 94): double-click/Enter is the main choke point.
      recordRecentFile(root, entry.path, appId)
      return
    }
    // Nothing claims it and it is not text — an unknown binary. Ask, rather
    // than swallowing the click, which is what this did for every unmapped
    // extension before brief 81 and is the single worst thing an OS can do to
    // a double-click.
    setOpenWithFor(entry)
  }

  /** Open one file with a specific app, and remember the choice if asked. */
  function openEntryWith(entry: FsEntry, appId: string) {
    openApp(appId, { openPath: entry.path, root })
    recordRecentFile(root, entry.path, appId)
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
      failAction('That name is not a valid filename.')
      return
    }
    if ((dirQuery.data ?? []).some((e) => e.name === trimmed)) {
      failAction(`"${trimmed}" already exists here.`)
      return
    }
    const filePath = path ? `${path}/${trimmed}` : trimmed
    writeContentMutation.mutate(
      { path: filePath, content: '' },
      {
        onSuccess: () =>
          handleOpen({ name: trimmed, path: filePath, type: 'file', size: 0, modifiedAt: '' }),
        onError: () => failAction(`Could not create "${trimmed}".`),
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
      {
        onSuccess: () => {
          openApp(editorAppId(kind), { openPath: filePath, root })
          recordRecentFile(root, filePath, editorAppId(kind))
        },
      }
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
      failAction(
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
        onOpenWith: (entry: FsEntry) => setOpenWithFor(entry),
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
        onEditInPaint: (entry) => {
          openApp('paint', { openPath: entry.path, root })
          recordRecentFile(root, entry.path, 'paint')
        },
        onCompare: (() => {
          // Exactly two files selected, the clicked entry one of them — the
          // only state where "Compare" can mean something (brief 99).
          if (!menu.entry || menu.entry.type !== 'file') return null
          if (selected.size !== 2 || !selected.has(menu.entry.path)) return null
          const files = (dirQuery.data ?? []).filter(
            (e) => selected.has(e.path) && e.type === 'file'
          )
          if (files.length !== 2) return null
          return () =>
            openApp('diff', {
              leftRoot: root,
              leftPath: files[0].path,
              rightRoot: root,
              rightPath: files[1].path,
            })
        })(),
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

  // Filter, then sort, ONCE — and pass the result down. FileList used to re-sort
  // internally with its own call, which happened to agree only because both used
  // the same fixed comparator; the moment sorting became user-controlled, two
  // independent sorts would have let arrow-key movement disagree with what is on
  // screen. `orderedEntries` is now the single order for the virtualizer, keyboard
  // nav, selection and the rendering.
  const visibleEntries = filterHidden(entries, view.showHidden)
  const orderedEntries = sortEntries(visibleEntries, view.sort.key, view.sort.dir)
  const selectedEntries = orderedEntries.filter((e) => selected.has(e.path))
  const hiddenCount = entries.length - visibleEntries.length

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
    if (!showList || view.viewMode !== 'details') return
    const thead = listContainerRef.current?.querySelector('thead')
    if (thead) setHeaderHeight(thead.getBoundingClientRect().height)
  }, [showList, view.viewMode])

  // Icons view needs the pane's width to know how many tiles fit. Measured with
  // core's `useElementSize` (a ref callback — see that hook for why a mount effect
  // does not bind here either).
  const [listPane, attachListPane] = useElementSize()
  const columns = view.viewMode === 'icons' ? gridColumns(listPane.width) : 1

  /**
   * ONE virtualizer, whose items mean different things per view mode: a table row
   * in Details, a row of `columns` tiles in Icons. Everything that depends on that
   * distinction is derived here rather than inside the two renderers, so the count,
   * the size estimate and the scroll margin cannot disagree with each other.
   *
   * `scrollMargin` is the non-obvious one: Details keeps a non-virtualized
   * `<thead>` inside the same scroll container, so its rows start `headerHeight` px
   * down. Icons has no header, so passing that offset would place every tile a
   * header's height away from where the virtualizer believes it is.
   */
  const isIcons = view.viewMode === 'icons'
  // Typed as HTMLElement rather than HTMLTableRowElement: the same virtualizer
  // measures a <tr> in Details and a <div> row in Icons.
  const rowVirtualizer = useVirtualList<HTMLElement>({
    count: isIcons ? gridRowCount(orderedEntries.length, columns) : orderedEntries.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => (isIcons ? TILE_HEIGHT : 29),
    scrollMargin: isIcons ? 0 : headerHeight,
  })

  /**
   * The list wrapper is both measured (for the Icons column count) and kept in a
   * ref (for the `<thead>` height measurement). `useCallback` is load-bearing: an
   * inline arrow here is a new identity every render, so React re-ran the ref's
   * cleanup + attach each time, and the size hook's state write on attach drove an
   * infinite render loop that blanked the whole desktop.
   */
  const attachListContainer = useCallback(
    (el: HTMLDivElement | null) => {
      listContainerRef.current = el
      return attachListPane(el)
    },
    [attachListPane]
  )

  const { handleListKeyDown } = useListKeyboardNav({
    orderedEntries,
    selectedEntries,
    renamingPath,
    onOpen: handleOpen,
    setSelected,
    // The nav hook speaks in ENTRY indices; the virtualizer in Icons mode counts
    // rows. This is the one place that conversion happens.
    scrollToIndex: (index) =>
      rowVirtualizer.scrollToIndex(isIcons ? Math.floor(index / columns) : index),
    columns,
  })

  /**
   * Ctrl+H toggles hidden files, from anywhere inside this window.
   *
   * Bound on the app's own root rather than through `useRegisteredHotkeys`, which
   * binds globally: a global Ctrl+H would toggle a background File Manager's
   * dotfiles while the user is typing in another app. Bubbling from the focused
   * descendant reaches this div only when focus is inside this window, which is
   * exactly the scope wanted. Documented in App.tsx so it appears in the
   * shortcuts overlay without flickering as windows open and close.
   */
  function handleAppKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'h') return
    // Never steal the key from a text field — renaming a file is the obvious case.
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
    e.preventDefault()
    view.toggleHidden()
  }

  return (
    <div
      ref={containerRef}
      onKeyDown={handleAppKeyDown}
      className="bg-surface-container-lowest flex h-full flex-col"
    >
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

        <Tooltip
          content={
            view.showHidden
              ? `Hide hidden files (Ctrl+H)`
              : hiddenCount > 0
                ? `Show ${hiddenCount} hidden item${hiddenCount === 1 ? '' : 's'} (Ctrl+H)`
                : 'Show hidden files (Ctrl+H)'
          }
        >
          <Button
            variant={view.showHidden ? 'primary' : 'ghost'}
            size="sm"
            className="h-5 w-5 p-0"
            aria-pressed={view.showHidden}
            aria-label="Show hidden files"
            onClick={view.toggleHidden}
          >
            {view.showHidden ? <Eye size={12} /> : <EyeOff size={12} />}
          </Button>
        </Tooltip>

        <Tooltip content={view.viewMode === 'icons' ? 'Details view' : 'Icons view'}>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            aria-label={
              view.viewMode === 'icons' ? 'Switch to details view' : 'Switch to icons view'
            }
            onClick={() => view.setViewMode(view.viewMode === 'icons' ? 'details' : 'icons')}
          >
            {view.viewMode === 'icons' ? <List size={12} /> : <LayoutGrid size={12} />}
          </Button>
        </Tooltip>

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
                ref={attachListContainer}
                onClick={selection.clear}
                onContextMenu={openBackgroundMenu}
                onKeyDown={handleListKeyDown}
                tabIndex={0}
                className="min-h-full outline-none"
              >
                {/* A folder whose every entry is a dotfile would otherwise read as
                    "Empty folder", which is a lie the user cannot act on. */}
                {orderedEntries.length === 0 && hiddenCount > 0 ? (
                  <div className="text-on-surface-variant flex flex-col items-center justify-center gap-2 py-12">
                    <EyeOff size={32} strokeWidth={1} />
                    <span className="font-ui text-[12px]">
                      {hiddenCount} hidden item{hiddenCount === 1 ? '' : 's'}, nothing else here
                    </span>
                    <Button variant="default" size="sm" onClick={view.toggleHidden}>
                      Show hidden files
                    </Button>
                  </div>
                ) : isIcons ? (
                  <FileGrid
                    entries={orderedEntries}
                    virtualizer={rowVirtualizer}
                    columns={columns}
                    selected={selected}
                    onSelect={selection.select}
                    onOpen={handleOpen}
                    onContextMenu={openEntryMenu}
                    renamingPath={renamingPath}
                    renameValue={renameValue}
                    onRenameChange={setRenameValue}
                    onRenameCommit={handleRenameCommit}
                    onRenameCancel={() => setRenamingPath(null)}
                  />
                ) : (
                  <FileList
                    // The ORDERED array, not the raw query data. This used to pass
                    // `entries` while the virtualizer counted `orderedEntries` — it
                    // only lined up because FileList re-sorted with an identical
                    // comparator. One order, one array.
                    entries={orderedEntries}
                    sort={view.sort}
                    onSortChange={(key) => view.setSort(nextSort(view.sort, key))}
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
                )}
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

      {openWithFor && (
        <OpenWithDialog
          fileName={openWithFor.name}
          onPick={(appId) => openEntryWith(openWithFor, appId)}
          onClose={() => setOpenWithFor(null)}
        />
      )}
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
        onError={failAction}
      />

      {/* Delete confirm dialog */}
      {/* Core's ConfirmDialog rather than a hand-rolled <Dialog> — this app was the
          last place in the OS with its own delete dialect (ui-conventions §44).
          The controlled component, not the `useConfirm` hook: `useDeleteFlow`
          already owns the open/confirm/cancel state machine, and rewriting it to
          await an imperative promise would be churn for no gain. */}
      <ConfirmDialog
        open={deleteFlow.dialogOpen}
        title={deleteFlow.willTrash ? 'Move to Trash' : 'Delete permanently'}
        // The copy must match what actually happens: claiming "cannot be undone"
        // for a move to the Trash would train the user to distrust the warning
        // that matters.
        message={
          <>
            {deleteFlow.willTrash ? 'Move ' : 'Permanently delete '}
            <span className="font-semibold">{deleteFlow.deleteLabel}</span>
            {deleteFlow.willTrash
              ? ' to the Trash? You can restore it from there.'
              : '? This cannot be undone.'}
          </>
        }
        confirmLabel={deleteFlow.willTrash ? 'Move to Trash' : 'Delete permanently'}
        destructive
        onConfirm={deleteFlow.confirm}
        onCancel={deleteFlow.cancel}
      />
    </div>
  )
}
