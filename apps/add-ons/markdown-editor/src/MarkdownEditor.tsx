import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Button,
  ScrollArea,
  Tooltip,
  UploadTooLargeError,
  cn,
  fetchFileBytes,
  fileName,
  uploadFileBytes,
  useFileDialog,
  useOpenIntent,
  useSaveHotkey,
  useUnsavedGuard,
} from '@imbatranim/core'
import { VIEW_MODE_OPTIONS, type ViewMode } from './viewMode'

const decoder = new TextDecoder()
const encoder = new TextEncoder()

export function MarkdownEditor({ windowId }: { windowId: string }) {
  // One-shot open intent, drained by the shared hook (StrictMode-safe).
  const source = useOpenIntent(windowId)

  // Lets the app open a file on its own instead of dead-ending on
  // "open one from Files". The pick latches into the same store
  // useOpenIntent reads, so the existing load path runs unchanged.
  const { openFile, fileDialog } = useFileDialog(windowId)
  const pickFile = () => void openFile({ extensions: ['md', 'markdown'] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [text, setText] = useState('')
  const [savedText, setSavedText] = useState('')
  const [mode, setMode] = useState<ViewMode>('split')
  // Tracks the latest `text` for the async save flow below, without pulling
  // `text` into that callback's dependencies (kept in sync via effect, never
  // written during render).
  const textRef = useRef(text)
  useEffect(() => {
    textRef.current = text
  }, [text])

  const name = source ? fileName(source.path, 'untitled.md') : ''
  const dirty = text !== savedText

  // Reflect filename + dirty marker in the window title and warn before closing
  // with unsaved changes.
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
    // Record the exact text being uploaded. If the user edits while the
    // upload is in flight, `textRef.current` moves on — only clear dirty when
    // no further edits landed, so those in-flight edits aren't clobbered.
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

  if (!source) {
    return (
      <div className="bg-surface-container-lowest text-on-surface-variant flex h-full flex-col items-center justify-center gap-2 text-center">
        <span className="font-ui text-[12px]">Nothing open</span>
        <Button size="sm" variant="primary" onClick={pickFile}>
          Open a Markdown file
        </Button>
        {fileDialog}
      </div>
    )
  }

  const showEditor = mode === 'editor' || mode === 'split'
  const showPreview = mode === 'preview' || mode === 'split'

  return (
    <div className="bg-surface-container-lowest flex h-full flex-col">
      {/* App toolbar */}
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
                onClick={() => setMode(option.mode)}
                aria-pressed={mode === option.mode}
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

      {/* Editor / preview panes — each scrolls independently. */}
      <div className="relative flex min-h-0 flex-1">
        {loading ? (
          <div className="bg-surface-container-lowest text-on-surface-variant font-ui absolute inset-0 flex items-center justify-center gap-2 text-[12px]">
            <Loader2 size={16} className="animate-spin" />
            Loading file…
          </div>
        ) : (
          <>
            {showEditor && (
              <div
                className={cn(
                  'min-h-0 min-w-0 flex-1',
                  showPreview && 'border-outline-variant border-r'
                )}
              >
                <textarea
                  className="text-on-surface h-full w-full resize-none bg-transparent p-4 font-mono text-[13px] outline-none"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Write markdown here…"
                  spellCheck={false}
                />
              </div>
            )}

            {showPreview && (
              <div className="min-h-0 min-w-0 flex-1">
                <ScrollArea className="h-full">
                  <div
                    className={cn(
                      'md-preview',
                      'prose prose-sm max-w-none p-6',
                      'prose-headings:font-ui prose-headings:text-on-surface',
                      'prose-p:text-on-surface prose-li:text-on-surface',
                      'prose-strong:text-on-surface prose-blockquote:text-on-surface-variant',
                      'prose-a:text-primary prose-code:text-on-surface',
                      'prose-hr:border-outline-variant prose-blockquote:border-outline-variant',
                      'prose-th:text-on-surface prose-td:text-on-surface-variant',
                      'prose-pre:bg-surface-container prose-code:bg-surface-container',
                      'prose-img:max-w-full'
                    )}
                  >
                    <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
                  </div>
                </ScrollArea>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
