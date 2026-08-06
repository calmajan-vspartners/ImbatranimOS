import { useCallback, useRef, useState } from 'react'
import { ArrowLeft, Eye, Edit3, Loader2, Save, WrapText } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Button,
  cn,
  fileName,
  notify,
  reportFileFailure,
  ScrollArea,
  useSaveHotkey,
  useUnsavedGuard,
} from '@imbatranim/core'
import { useNoteFileQuery, useUpdateFileMutation } from '../queries/notepadQueries'
import type { OpenDoc } from '../store/notepadStore'
import { FindBar } from './FindBar'
import {
  caretPosition,
  findMatches,
  matchIndexFrom,
  minimalEdit,
  replaceAll,
  replaceRange,
  textStats,
} from '../lib/findReplace'

/**
 * The editor.
 *
 * ## Explicit save, not autosave
 *
 * This app used to write on a 1-second debounce after every keystroke, with **no
 * dirty marker, no Ctrl+S and no close guard**. Brief 59 lists the save spine under
 * "must preserve" and calls autosave "rejected" — but Notepad was the autosaving app,
 * so the brief's non-change was in fact its largest one.
 *
 * Explicit save now, matching Docs, Sheets, Code Editor, Markdown Editor and Image
 * Viewer: `useUnsavedGuard` for the dirty `•` and the close prompt, `useSaveHotkey`
 * for Ctrl+S. That is the right way round — there is no version history and no undo
 * across a reload, so a debounce meant a stray keystroke reached disk in one second
 * with nothing to recover from.
 */
