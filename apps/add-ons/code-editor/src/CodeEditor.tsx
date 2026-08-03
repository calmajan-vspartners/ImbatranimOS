import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileCode2, Loader2, Save, X } from 'lucide-react'
import Editor, { type OnMount } from '@monaco-editor/react'
import {
  Button,
  Tooltip,
  UploadTooLargeError,
  api,
  cn,
  fetchFileBytes,
  fileName,
  uploadFileBytes,
  useConfirm,
  useFileDialog,
  useOpenIntent,
  usePrompt,
  useSaveHotkey,
  useUnsavedGuard,
} from '@imbatranim/core'
// Side-effect: point @monaco-editor/react at the bundled Monaco and wire the
// same-origin web workers. MUST run before the editor first renders.
import './monacoSetup'
import { languageForPath } from './language'
import { MenuButton } from './components/MenuButton'
import { FONT_SIZES, useEditorPrefs } from './lib/editorPrefs'
import { claimTabSession, saveTabSession } from './lib/tabSession'

// Types are derived from the OnMount callback so we never deep-import Monaco's
// own type modules here — Monaco stays a runtime-only, lazily-loaded dependency.
type StandaloneEditor = Parameters<OnMount>[0]
type MonacoInstance = Parameters<OnMount>[1]
type TextModel = NonNullable<ReturnType<StandaloneEditor['getModel']>>
type ViewState = ReturnType<StandaloneEditor['saveViewState']>
type Disposable = ReturnType<TextModel['onDidChangeContent']>

type Tab = {
  /** Stable per-file id — also the Monaco model URI. Unique across roots. */
  id: string
  /** null until the buffer has been written somewhere (a New File tab). */
  root: string | null
  path: string | null
  name: string
  language: string
}

const decoder = new TextDecoder()
const encoder = new TextEncoder()

/** A Monaco model URI unique per `{root, path}`, valid to `Uri.parse`. */
function tabId(root: string, path: string): string {
  const clean = path.replace(/^\/+/, '')
  return `file:///${encodeURI(root)}/${encodeURI(clean)}`
}

/**
 * Reject the characters that make a *name* not a name. Path separators are the
 * real target: the backend's `resolveSafe` would refuse them anyway, but a
 * clear message beats a 400 the user has to interpret.
 */
function invalidNameReason(name: string): string | null {
  if (!name) return 'Enter a name.'
  if (name.includes('/') || name.includes('\\')) return 'A name cannot contain slashes.'
  if (name === '.' || name === '..') return 'That name is reserved.'
  // Control characters, checked by code point rather than a regex literal —
  // a regex with a raw \x00 in it is unreadable and lint-hostile.
  if ([...name].some((c) => (c.codePointAt(0) ?? 0) < 0x20))
    return 'That name contains an invalid character.'
  return null
}

