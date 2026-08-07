import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Columns2, FileDiff, Loader2, Rows2, Save, WrapText } from 'lucide-react'
import { DiffEditor } from '@monaco-editor/react'
import type * as monaco from 'monaco-editor'
import {
  Button,
  Tooltip,
  fileName,
  reportFileFailure,
  reportFileRefusal,
  useFileDialog,
  useSaveHotkey,
  useSystem,
  useUnsavedGuard,
} from '@imbatranim/ui'
import './monacoSetup'
import { languageForPath } from './language'

/**
 * Whole-file in-memory diffing: Monaco holds both sides plus the diff model.
 * The cap is per side, stated in the refusal.
 */
const MAX_DIFF_BYTES = 5 * 1024 * 1024

type Side = {
  root: string
  path: string
  text: string
}

/** Payload from the file manager's two-selection "Compare" (brief 99). */
type DiffIntent = {
  leftRoot?: string
  leftPath?: string
  rightRoot?: string
  rightPath?: string
}

const decoder = new TextDecoder()
const encoder = new TextEncoder()

/**
 * A file the text pipeline would garble. The same null-byte sniff the preview
 * pane uses: real text virtually never contains NUL; most binary formats do
 * within the first few KB.
 */
function looksBinary(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 8192)
  return head.includes(0)
}

/**
 * The Diff tool (brief 99): Monaco's DiffEditor, which has been in the
 * code-editor package's lazy chunk since brief 41, finally given a window.
 * Lives in this package so it shares the self-hosted Monaco + worker setup —
 * a separate add-on would duplicate that dependency wholesale.
 *
 * The right side is editable with the full save spine: "apply the fix while
 * looking at the diff" is what makes this a tool rather than a viewer. The
 * left side is read-only context.
 */