export function NoteEditor({
  windowId,
  doc,
  onBack,
}: {
  windowId: string
  doc: OpenDoc
  onBack: () => void
}) {
  const { root, path } = doc
  const { data: file, isLoading, isError } = useNoteFileQuery(root, path)
  const updateMutation = useUpdateFileMutation()

  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [wrap, setWrap] = useState(true)
  const [caret, setCaret] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const [findOpen, setFindOpen] = useState(false)
  const [showReplace, setShowReplace] = useState(false)
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [matchIndex, setMatchIndex] = useState(0)

  const textRef = useRef<HTMLTextAreaElement>(null)
  const findInputRef = useRef<HTMLInputElement>(null)

  // Load a (re)fetched file into the draft. Render-time adjustment rather than an
  // effect — React's documented "adjust state when a prop changes" bail-out.
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const key = `${root}:${path}`
  if (file && (loadedKey !== key || savedContent !== file.content)) {
    if (loadedKey !== key) {
      setLoadedKey(key)
      setContent(file.content)
      setSavedContent(file.content)
    } else if (savedContent !== file.content && content === savedContent) {
      // The file changed on disk and the user has no unsaved edits, so adopting it
      // is safe. With unsaved edits it is deliberately NOT adopted — silently
      // replacing what someone is typing is the worst possible resolution.
      setContent(file.content)
      setSavedContent(file.content)
    }
  }

  const dirty = content !== savedContent
  // The window and taskbar titles carry the filename and the dirty marker, and
  // closing with unsaved changes prompts — the same spine every other editor uses.
  useUnsavedGuard(windowId, dirty, fileName(path, 'note'))

  const save = useCallback(() => {
    if (!dirty || updateMutation.isPending) return
    const snapshot = content
    setError(null)
    updateMutation.mutate(
      { root, path, content: snapshot },
      {
        // Only what was actually written becomes the new baseline. If the user typed
        // during the request, `content` has moved on and the document stays dirty.
        onSuccess: () => setSavedContent(snapshot),
        onError: (err) =>
          setError(
            reportFileFailure('save', err, {
              appId: 'notepad',
              noun: 'note',
              name: fileName(path, 'note'),
            })
          ),
      }
    )
  }, [dirty, updateMutation, content, root, path])

  useSaveHotkey(windowId, save)

  // ── Find / replace ────────────────────────────────────────────────────────
  const matches = findMatches(content, query, caseSensitive)
  const current = matches[matchIndex] ?? null

  const select = useCallback((match: { start: number; end: number } | null) => {
    const el = textRef.current
    if (!el || !match) return
    el.focus()
    el.setSelectionRange(match.start, match.end)
    setCaret(match.end)
  }, [])

  const step = useCallback(
    (direction: 1 | -1) => {
      if (matches.length === 0) return
      const from = textRef.current?.selectionStart ?? caret
      const next =
        current && direction === 1
          ? (matchIndex + 1) % matches.length
          : current && direction === -1
            ? (matchIndex - 1 + matches.length) % matches.length
            : matchIndexFrom(matches, from, direction)
      setMatchIndex(next)
      select(matches[next])
    },
    [matches, current, matchIndex, caret, select]
  )

  /**
   * Apply a whole-text rewrite through the browser's own editing pipeline rather
   * than a `value` assignment, so the native undo stack survives (L8) — the same
   * spine markdown-editor uses. `insertText` fires an `input` event that reaches
   * the textarea's `onChange`, so `content` still updates. If the command is
   * unavailable (older engines, tests) the state path is the fallback: worse
   * undo, identical text.
   */
  const applyEdit = useCallback((nextText: string, caretTo: number) => {
    const el = textRef.current
    if (!el) {
      setContent(nextText)
      setCaret(caretTo)
      return
    }
    const edit = minimalEdit(el.value, nextText)
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
    if (!handled) setContent(nextText)
    requestAnimationFrame(() => {
      el.setSelectionRange(caretTo, caretTo)
      setCaret(caretTo)
    })
  }, [])

  const doReplaceOne = useCallback(() => {
    if (!current) return
    const out = replaceRange(content, current, replacement)
    applyEdit(out.text, out.caret)
    // Clamp: the replacement may have removed later matches.
    setMatchIndex(0)
  }, [current, content, replacement, applyEdit])

  const doReplaceAll = useCallback(() => {
    const out = replaceAll(content, query, replacement, caseSensitive)
    if (out.count === 0) return
    applyEdit(out.text, Math.min(caret, out.text.length))
    setMatchIndex(0)
    // Reported, because "replace all" giving no feedback is indistinguishable from
    // it having done nothing.
    notify({
      title: 'Replaced',
      body: `${out.count} occurrence${out.count === 1 ? '' : 's'} of “${query}”`,
      level: 'info',
      appId: 'notepad',
    })
  }, [content, query, replacement, caseSensitive, caret, applyEdit])

  const openFind = useCallback((withReplace: boolean) => {
    setFindOpen(true)
    if (withReplace) setShowReplace(true)
    // Seed from the selection, the way every editor does — select a word, Ctrl+F,
    // and it is already the query.
    const el = textRef.current
    if (el && el.selectionEnd > el.selectionStart) {
      setQuery(el.value.slice(el.selectionStart, el.selectionEnd))
      setMatchIndex(0)
    }
    requestAnimationFrame(() => findInputRef.current?.select())
  }, [])

  function handleKeyDown(e: React.KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey
    if (!mod) return
    const k = e.key.toLowerCase()
    if (k === 'f') {
      e.preventDefault()
      openFind(false)
    }
    if (k === 'h') {
      e.preventDefault()
      openFind(true)
    }
  }

  // Keep the caret readout live without re-rendering on every keystroke twice.
  const syncCaret = () => setCaret(textRef.current?.selectionStart ?? 0)

  const stats = textStats(content)
  const pos = caretPosition(content, caret)

  if (isLoading) {
    return (
      <div className="text-on-surface-variant flex h-full items-center justify-center gap-2 p-4 text-[12px]">
        <Loader2 size={14} className="animate-spin" /> Loading…
      </div>
    )
  }
  // A brand-new file has nothing on disk yet, so its read misses — that is the
  // expected state, not a failure. Fall through to an empty draft; the file is
  // created on the first save. Only a read error on a file that was supposed to
  // exist is the dead-end worth showing (T1-9).
  if (isError && !doc.isNew) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
        <span className="text-error font-content text-[12px]">Could not open this file.</span>
        <Button variant="default" size="sm" onClick={onBack}>
          Back
        </Button>
      </div>
    )
  }

  return (
    <div
      className="bg-surface-container-lowest flex h-full flex-col overflow-hidden"
      onKeyDown={handleKeyDown}
    >
      {/* toolbar */}
      <div className="border-outline-variant bg-surface-container-low flex h-10 shrink-0 items-center justify-between border-b px-3 py-1">
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={onBack}
            className="hover:bg-surface-container-high p-1"
            title="Close this file"
          >
            <ArrowLeft size={16} />
          </button>
          <span className="truncate text-[12px] font-semibold" title={`${root}:/${path}`}>
            {fileName(path, 'note')}
            {dirty && ' •'}
          </span>
          {/* The root is shown, always. It is the whole point of this brief: you can
              see which filesystem you are editing. */}
          <span className="border-outline-variant text-on-surface-variant shrink-0 border px-1 text-[9px] font-semibold tracking-wider uppercase">
            {root}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="primary"
            size="sm"
            className="flex h-6 items-center gap-1 px-2"
            disabled={!dirty || updateMutation.isPending}
            onClick={save}
          >
            {updateMutation.isPending ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Save size={11} />
            )}
            Save
          </Button>
          <button
            onClick={() => setMode('edit')}
            className={cn('p-1.5', mode === 'edit' && 'bg-primary text-on-primary')}
            title="Edit"
            aria-pressed={mode === 'edit'}
          >
            <Edit3 size={14} />
          </button>
          <button
            onClick={() => setMode('preview')}
            className={cn('p-1.5', mode === 'preview' && 'bg-primary text-on-primary')}
            title="Preview as Markdown"
            aria-pressed={mode === 'preview'}
          >
            <Eye size={14} />
          </button>
        </div>
      </div>

      {findOpen && (
        <FindBar
          query={query}
          // The match cursor resets HERE, where the query actually changes, rather
          // than in an effect watching it — an effect that only mirrors a change
          // its own handler could have made is the cascading-render shape React's
          // `set-state-in-effect` rule exists to catch.
          onQueryChange={(value) => {
            setQuery(value)
            setMatchIndex(0)
          }}
          replacement={replacement}
          onReplacementChange={setReplacement}
          caseSensitive={caseSensitive}
          onToggleCase={() => {
            setCaseSensitive((v) => !v)
            setMatchIndex(0)
          }}
          showReplace={showReplace}
          onToggleReplace={() => setShowReplace((v) => !v)}
          matchCount={matches.length}
          currentMatch={matches.length === 0 ? 0 : matchIndex + 1}
          onNext={() => step(1)}
          onPrevious={() => step(-1)}
          onReplaceOne={doReplaceOne}
          onReplaceAll={doReplaceAll}
          onClose={() => {
            setFindOpen(false)
            setShowReplace(false)
            textRef.current?.focus()
          }}
          inputRef={findInputRef}
        />
      )}

      {error && (
        <div className="border-outline-variant bg-surface-container-low border-b px-3 py-1">
          <span className="font-ui text-error text-[11px]">{error}</span>
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          className={cn(
            'absolute inset-0 transition-opacity duration-200',
            mode === 'edit' ? 'z-10 opacity-100' : 'pointer-events-none z-0 opacity-0'
          )}
        >
          <textarea
            ref={textRef}
            className={cn(
              'h-full w-full resize-none bg-transparent p-4 font-mono text-[13px] outline-none',
              // `whitespace-pre` + horizontal scroll is what "wrap off" means for a
              // log file; without it a 4000-character line is unreadable either way.
              wrap ? 'whitespace-pre-wrap' : 'overflow-x-auto whitespace-pre'
            )}
            value={content}
            onChange={(e) => {
              setContent(e.target.value)
              setCaret(e.target.selectionStart)
            }}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            onSelect={syncCaret}
            placeholder="Type here. Ctrl+S saves, Ctrl+F finds."
            spellCheck={false}
            wrap={wrap ? 'soft' : 'off'}
          />
        </div>

        <div
          className={cn(
            'absolute inset-0 transition-opacity duration-200',
            mode === 'preview' ? 'z-10 opacity-100' : 'pointer-events-none z-0 opacity-0'
          )}
        >
          <ScrollArea className="h-full">
            <div className="prose prose-sm prose-headings:font-ui prose-p:font-content prose-a:text-primary max-w-none p-6">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Status bar — the house recipe: line/col, counts, and the wrap toggle. */}
      <div className="border-outline-variant bg-surface-container-low text-on-surface-variant flex h-6 shrink-0 items-center gap-3 border-t px-3 font-mono text-[10px]">
        <span className="tabular-nums">
          Ln {pos.line}, Col {pos.column}
        </span>
        <span className="tabular-nums">{stats.lines} lines</span>
        <span className="tabular-nums">{stats.words} words</span>
        <span className="tabular-nums">{stats.chars} chars</span>
        <div className="flex-1" />
        <button
          onClick={() => setWrap((w) => !w)}
          aria-pressed={wrap}
          aria-label="Word wrap"
          title={wrap ? 'Word wrap on' : 'Word wrap off'}
          className={cn(
            'flex items-center gap-1 px-1',
            wrap ? 'text-on-surface' : 'text-on-surface-variant'
          )}
        >
          <WrapText size={11} />
          wrap {wrap ? 'on' : 'off'}
        </button>
      </div>
    </div>
  )
}
