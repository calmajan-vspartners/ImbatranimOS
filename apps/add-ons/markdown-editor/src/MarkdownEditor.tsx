import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, PanelLeft, Save, Unlink2, Link2 } from 'lucide-react'
import {
  Button,
  ScrollArea,
  Tooltip,
  UploadTooLargeError,
  api,
  cn,
  fetchFileBytes,
  fileName,
  notify,
  openApp,
  uploadFileBytes,
  useElementSize,
  useFileDialog,
  useOpenIntent,
  useSaveHotkey,
  useUnsavedGuard,
} from '@imbatranim/core'
import { VIEW_MODE_OPTIONS, type ViewMode } from './viewMode'
import { FormatToolbar } from './components/FormatToolbar'
import { MarkdownPreview } from './components/MarkdownPreview'
import { Outline } from './components/Outline'
import { SplitDivider } from './components/SplitDivider'
import { applyFormat, keyToFormat, type FormatKind } from './lib/formatActions'
import { minimalEdit } from './lib/minimalEdit'
import { toggleTaskAtLine } from './lib/markdownMarkers'
import { caretLineOf, IMAGE_EXTENSIONS } from './lib/editorText'
import { parseHeadings } from './lib/outline'
import {
  assetDir,
  dirOf,
  extensionForMime,
  imageMarkdown,
  relativeFrom,
  safeBaseName,
  uniqueName,
} from './lib/assetPaths'
import { useLineTops } from './hooks/useLineTops'
import { useScrollSync } from './hooks/useScrollSync'
import { useMarkdownView } from './store/markdownViewStore'

const decoder = new TextDecoder()
const encoder = new TextEncoder()

type FsEntry = { name: string; path: string; type: 'file' | 'directory' }

