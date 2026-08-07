import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileCode2, Loader2, Save, X } from 'lucide-react'
import Editor, { type OnMount } from '@monaco-editor/react'
import {
  Button,
  Tooltip,
  UploadTooLargeError,
  cn,
  fileName,
  useConfirm,
  useFileDialog,
  useOpenIntent,
  usePrompt,
  useSaveHotkey,
  useSystem,
  useSystemAppearance,
  useUnsavedGuard,
} from '@imbatranim/ui'
// Side-effect: point @monaco-editor/react at the bundled Monaco and wire the
// same-origin web workers. MUST run before the editor first renders.
import './monacoSetup'
import { languageForPath } from './language'
import { MenuButton } from './components/MenuButton'
import { SearchPanel } from './components/SearchPanel'
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

export function CodeEditor({ windowId: _windowId }: { windowId: string }) {
  const system = useSystem()

  // One-shot open intent, drained by the shared hook (StrictMode-safe).
  const source = useOpenIntent()

  // Lets the app open a file on its own instead of dead-ending on
  // "open one from Files". The pick latches into the same store
  // useOpenIntent reads, so the existing load path runs unchanged.
  const { openFile, saveFile, pickDirectory } = useFileDialog()
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
  /** Find-in-files panel (brief 113) — window state, nothing persisted. */
  const [findOpen, setFindOpen] = useState(false)
  const findInputRef = useRef<HTMLInputElement>(null)

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
  /**
   * Lines to reveal once a tab's model is live (brief 113). The activation
   * effect drains this AFTER `restoreViewState`, because restoring a saved
   * scroll position would otherwise undo the reveal we just performed.
   */
  const pendingRevealRef = useRef<Map<string, number>>(new Map())
  const lastActiveRef = useRef<string | null>(null)
  const untitledSeqRef = useRef(0)

  const activeTab = tabs.find((t) => t.id === activeId) ?? null
  const activeName = activeTab?.name ?? ''
  const anyDirty = dirtyIds.size > 0

  // Subscribed, not read once at mount: changing the desktop appearance in
  // Settings has to restyle an already-open editor, which a `useMemo(…, [])`
  // over `matchMedia` could not do (it froze Monaco's theme at mount).
  const { theme: appearanceTheme } = useSystemAppearance()
  const theme = appearanceTheme === 'dark' ? 'vs-dark' : 'vs'

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
    // A find-in-files click asked for a line. Do it after restoreViewState —
    // in the other order the restored scroll position wins and the reveal is
    // silently undone. Best-effort by design: an already-open dirty buffer may
    // have drifted from what is on disk, and moving the cursor to roughly the
    // right place beats refusing to move it at all.
    const reveal = pendingRevealRef.current.get(activeId)
    if (reveal !== undefined) {
      pendingRevealRef.current.delete(activeId)
      const line = Math.min(Math.max(1, reveal), model.getLineCount())
      editor.revealLineInCenter(line)
      editor.setPosition({ lineNumber: line, column: 1 })
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
  const openTargets = useCallback(
    async (targets: { root: string; path: string; revealLine?: number }[]) => {
      if (targets.length === 0) return

      const toLoad: { id: string; root: string; path: string }[] = []
      const alreadyOpen: string[] = []
      for (const t of targets) {
        const id = tabId(t.root, t.path)
        // Queue the reveal whether or not the tab is new: the activation effect
        // is the single place it is applied.
        if (t.revealLine !== undefined) pendingRevealRef.current.set(id, t.revealLine)
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

      if (toLoad.length === 0) {
        // Every target was already open: bring the last one forward.
        const id = alreadyOpen[alreadyOpen.length - 1]
        setActiveId(id)
        // Re-clicking a result for the tab that is ALREADY active changes no
        // state, so the activation effect will not re-run and the queued reveal
        // would sit there forever. Apply it here instead.
        const pending = pendingRevealRef.current.get(id)
        const editor = editorRef.current
        const model = modelsRef.current.get(id)
        if (pending !== undefined && editor && model && lastActiveRef.current === id) {
          pendingRevealRef.current.delete(id)
          const line = Math.min(Math.max(1, pending), model.getLineCount())
          editor.revealLineInCenter(line)
          editor.setPosition({ lineNumber: line, column: 1 })
          editor.focus()
        }
        return
      }
      setLoading(true)
      setError(null)
      for (const t of toLoad) {
        try {
          const bytes = await system.fs.read(t.root, t.path)
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
          pendingRevealRef.current.delete(t.id)
          console.error('[code-editor] failed to open', t.path, err)
          setError('Could not open this file.')
        }
      }
      setLoading(false)
    },
    [system]
  )

  /**
   * Open one file, optionally landing on a line. The find-in-files panel's
   * only door into the editor — the same door the intent and the session
   * restore use, so there is still exactly one way for a file to become a tab.
   */
  const openPath = useCallback(
    (root: string, path: string, opts: { revealLine?: number } = {}) => {
      void openTargets([{ root, path, revealLine: opts.revealLine }])
    },
    [openTargets]
  )

  useEffect(() => {
    const targets = claimTabSession()
    if (source) targets.push({ root: source.root, path: source.path })
    if (targets.length === 0) return
    // Hop a microtask before touching state. `openTargets` reaches setState
    // synchronously on one path (everything already open), and a render
    // cascading out of the effect that scheduled it is exactly what the old
    // inline async IIFE existed to avoid. `claimTabSession` still runs here,
    // synchronously, because it answers only once.
    void Promise.resolve().then(() => openTargets(targets))
  }, [source, openTargets])

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
        await system.fs.upload(root, path, encoder.encode(text), name)
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
    [recomputeDirty, system]
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
  useSaveHotkey(handleSave)

  /** Open the find-in-files panel and put the caret in its box. */
  const openFindInFiles = useCallback(() => {
    setFindOpen(true)
    // The input mounts in this commit; focus it once it exists. A rAF rather
    // than an effect keeps the "focus on demand" intent local to the action.
    requestAnimationFrame(() => findInputRef.current?.focus())
  }, [])

  const closeFindInFiles = useCallback(() => {
    setFindOpen(false)
    // After the commit that unmounts the panel, not before it: focusing while
    // the panel's input is still mounted lets the unmount put focus back on
    // <body>, and the caret never reaches Monaco. Same rAF as opening.
    requestAnimationFrame(() => editorRef.current?.focus())
  }, [])

  /**
   * Ctrl+Shift+F, on the `useSaveHotkey` pattern: a window-level CAPTURE
   * listener gated on `system.window.isFocused()`.
   *
   * Not `useTopWindowKeydown` — its default ignores text entry, and focus in
   * this app almost always sits in Monaco's own textarea, so the binding would
   * be dead exactly when it is wanted. Capture phase so Monaco cannot swallow
   * it first, and it must not shadow Ctrl+F (Monaco's in-file find) or Ctrl+S.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return
      if (e.key.toLowerCase() !== 'f') return
      if (!system.window.isFocused()) return
      e.preventDefault()
      e.stopPropagation()
      openFindInFiles()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [system, openFindInFiles])

  // Save-and-close writes every dirty tab that has a home on disk. A homeless
  // (untitled) dirty tab cannot be batch-saved — a Save-As picker stacked under
  // the close dialog would be two competing questions — so it stays dirty and
  // the close is honestly aborted with the work intact.
  const handleSaveAllDirty = useCallback(async () => {
    for (const tab of tabs) {
      if (!dirtyIds.has(tab.id)) continue
      if (tab.root === null || tab.path === null) continue
      await writeTab(tab.id, tab.root, tab.path, tab.name)
    }
  }, [tabs, dirtyIds, writeTab])

  // Reflect the active filename + a dirty marker in the window title, and ask
  // Save / Don't Save / Cancel before closing while any tab has unsaved changes.
  const unsavedDialog = useUnsavedGuard(anyDirty, activeName, handleSaveAllDirty)

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
      await system.http.post('/files/directory', {
        root: where.root,
        path: where.path ? `${where.path}/${name}` : name,
      })
      setError(null)
    } catch (err) {
      console.error('[code-editor] failed to create folder', err)
      setError('Could not create that folder.')
    }
  }, [pickDirectory, prompt, system])

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
            // Deliberately NOT disabled without a tab: searching the project is
            // how you find the file to open in the first place.
            { label: 'Find in Files…', hint: 'Ctrl+Shift+F', onSelect: openFindInFiles },
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
                    'hover:bg-surface-container-highest flex h-4 w-4 items-center justify-center',
                    isDirty ? 'text-on-surface' : 'text-on-surface-variant'
                  )}
                >
                  {isDirty ? (
                    <span className="bg-on-surface-variant h-1.5 w-1.5 group-hover:hidden" />
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

      {findOpen && (
        <SearchPanel
          root={activeTab?.root ?? 'home'}
          inputRef={findInputRef}
          onClose={closeFindInFiles}
          onOpenAt={(path, line) => openPath(activeTab?.root ?? 'home', path, { revealLine: line })}
          onPickScope={async () => {
            const picked = await pickDirectory({ title: 'Search in folder' })
            return picked ? picked.path : null
          }}
        />
      )}

      {confirmDialog}
      {promptDialog}
      {unsavedDialog}
    </div>
  )
}