export function DiffTool({ windowId: _windowId }: { windowId: string }) {
  const system = useSystem()
  const [left, setLeft] = useState<Side | null>(null)
  const [right, setRight] = useState<Side | null>(null)
  const [loading, setLoading] = useState(false)
  const [sideBySide, setSideBySide] = useState(true)
  const [wordWrap, setWordWrap] = useState(false)
  const [dirty, setDirty] = useState(false)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const savedTextRef = useRef('')

  const { openFile } = useFileDialog()

  const loadSide = useCallback(
    async (which: 'left' | 'right', root: string, path: string) => {
      setLoading(true)
      try {
        const bytes = new Uint8Array(await system.fs.read(root, path))
        if (bytes.byteLength > MAX_DIFF_BYTES) {
          reportFileRefusal(
            system,
            `over 5 MB — the diff holds both files in memory whole; use the terminal's diff for something this size`,
            { name: fileName(path) }
          )
          return
        }
        if (looksBinary(bytes)) {
          reportFileRefusal(
            system,
            `looks binary — a text diff of it would be garbage rather than a comparison`,
            { name: fileName(path) }
          )
          return
        }
        const side: Side = { root, path, text: decoder.decode(bytes) }
        if (which === 'left') setLeft(side)
        else {
          setRight(side)
          savedTextRef.current = side.text
          setDirty(false)
        }
        system.fs.recordRecent(root, path)
      } catch (err) {
        reportFileFailure(system, 'open', err, { noun: 'file', name: fileName(path) })
      } finally {
        setLoading(false)
      }
    },
    [system]
  )

  // Drain the one-shot open intent exactly once in a ref-guarded effect (the
  // brief-30 StrictMode rule): the file manager's Compare hands both sides.
  const consumedRef = useRef(false)
  useEffect(() => {
    if (consumedRef.current) return
    consumedRef.current = true
    const intent = system.intents.consume<DiffIntent>()
    // Draining a one-shot intent IS the "sync from an external system" an
    // effect is for, and it runs at most once (ref-guarded). Same scoped
    // disable Notepad and the file manager use for the identical drain.
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    if (intent?.leftPath && intent.leftRoot) void loadSide('left', intent.leftRoot, intent.leftPath)
    if (intent?.rightPath && intent.rightRoot)
      void loadSide('right', intent.rightRoot, intent.rightPath)
    // Mount-once drain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system])

  const pick = useCallback(
    async (which: 'left' | 'right') => {
      const choice = await openFile({
        title: which === 'left' ? 'Choose the left (original) file' : 'Choose the right file',
      })
      if (choice) void loadSide(which, choice.root, choice.path)
    },
    [openFile, loadSide]
  )

  const save = useCallback(async () => {
    const editor = editorRef.current
    if (!editor || !right) return
    const text = editor.getModifiedEditor().getValue()
    try {
      await system.fs.upload(right.root, right.path, encoder.encode(text), fileName(right.path))
      savedTextRef.current = text
      setRight((r) => (r ? { ...r, text } : r))
      setDirty(false)
      system.notify({
        title: 'Saved',
        body: fileName(right.path),
        level: 'info',
      })
    } catch (err) {
      reportFileFailure(system, 'save', err, { noun: 'file', name: fileName(right.path) })
    }
  }, [right, system])

  useSaveHotkey(() => void save())
  const unsavedDialog = useUnsavedGuard(dirty, right ? fileName(right.path) : 'Diff', save)

  const theme = useMemo(
    () =>
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
        ? 'vs-dark'
        : 'vs',
    []
  )

  const options = useMemo<monaco.editor.IDiffEditorConstructionOptions>(
    () => ({
      renderSideBySide: sideBySide,
      wordWrap: wordWrap ? 'on' : 'off',
      readOnly: false,
      originalEditable: false,
      minimap: { enabled: false },
      automaticLayout: true,
      scrollBeyondLastLine: false,
    }),
    [sideBySide, wordWrap]
  )

  const handleMount = useCallback((editor: monaco.editor.IStandaloneDiffEditor) => {
    editorRef.current = editor
    editor.getModifiedEditor().onDidChangeModelContent(() => {
      setDirty(editor.getModifiedEditor().getValue() !== savedTextRef.current)
    })
  }, [])

  const ready = left !== null && right !== null

  return (
    <div className="bg-surface flex h-full flex-col">
      {/* Toolbar: the two sides, then the view toggles */}
      <div className="border-outline-variant bg-surface-container-low flex flex-none flex-wrap items-center gap-1 border-b px-2 py-1">
        <Button size="sm" variant="ghost" className="max-w-56" onClick={() => void pick('left')}>
          <FileDiff size={12} />
          <span className="min-w-0 truncate">
            {left ? fileName(left.path) : 'Choose left file…'}
          </span>
        </Button>
        <span className="font-ui text-on-surface-variant text-[11px]">vs</span>
        <Button size="sm" variant="ghost" className="max-w-56" onClick={() => void pick('right')}>
          <FileDiff size={12} />
          <span className="min-w-0 truncate">
            {right ? fileName(right.path) + (dirty ? ' •' : '') : 'Choose right file…'}
          </span>
        </Button>
        <div className="flex-1" />
        <Tooltip content={sideBySide ? 'Inline view' : 'Side-by-side view'}>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            aria-label={sideBySide ? 'Switch to inline view' : 'Switch to side-by-side view'}
            onClick={() => setSideBySide((v) => !v)}
          >
            {sideBySide ? <Rows2 size={13} /> : <Columns2 size={13} />}
          </Button>
        </Tooltip>
        <Tooltip content={wordWrap ? 'Unwrap long lines' : 'Wrap long lines'}>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            aria-label={wordWrap ? 'Unwrap long lines' : 'Wrap long lines'}
            aria-pressed={wordWrap}
            onClick={() => setWordWrap((v) => !v)}
          >
            <WrapText size={13} />
          </Button>
        </Tooltip>
        <Button size="sm" variant="primary" disabled={!dirty} onClick={() => void save()}>
          <Save size={12} />
          Save right
        </Button>
      </div>

      <div className="relative min-h-0 flex-1">
        {ready ? (
          <DiffEditor
            theme={theme}
            options={options}
            original={left.text}
            modified={right.text}
            originalLanguage={languageForPath(left.path)}
            modifiedLanguage={languageForPath(right.path)}
            onMount={handleMount}
            keepCurrentOriginalModel={false}
            keepCurrentModifiedModel={false}
            loading={
              <div className="text-on-surface-variant font-ui flex items-center gap-2 text-[12px]">
                <Loader2 size={16} className="animate-spin" />
                Loading diff…
              </div>
            }
          />
        ) : (
          <div className="text-on-surface-variant flex h-full flex-col items-center justify-center gap-3">
            {loading ? (
              <Loader2 size={24} className="animate-spin" />
            ) : (
              <>
                <FileDiff size={40} strokeWidth={1} />
                <p className="font-ui text-[12px]">
                  Choose two files to compare — or select two in the File Manager and pick
                  “Compare”.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => void pick('left')}>
                    Left file…
                  </Button>
                  <Button size="sm" variant="default" onClick={() => void pick('right')}>
                    Right file…
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {unsavedDialog}
    </div>
  )
}