export function CodeEditor({ windowId }: { windowId: string }) {
  // One-shot open intent, drained by the shared hook (StrictMode-safe).
  const source = useOpenIntent(windowId)

  // Lets the app open a file on its own instead of dead-ending on
  // "open one from Files". The pick latches into the same store
  // useOpenIntent reads, so the existing load path runs unchanged.
  const { openFile, saveFile, pickDirectory, fileDialog } = useFileDialog(windowId)
  const { confirm, confirmDialog } = useConfirm()
  const { prompt, promptDialog } = usePrompt()
  const pickFile = () => void openFile({})

  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set())
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const prefs = useEditorPrefs()
  const setPref = useEditorPrefs((s) => s.set)

  const editorRef = useRef<StandaloneEditor | null>(null)
  const monacoRef = useRef<MonacoInstance | null>(null)
  const modelsRef = useRef<Map<string, TextModel>>(new Map())
  const viewStatesRef = useRef<Map<string, ViewState>>(new Map())
  const listenersRef = useRef<Map<string, Disposable>>(new Map())
  // Alternative-version-id captured at last save; drives an undo-aware dirty flag.
  const savedVersionRef = useRef<Map<string, number>>(new Map())
  // Decoded file contents awaiting model creation (once the editor is mounted).
  const pendingContentRef = useRef<Map<string, string>>(new Map())
  const openedIdsRef = useRef<Set<string>>(new Set())
  const lastActiveRef = useRef<string | null>(null)
  const untitledSeqRef = useRef(0)

  const activeTab = tabs.find((t) => t.id === activeId) ?? null
  const activeName = activeTab?.name ?? ''
  const anyDirty = dirtyIds.size > 0

  // Reflect the active filename + a dirty marker in the window title, and warn
  // before closing while any tab has unsaved changes.
  useUnsavedGuard(windowId, anyDirty, activeName)

  const theme = useMemo(
    () =>
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
        ? 'vs-dark'
        : 'vs',
    []
  )

  const options = useMemo(
    () => ({
      automaticLayout: true,
      fontSize: prefs.fontSize,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      minimap: { enabled: prefs.minimap },
      wordWrap: (prefs.wordWrap ? 'on' : 'off') as 'on' | 'off',
      bracketPairColorization: { enabled: true },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      tabSize: 2,
    }),
    [prefs.fontSize, prefs.minimap, prefs.wordWrap]
  )

  // Recompute the dirty flag for one tab from its model's alternative version id
  // (so a full undo back to the saved state clears dirty, an edit re-sets it).
  const recomputeDirty = useCallback((id: string) => {
    const model = modelsRef.current.get(id)
    if (!model) return
    const isDirty = model.getAlternativeVersionId() !== savedVersionRef.current.get(id)
    setDirtyIds((prev) => {
      const has = prev.has(id)
      if (has === isDirty) return prev
      const next = new Set(prev)
      if (isDirty) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const handleMount = useCallback<OnMount>((editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    // Drop the auto-created empty model; tab models are set on activation.
    const initial = editor.getModel()
    editor.setModel(null)
    initial?.dispose()
    setReady(true)
  }, [])

  // Ensure the active tab has a model, then swap the editor to it while
  // preserving each tab's scroll/cursor (view) state.
  useEffect(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco || !ready || !activeId) return
    const tab = tabs.find((t) => t.id === activeId)
    if (!tab) return

    let model = modelsRef.current.get(activeId)
    if (!model) {
      const content = pendingContentRef.current.get(activeId) ?? ''
      pendingContentRef.current.delete(activeId)
      model = monaco.editor.createModel(content, tab.language, monaco.Uri.parse(activeId))
      modelsRef.current.set(activeId, model)
      savedVersionRef.current.set(activeId, model.getAlternativeVersionId())
      const created = model
      listenersRef.current.set(
        activeId,
        created.onDidChangeContent(() => recomputeDirty(tab.id))
      )
    }

    const prev = lastActiveRef.current
    if (prev && prev !== activeId) {
      const prevState = editor.saveViewState()
      viewStatesRef.current.set(prev, prevState)
    }
    if (editor.getModel() !== model) {
      editor.setModel(model)
      const saved = viewStatesRef.current.get(activeId)
      if (saved) editor.restoreViewState(saved)
    }
    lastActiveRef.current = activeId
    editor.focus()
  }, [activeId, ready, tabs, recomputeDirty])

  /**
   * Everything that becomes a tab arrives here: the launch intent, the Open
   * dialog (which latches into the same store the intent reads) and the tabs
   * restored from the session record. One loader, so there is no second way for
   * a file to become a tab and drift from this one.
   *
   * Deliberately not cancelled on cleanup. StrictMode runs this effect twice on
   * mount and `claimTabSession` only answers once, so a cancel-on-cleanup guard
   * would throw away the restored tabs the first run had already started
   * fetching and the second run would no longer ask for. Re-entry is prevented
   * by `openedIdsRef` instead, which is the guard that actually matters — and a
   * late state update after the window closes is a no-op in React 19.
   */
  useEffect(() => {
    const targets = claimTabSession()
    if (source) targets.push({ root: source.root, path: source.path })
    if (targets.length === 0) return

    const toLoad: { id: string; root: string; path: string }[] = []
    const alreadyOpen: string[] = []
    for (const t of targets) {
      const id = tabId(t.root, t.path)
      // Already open: it gets focused, not re-read. Re-reading would replace a
      // buffer that may hold unsaved edits.
      if (openedIdsRef.current.has(id)) {
        alreadyOpen.push(id)
        continue
      }
      openedIdsRef.current.add(id)
      toLoad.push({ id, root: t.root, path: t.path })
    }
    if (toLoad.length === 0 && alreadyOpen.length === 0) return

    // Every state update below happens inside the async body, one microtask
    // after this commit — never synchronously inside it, which would cascade a
    // render out of the effect that scheduled it.
    void (async () => {
      if (toLoad.length === 0) {
        // Every target was already open: bring the last one forward.
        setActiveId(alreadyOpen[alreadyOpen.length - 1])
        return
      }
      setLoading(true)
      setError(null)
      for (const t of toLoad) {
        try {
          const bytes = await fetchFileBytes(t.root, t.path)
          pendingContentRef.current.set(t.id, decoder.decode(bytes))
          const tab: Tab = {
            id: t.id,
            root: t.root,
            path: t.path,
            name: fileName(t.path, 'untitled'),
            language: languageForPath(t.path),
          }
          setTabs((prev) => (prev.some((x) => x.id === tab.id) ? prev : [...prev, tab]))
          setActiveId(t.id)
        } catch (err) {
          // One unreadable file (deleted since the session was recorded, say)
          // must not stop the rest of the set from opening.
          openedIdsRef.current.delete(t.id)
          console.error('[code-editor] failed to open', t.path, err)
          setError('Could not open this file.')
        }
      }
      setLoading(false)
    })()
  }, [source])

  // Record the on-disk tabs for this session on every change.
  useEffect(() => {
    saveTabSession(
      tabs
        .filter(
          (t): t is Tab & { root: string; path: string } => t.root !== null && t.path !== null
        )
        .map((t) => ({ root: t.root, path: t.path }))
    )
  }, [tabs])

  // Dispose every model + listener when the window closes.
  useEffect(() => {
    const models = modelsRef.current
    const listeners = listenersRef.current
    return () => {
      listeners.forEach((d) => d.dispose())
      models.forEach((m) => m.dispose())
      listeners.clear()
      models.clear()
    }
  }, [])

  /**
   * Write one tab's buffer to `{root, path}`. Runs format-on-save first when it
   * is enabled, and only then reads the text — formatting after the read would
   * store the unformatted bytes and leave the buffer looking modified.
   */
  const writeTab = useCallback(
    async (id: string, root: string, path: string, name: string): Promise<boolean> => {
      const model = modelsRef.current.get(id)
      if (!model) return false
      setSaving(true)
      setError(null)
      try {
        if (useEditorPrefs.getState().formatOnSave && editorRef.current?.getModel() === model) {
          // No formatter for this language is not a failure — the action
          // resolves having done nothing, and the save proceeds.
          await editorRef.current.getAction('editor.action.formatDocument')?.run()
        }
        // Snapshot after formatting: if the user edits mid-flight the version
        // advances and the tab stays dirty (those edits aren't on disk yet).
        const uploadedVersion = model.getAlternativeVersionId()
        const text = model.getValue()
        await uploadFileBytes(root, path, encoder.encode(text), name)
        savedVersionRef.current.set(id, uploadedVersion)
        recomputeDirty(id)
        return true
      } catch (err) {
        if (err instanceof UploadTooLargeError) {
          setError(err.message)
        } else {
          console.error('[code-editor] failed to save', err)
          setError('Could not save this file.')
        }
        return false
      } finally {
        setSaving(false)
      }
    },
    [recomputeDirty]
  )

  const handleSaveAs = useCallback(async () => {
    const tab = tabs.find((t) => t.id === activeId)
    if (!tab || saving) return
    const choice = await saveFile({ title: 'Save as', suggestedName: tab.name })
    if (!choice) return

    const newId = tabId(choice.root, choice.path)
    if (newId !== tab.id && tabs.some((t) => t.id === newId)) {
      // Retargeting onto an id another tab owns would leave two tabs sharing one
      // Monaco model URI, and the loser's unsaved edits would vanish with it.
      setError('That file is already open in another tab.')
      return
    }

    const name = fileName(choice.path, tab.name)
    const ok = await writeTab(tab.id, choice.root, choice.path, name)
    if (!ok || newId === tab.id) return

    // The model URI is immutable, so retargeting means moving the buffer to a
    // new model. Hand the text to pendingContent and let the activation effect
    // build it, rather than duplicating model creation here.
    const oldId = tab.id
    const model = modelsRef.current.get(oldId)
    const value = model?.getValue() ?? ''
    const editor = editorRef.current
    const viewState = editor?.saveViewState() ?? null
    if (editor && model && editor.getModel() === model) editor.setModel(null)
    listenersRef.current.get(oldId)?.dispose()
    listenersRef.current.delete(oldId)
    model?.dispose()
    modelsRef.current.delete(oldId)
    viewStatesRef.current.delete(oldId)
    savedVersionRef.current.delete(oldId)
    pendingContentRef.current.delete(oldId)
    openedIdsRef.current.delete(oldId)
    openedIdsRef.current.add(newId)
    if (lastActiveRef.current === oldId) lastActiveRef.current = null

    pendingContentRef.current.set(newId, value)
    if (viewState) viewStatesRef.current.set(newId, viewState)
    setTabs((prev) =>
      prev.map((t) =>
        t.id === oldId
          ? {
              id: newId,
              root: choice.root,
              path: choice.path,
              name,
              language: languageForPath(choice.path),
            }
          : t
      )
    )
    setDirtyIds((prev) => {
      if (!prev.has(oldId)) return prev
      const next = new Set(prev)
      next.delete(oldId)
      return next
    })
    setActiveId(newId)
  }, [activeId, tabs, saving, saveFile, writeTab])

  const handleSave = useCallback(async () => {
    const tab = tabs.find((t) => t.id === activeId)
    if (!tab || saving) return
    // A New File tab has no home yet; Save is Save As until it does.
    if (tab.root === null || tab.path === null) {
      await handleSaveAs()
      return
    }
    await writeTab(tab.id, tab.root, tab.path, tab.name)
  }, [activeId, tabs, saving, writeTab, handleSaveAs])

  // Ctrl/Cmd+S saves the active tab — only for the top-most window.
  useSaveHotkey(windowId, handleSave)

  const handleNewFile = useCallback(async () => {
    const raw = await prompt({
      title: 'New file',
      message: 'Include the extension — it decides the syntax highlighting.',
      placeholder: 'script.ts',
      confirmLabel: 'Create',
    })
    if (raw === null) return
    const name = raw.trim()
    const reason = invalidNameReason(name)
    if (reason) {
      setError(reason)
      return
    }
    // Untitled until saved: the buffer is real, the file is not. Save As is what
    // gives it a home, which is also where the user gets to choose one.
    const id = `untitled:///${++untitledSeqRef.current}/${encodeURIComponent(name)}`
    pendingContentRef.current.set(id, '')
    openedIdsRef.current.add(id)
    setError(null)
    setTabs((prev) => [
      ...prev,
      { id, root: null, path: null, name, language: languageForPath(name) },
    ])
    setActiveId(id)
  }, [prompt])

  const handleNewFolder = useCallback(async () => {
    const where = await pickDirectory({ title: 'New folder — choose where' })
    if (!where) return
    const raw = await prompt({
      title: 'New folder',
      message: `Inside /${where.path}`,
      placeholder: 'src',
      confirmLabel: 'Create',
    })
    if (raw === null) return
    const name = raw.trim()
    const reason = invalidNameReason(name)
    if (reason) {
      setError(reason)
      return
    }
    try {
      await api.post('/files/directory', {
        root: where.root,
        path: where.path ? `${where.path}/${name}` : name,
      })
      setError(null)
    } catch (err) {
      console.error('[code-editor] failed to create folder', err)
      setError('Could not create that folder.')
    }
  }, [pickDirectory, prompt])

  const closeTab = useCallback(
    async (id: string) => {
      const tab = tabs.find((t) => t.id === id)
      if (dirtyIds.has(id)) {
        const ok = await confirm({
          title: 'Unsaved changes',
          message: `"${tab?.name ?? 'This file'}" has unsaved changes. Close without saving?`,
          confirmLabel: 'Discard',
          destructive: true,
        })
        if (!ok) return
      }
      const model = modelsRef.current.get(id)
      const editor = editorRef.current
      // Detach before dispose — leaving the editor holding a disposed model
      // throws on its next layout pass.
      if (editor && model && editor.getModel() === model) editor.setModel(null)
      listenersRef.current.get(id)?.dispose()
      listenersRef.current.delete(id)
      model?.dispose()
      modelsRef.current.delete(id)
      viewStatesRef.current.delete(id)
      savedVersionRef.current.delete(id)
      pendingContentRef.current.delete(id)
      openedIdsRef.current.delete(id)
      if (lastActiveRef.current === id) lastActiveRef.current = null

      const remaining = tabs.filter((t) => t.id !== id)
      setTabs(remaining)
      setDirtyIds((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      if (activeId === id) {
        const idx = tabs.findIndex((t) => t.id === id)
        const nextTab = remaining[idx] ?? remaining[idx - 1] ?? null
        setActiveId(nextTab?.id ?? null)
      }
    },
    [tabs, dirtyIds, activeId, confirm]
  )

  const goToLine = useCallback(() => {
    editorRef.current?.focus()
    void editorRef.current?.getAction('editor.action.gotoLine')?.run()
  }, [])

  const findInFile = useCallback(() => {
    editorRef.current?.focus()
    void editorRef.current?.getAction('actions.find')?.run()
  }, [])

  const formatNow = useCallback(() => {
    editorRef.current?.focus()
    void editorRef.current?.getAction('editor.action.formatDocument')?.run()
  }, [])

  const hasTabs = tabs.length > 0
  const activeDirty = activeId != null && dirtyIds.has(activeId)

  return (
    <div className="bg-surface-container-lowest flex h-full flex-col">
      {/* Menu bar + Save. The menus own the file operations; Save stays a button
          because it is the one action used often enough to deserve one. */}
      <div className="border-outline-variant bg-surface-container-low flex items-center gap-1 border-b px-1 py-0.5">
        <MenuButton
          label="File"
          items={[
            { label: 'New File…', hint: 'name + extension', onSelect: () => void handleNewFile() },
            { label: 'New Folder…', onSelect: () => void handleNewFolder() },
            { type: 'separator' },
            { label: 'Open…', onSelect: pickFile },
            { type: 'separator' },
            {
              label: 'Save',
              hint: 'Ctrl+S',
              disabled: !activeTab || saving,
              onSelect: () => void handleSave(),
            },
            {
              label: 'Save As…',
              disabled: !activeTab || saving,
              onSelect: () => void handleSaveAs(),
            },
            { type: 'separator' },
            {
              label: 'Close Tab',
              disabled: !activeId,
              onSelect: () => {
                if (activeId) void closeTab(activeId)
              },
            },
          ]}
        />

        <MenuButton
          label="Edit"
          items={[
            { label: 'Find…', hint: 'Ctrl+F', disabled: !activeTab, onSelect: findInFile },
            { label: 'Go to Line…', hint: 'Ctrl+G', disabled: !activeTab, onSelect: goToLine },
            { type: 'separator' },
            {
              label: 'Format Document',
              hint: 'Shift+Alt+F',
              disabled: !activeTab,
              onSelect: formatNow,
            },
          ]}
        />

        <MenuButton
          label="View"
          items={[
            {
              label: 'Minimap',
              checked: prefs.minimap,
              onSelect: () => setPref('minimap', !prefs.minimap),
            },
            {
              label: 'Word Wrap',
              checked: prefs.wordWrap,
              onSelect: () => setPref('wordWrap', !prefs.wordWrap),
            },
            {
              label: 'Format on Save',
              checked: prefs.formatOnSave,
              onSelect: () => setPref('formatOnSave', !prefs.formatOnSave),
            },
            { type: 'separator' },
            ...FONT_SIZES.map((size) => ({
              label: `Font size ${size}`,
              checked: prefs.fontSize === size,
              onSelect: () => setPref('fontSize', size),
            })),
          ]}
        />

        <div className="w-1" />

        <Tooltip content="Save (Ctrl+S)">
          <Button
            variant="default"
            size="sm"
            className="flex items-center gap-1"
            onClick={() => void handleSave()}
            disabled={saving || loading || !activeDirty}
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save
          </Button>
        </Tooltip>

        <div className="flex-1" />

        {error && (
          <span className="text-error font-ui mr-2 max-w-[280px] truncate text-[11px]">
            {error}
          </span>
        )}
        <span className="font-ui text-on-surface-variant max-w-[220px] truncate text-[11px]">
          {activeName}
          {activeDirty ? ' •' : ''}
        </span>
      </div>

      {/* Tab strip — one entry per open file (each its own Monaco model). */}
      {hasTabs && (
        <div className="border-outline-variant bg-surface-container-low flex items-stretch gap-px overflow-x-auto border-b">
          {tabs.map((tab) => {
            const isActive = tab.id === activeId
            const isDirty = dirtyIds.has(tab.id)
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onMouseDown={() => setActiveId(tab.id)}
                className={cn(
                  'font-ui group flex max-w-[200px] cursor-pointer items-center gap-1.5 px-2.5 py-1 text-[11px] whitespace-nowrap',
                  isActive
                    ? 'bg-surface-container-lowest text-on-surface'
                    : 'text-on-surface-variant hover:bg-surface-container-high'
                )}
                title={tab.path ?? `${tab.name} — not saved yet`}
              >
                <span className="truncate">{tab.name}</span>
                <button
                  type="button"
                  aria-label={`Close ${tab.name}`}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    void closeTab(tab.id)
                  }}
                  className={cn(
                    'hover:bg-surface-container-highest flex h-4 w-4 items-center justify-center rounded-sm',
                    isDirty ? 'text-on-surface' : 'text-on-surface-variant'
                  )}
                >
                  {isDirty ? (
                    <span className="bg-on-surface-variant h-1.5 w-1.5 rounded-full group-hover:hidden" />
                  ) : null}
                  <X size={12} className={cn(isDirty && 'hidden group-hover:block')} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Editor surface — Monaco is always mounted so its instance is stable;
          an overlay covers it before any file is open. */}
      <div className="relative min-h-0 flex-1">
        <Editor
          theme={theme}
          options={options}
          onMount={handleMount}
          keepCurrentModel
          loading={
            <div className="text-on-surface-variant font-ui flex items-center gap-2 text-[12px]">
              <Loader2 size={16} className="animate-spin" />
              Loading editor…
            </div>
          }
        />

        {loading && (
          <div className="bg-surface-container-lowest text-on-surface-variant font-ui absolute inset-0 flex items-center justify-center gap-2 text-[12px]">
            <Loader2 size={16} className="animate-spin" />
            Loading file…
          </div>
        )}

        {!hasTabs && !loading && (
          <div className="bg-surface-container-lowest text-on-surface-variant absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
            <FileCode2 size={40} strokeWidth={1} />
            <span className="font-ui text-[12px]">Nothing open</span>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="primary" onClick={pickFile}>
                Open a file
              </Button>
              <Button size="sm" variant="default" onClick={() => void handleNewFile()}>
                New file
              </Button>
            </div>
          </div>
        )}
      </div>

      {fileDialog}
      {confirmDialog}
      {promptDialog}
    </div>
  )
}