export function MarkdownEditor({ windowId }: { windowId: string }) {
  // One-shot open intent, drained by the shared hook (StrictMode-safe).
  const source = useOpenIntent(windowId)

  // Two dialogs, deliberately. The window-scoped one latches its choice into the
  // opened-file store, which is what makes "Open a Markdown file" work with no second
  // load path — and exactly what must NOT happen when picking an image to insert, since
  // that would replace the document being edited.
  const { openFile, fileDialog } = useFileDialog(windowId)
  const { openFile: pickAsset, fileDialog: assetDialog } = useFileDialog()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [imageBusy, setImageBusy] = useState(false)
  const [text, setText] = useState('')
  const [savedText, setSavedText] = useState('')
  const [caretLine, setCaretLine] = useState(1)

  const { settings, update, dragRatio, commitRatio } = useMarkdownView()
  const mode = settings.mode

  // Elements the sync hooks measure. Held as state, not refs: a ref's `.current` does not
  // re-run an effect when the node attaches, and the pane mounts several renders after
  // the window does (the open intent is drained in an effect) — the exact class of bug
  // core's `useElementSize` exists to document.
  const [editorEl, setEditorEl] = useState<HTMLTextAreaElement | null>(null)
  const [previewEl, setPreviewEl] = useState<HTMLDivElement | null>(null)
  const attachEditor = useCallback((el: HTMLTextAreaElement | null) => setEditorEl(el), [])
  const attachPreview = useCallback((el: HTMLDivElement | null) => setPreviewEl(el), [])
  const [paneBox, attachPanes] = useElementSize()

  const textRef = useRef(text)
  useEffect(() => {
    textRef.current = text
  }, [text])

  const name = source ? fileName(source.path, 'untitled.md') : ''
  const docDir = source ? dirOf(source.path) : ''
  const dirty = text !== savedText
  const showEditor = mode === 'editor' || mode === 'split'
  const showPreview = mode === 'preview' || mode === 'split'
  const headings = useMemo(() => parseHeadings(text), [text])

  useUnsavedGuard(windowId, dirty, name)

  // Load the file's bytes and decode as UTF-8 text whenever a new file is opened.
  useEffect(() => {
    if (!source) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const bytes = await fetchFileBytes(source.root, source.path)
        if (cancelled) return
        const decoded = decoder.decode(bytes)
        setText(decoded)
        setSavedText(decoded)
      } catch (err) {
        if (!cancelled) {
          console.error('[markdown-editor] failed to open', err)
          setError('Could not open this file.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [source])

  const handleSave = useCallback(async () => {
    if (!source || saving) return
    // Record the exact text being uploaded. If the user edits while the upload is in
    // flight, `textRef.current` moves on — only clear dirty when no further edits landed,
    // so those in-flight edits aren't clobbered.
    const uploadedText = text
    setSaving(true)
    setError(null)
    try {
      await uploadFileBytes(source.root, source.path, encoder.encode(uploadedText), name)
      if (textRef.current === uploadedText) setSavedText(uploadedText)
    } catch (err) {
      if (err instanceof UploadTooLargeError) {
        setError(err.message)
      } else {
        console.error('[markdown-editor] failed to save', err)
        setError('Could not save this file.')
      }
    } finally {
      setSaving(false)
    }
  }, [source, saving, text, name])

  // Ctrl/Cmd+S saves — but only for the top-most window.
  useSaveHotkey(windowId, handleSave)

  const lineTops = useLineTops(editorEl, text, settings.syncScroll && mode === 'split')
  useScrollSync({
    editor: editorEl,
    preview: previewEl,
    lineTops,
    enabled: settings.syncScroll && mode === 'split',
  })

  /**
   * Write an edit through the browser's own editing pipeline rather than through React
   * state.
   *
   * `execCommand('insertText')` is deprecated and it is still the only way to change a
   * textarea without destroying its undo stack — assigning `value` (which is what a state
   * update does) clears it, so a single Bold click would cost the user every undo step
   * they had. The `input` event it fires reaches `onChange`, so state updates as usual.
   * If the command is unavailable the state path is the fallback: worse undo, same text.
   */
  const applyEdit = useCallback(
    (el: HTMLTextAreaElement, next: { text: string; start: number; end: number }) => {
      const edit = minimalEdit(el.value, next.text)
      el.focus()
      el.setSelectionRange(edit.start, edit.end)
      const handled = (() => {
        try {
          return edit.insert === ''
            ? document.execCommand('delete')
            : document.execCommand('insertText', false, edit.insert)
        } catch {
          return false
        }
      })()
      if (!handled) setText(next.text)
      // After the DOM has the new value: the browser puts the caret at the end of what it
      // inserted, which is not where the marker helpers want it.
      requestAnimationFrame(() => {
        el.setSelectionRange(next.start, next.end)
        setCaretLine(caretLineOf(el.value, next.start))
      })
    },
    []
  )

  const applyFormatting = useCallback(
    (kind: FormatKind) => {
      const el = editorEl
      if (!el) return
      applyEdit(el, applyFormat(kind, el.value, { start: el.selectionStart, end: el.selectionEnd }))
    },
    [applyEdit, editorEl]
  )

  const insertAtCaret = useCallback(
    (snippet: string) => {
      const el = editorEl
      if (!el) return
      const start = el.selectionStart
      const end = el.selectionEnd
      const nextText = el.value.slice(0, start) + snippet + el.value.slice(end)
      applyEdit(el, { text: nextText, start: start + snippet.length, end: start + snippet.length })
    },
    [applyEdit, editorEl]
  )

  /** Names already taken in a directory, plus whether it holds an `assets/` folder. */
  const readDirectory = useCallback(async (root: string, path: string) => {
    const res = await api.get<FsEntry[]>('/files', { params: { root, path } })
    return {
      names: res.data.map((entry) => entry.name),
      hasAssets: res.data.some((entry) => entry.type === 'directory' && entry.name === 'assets'),
    }
  }, [])

  /**
   * Write an image into the document's own directory and link it relatively.
   *
   * The point of doing this in an OS rather than a web app: the bytes land in a real file
   * next to the document, so the link still works in git, in another editor, or on
   * GitHub. A base64 data URI would have been far less code and would have produced a
   * document nothing else can read comfortably.
   */
  const attachImageBytes = useCallback(
    async (bytes: ArrayBuffer, suggestedName: string, mime: string) => {
      if (!source) return
      setImageBusy(true)
      try {
        const here = await readDirectory(source.root, docDir)
        const targetDir = assetDir(docDir, here.hasAssets)
        const taken =
          targetDir === docDir ? here.names : (await readDirectory(source.root, targetDir)).names
        const base = safeBaseName(suggestedName)
        const file = uniqueName(taken, base, extensionForMime(mime))
        const target = targetDir === '' ? file : `${targetDir}/${file}`
        await uploadFileBytes(source.root, target, bytes, file)
        insertAtCaret(imageMarkdown(base, relativeFrom(docDir, target)))
        notify({
          title: 'Image added',
          body: `Written to ${target} and linked from the document.`,
          level: 'success',
          appId: 'markdown-editor',
        })
      } catch (err) {
        const tooLarge = err instanceof UploadTooLargeError
        if (!tooLarge) console.error('[markdown-editor] failed to attach image', err)
        notify({
          title: 'Could not add the image',
          body: tooLarge
            ? 'The image is larger than the upload limit.'
            : 'Writing the file next to the document failed.',
          level: 'error',
          appId: 'markdown-editor',
        })
      } finally {
        setImageBusy(false)
      }
    },
    [docDir, insertAtCaret, readDirectory, source]
  )

  const attachImageFile = useCallback(
    async (file: File) => attachImageBytes(await file.arrayBuffer(), file.name, file.type),
    [attachImageBytes]
  )

  /**
   * Insert an image already on this machine.
   *
   * Same root as the document: link it where it lies — copying a file the user can
   * already see in Files would be a surprise. Different root: copy it in, because a
   * relative link cannot cross filesystem roots.
   */
  const insertExistingImage = useCallback(async () => {
    if (!source) return
    const choice = await pickAsset({ title: 'Insert an image', extensions: [...IMAGE_EXTENSIONS] })
    if (!choice) return
    if (choice.root === source.root) {
      insertAtCaret(
        imageMarkdown(safeBaseName(fileName(choice.path)), relativeFrom(docDir, choice.path))
      )
      return
    }
    setImageBusy(true)
    try {
      const bytes = await fetchFileBytes(choice.root, choice.path)
      const chosenName = fileName(choice.path)
      const extension = chosenName.includes('.') ? chosenName.split('.').pop()! : 'png'
      await attachImageBytes(bytes, chosenName, `image/${extension === 'jpg' ? 'jpeg' : extension}`)
    } finally {
      setImageBusy(false)
    }
  }, [attachImageBytes, docDir, insertAtCaret, pickAsset, source])

  /** Scroll the editor so a heading is at the top, and put the caret on it. */
  const goToHeading = useCallback(
    (line: number, offset: number) => {
      setCaretLine(line)
      const el = editorEl
      if (el) {
        el.focus()
        el.setSelectionRange(offset, offset)
        // `scrollTo`, not `scrollTop =`: the element arrives from state, and assigning to a
        // property of a state value is exactly what the immutability rule forbids.
        if (lineTops.length >= line) el.scrollTo({ top: lineTops[line - 1] })
      }
      // In preview-only mode there is no editor to scroll, and in split mode the sync hook
      // only reacts to a *scroll* event — so the preview is moved explicitly either way.
      previewEl?.querySelector<HTMLElement>(`[data-src-line="${line}"]`)?.scrollIntoView({
        block: 'start',
      })
    },
    [editorEl, lineTops, previewEl]
  )

  const toggleTaskLine = useCallback(
    (line: number) => {
      const el = editorEl
      const next = toggleTaskAtLine(el ? el.value : text, line)
      if (next === (el ? el.value : text)) return
      if (el) applyEdit(el, { text: next, start: el.selectionStart, end: el.selectionEnd })
      else setText(next)
    },
    [applyEdit, editorEl, text]
  )

  /** A relative link clicked in the preview. */
  const openRelative = useCallback(
    (path: string) => {
      if (!source) return
      if (/\.(md|markdown)$/i.test(path)) {
        openApp('markdown-editor', { openPath: path, root: source.root })
        return
      }
      notify({
        title: 'Linked file',
        body: `${path} — open it from Files. Markdown links open here directly.`,
        level: 'info',
        appId: 'markdown-editor',
      })
    },
    [source]
  )

  if (!source) {
    return (
      <div className="bg-surface-container-lowest text-on-surface-variant flex h-full flex-col items-center justify-center gap-2 text-center">
        <span className="font-ui text-[12px]">Nothing open</span>
        <Button
          size="sm"
          variant="primary"
          onClick={() => void openFile({ extensions: ['md', 'markdown'] })}
        >
          Open a Markdown file
        </Button>
        {fileDialog}
      </div>
    )
  }

  const editorFlex = showPreview ? settings.splitRatio : 1

  return (
    <div className="bg-surface-container-lowest flex h-full flex-col">
      {/* App actions */}
      <div className="border-outline-variant bg-surface-container-low flex items-center gap-1 border-b px-2 py-1">
        <Tooltip content="Save (Ctrl+S)">
          <Button
            variant="default"
            size="sm"
            className="flex items-center gap-1"
            onClick={() => void handleSave()}
            disabled={saving || loading || !dirty}
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save
          </Button>
        </Tooltip>

        <div className="border-outline-variant ml-1 flex items-center border" role="group">
          {VIEW_MODE_OPTIONS.map((option) => (
            <Tooltip key={option.mode} content={option.label}>
              <button
                type="button"
                onClick={() => update({ mode: option.mode as ViewMode })}
                aria-pressed={mode === option.mode}
                aria-label={option.label}
                className={cn(
                  'font-ui flex items-center px-2 py-1 text-[11px]',
                  mode === option.mode
                    ? 'bg-primary text-on-primary'
                    : 'text-on-surface hover:bg-surface-container-high'
                )}
              >
                <option.icon size={12} />
              </button>
            </Tooltip>
          ))}
        </div>

        <Tooltip content={settings.outlineOpen ? 'Hide outline' : 'Show outline'}>
          <button
            type="button"
            aria-label="Outline"
            aria-pressed={settings.outlineOpen}
            onClick={() => update({ outlineOpen: !settings.outlineOpen })}
            className={cn(
              'ml-1 flex h-6 w-6 items-center justify-center',
              settings.outlineOpen
                ? 'bg-primary text-on-primary'
                : 'text-on-surface hover:bg-surface-container-high'
            )}
          >
            <PanelLeft size={13} />
          </button>
        </Tooltip>

        {mode === 'split' && (
          <Tooltip content={settings.syncScroll ? 'Scroll sync is on' : 'Scroll sync is off'}>
            <button
              type="button"
              aria-label="Sync scrolling"
              aria-pressed={settings.syncScroll}
              onClick={() => update({ syncScroll: !settings.syncScroll })}
              className={cn(
                'flex h-6 w-6 items-center justify-center',
                settings.syncScroll
                  ? 'bg-primary text-on-primary'
                  : 'text-on-surface hover:bg-surface-container-high'
              )}
            >
              {settings.syncScroll ? <Link2 size={13} /> : <Unlink2 size={13} />}
            </button>
          </Tooltip>
        )}

        <div className="flex-1" />

        {error && (
          <span className="text-error font-ui mr-2 max-w-[280px] truncate text-[11px]">
            {error}
          </span>
        )}
        <span className="font-ui text-on-surface-variant max-w-[200px] truncate text-[11px]">
          {name}
          {dirty ? ' •' : ''}
        </span>
      </div>

      {showEditor && (
        <FormatToolbar
          onApply={applyFormatting}
          onInsertImage={() => void insertExistingImage()}
          imageBusy={imageBusy}
          disabled={loading || !editorEl}
        />
      )}

      {/* Editor / preview panes */}
      <div ref={attachPanes} className="relative flex min-h-0 flex-1">
        {loading ? (
          <div className="bg-surface-container-lowest text-on-surface-variant font-ui absolute inset-0 flex items-center justify-center gap-2 text-[12px]">
            <Loader2 size={16} className="animate-spin" />
            Loading file…
          </div>
        ) : (
          <>
            {settings.outlineOpen && (
              <Outline
                headings={headings}
                activeLine={caretLine}
                onSelect={(heading) => goToHeading(heading.line, heading.offset)}
              />
            )}

            {showEditor && (
              <div className="min-h-0 min-w-0" style={{ flex: `${editorFlex} 1 0%` }}>
                <textarea
                  ref={attachEditor}
                  className="text-on-surface h-full w-full resize-none bg-transparent p-4 font-mono text-[13px] outline-none"
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value)
                    setCaretLine(caretLineOf(e.target.value, e.target.selectionStart))
                  }}
                  onSelect={(e) => {
                    const el = e.currentTarget
                    setCaretLine(caretLineOf(el.value, el.selectionStart))
                  }}
                  onKeyDown={(e) => {
                    // Scoped to the focused textarea rather than to the top window: two
                    // editors open side by side can then never fight over Ctrl+B, and the
                    // browser's own meaning for an unbound combination is untouched.
                    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
                    const kind = keyToFormat(e)
                    if (!kind) return
                    e.preventDefault()
                    // `stopPropagation` as well, and it is load-bearing: the shell binds
                    // mod+K globally to the command palette on `window`, so without this
                    // Ctrl+K inserted a link AND opened the palette over the top of it.
                    // React attaches at the root container, so stopping here keeps the
                    // event from ever reaching the window listener. Measured in a browser.
                    e.stopPropagation()
                    applyFormatting(kind)
                  }}
                  onPaste={(e) => {
                    const image = [...e.clipboardData.items].find((item) =>
                      item.type.startsWith('image/')
                    )
                    const file = image?.getAsFile()
                    if (!file) return
                    e.preventDefault()
                    void attachImageFile(file)
                  }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes('Files')) e.preventDefault()
                  }}
                  onDrop={(e) => {
                    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'))
                    if (!file) return
                    e.preventDefault()
                    void attachImageFile(file)
                  }}
                  placeholder="Write markdown here…"
                  spellCheck={false}
                />
              </div>
            )}

            {showEditor && showPreview && (
              <SplitDivider
                ratio={settings.splitRatio}
                containerWidth={paneBox.width}
                onDrag={dragRatio}
                onCommit={commitRatio}
              />
            )}

            {showPreview && (
              <div
                className="min-h-0 min-w-0"
                style={{ flex: `${showEditor ? 1 - settings.splitRatio : 1} 1 0%` }}
              >
                <ScrollArea className="h-full" viewportRef={attachPreview}>
                  <MarkdownPreview
                    text={text}
                    root={source.root}
                    docDir={docDir}
                    headings={headings}
                    onToggleTaskLine={toggleTaskLine}
                    onOpenRelative={openRelative}
                  />
                </ScrollArea>
              </div>
            )}
          </>
        )}
      </div>

      {assetDialog}
    </div>
  )
}
