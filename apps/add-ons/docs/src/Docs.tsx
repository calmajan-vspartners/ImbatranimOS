import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  FileText,
  FileWarning,
  Loader2,
  Save,
  Search,
  X,
} from 'lucide-react'
import {
  Button,
  Tooltip,
  fileName,
  reportFileFailure,
  reportFileRefusal,
  useFileDialog,
  useOpenIntent,
  useSaveHotkey,
  useSystem,
  useTopWindowKeydown,
  useUnsavedGuard,
} from '@imbatranim/ui'
import { createDocEngine, type DocEngine } from './engine/superdoc'
import { normalizeDocx } from './engine/docxNormalize'
import { unsupportedReason } from './lib/formats'
import { shouldClearDirty } from './lib/saveOutcome'
import { countText, htmlToText } from './lib/wordCount'
import type { DocMatch } from './engine/superdoc'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export function Docs({ windowId }: { windowId: string }) {
  const system = useSystem()
  // One-shot open intent, drained by the shared hook (StrictMode-safe).
  const source = useOpenIntent()

  // Lets the app open a file on its own instead of dead-ending on
  // "open one from Files". The pick latches into the same store
  // useOpenIntent reads, so the existing load path runs unchanged.
  const { openFile } = useFileDialog()
  const pickFile = () => void openFile({ extensions: ['docx'] })
  const editorWrapRef = useRef<HTMLDivElement>(null)
  const toolbarWrapRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<DocEngine | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  // Matches are opaque engine tokens; kept in a ref because they are not rendered
  // and a new search replaces them wholesale.
  const matchesRef = useRef<DocMatch[]>([])
  const [matchCount, setMatchCount] = useState(0)
  const [matchIndex, setMatchIndex] = useState(0)
  const [counts, setCounts] = useState({ words: 0, characters: 0, charactersNoSpaces: 0 })

  const docName = source ? fileName(source.path, 'document.docx') : ''
  // Refuse what the engine cannot read, before it is asked to try. Computed from
  // the path alone, so it is known before a single byte is fetched.
  const refusal = source ? unsupportedReason(source.path) : null

  // Say so once, in the notification centre as well as in the window — the same
  // reason every other failure here does. `notify` writes to an external store
  // rather than this component's state, which is what an effect is for.
  useEffect(() => {
    if (!refusal || !source) return
    reportFileRefusal(system, refusal, { name: docName })
  }, [system, refusal, source, docName])

  // Boot SuperDoc and load the docx. Each run mounts into FRESH host nodes
  // (not the persistent wrappers) so React StrictMode's mount→cleanup→mount and
  // any future remount never leave two SuperDoc instances fighting over the same
  // DOM — the discarded instance's nodes are removed whole on cleanup, and the
  // surviving instance owns its own untouched nodes (so export reads live edits).
  useEffect(() => {
    if (!source || refusal) return
    const editorWrap = editorWrapRef.current
    const toolbarWrap = toolbarWrapRef.current
    if (!editorWrap || !toolbarWrap) return

    const editorHost = document.createElement('div')
    editorHost.style.minHeight = '100%'
    editorWrap.appendChild(editorHost)

    const toolbarHost = document.createElement('div')
    const toolbarId = `docs-toolbar-${windowId}-${Math.random().toString(36).slice(2)}`
    toolbarHost.id = toolbarId
    toolbarWrap.appendChild(toolbarHost)

    let cancelled = false
    let engine: DocEngine | null = null
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const bytes = await system.fs.read(source.root, source.path)
        if (cancelled) return
        // Guarantee the parts SuperDoc's exporter needs, so Save actually
        // re-serializes edits instead of silently re-emitting the original.
        const normalized = await normalizeDocx(bytes)
        if (cancelled) return
        if (!normalized.readable) {
          // Not a zip at all — a renamed file, or a truncated download. Refuse
          // it here rather than letting the engine fail like a broken app.
          setError(
            reportFileRefusal(system, 'This file is not a readable .docx package.', {
              name: docName,
            })
          )
          setLoading(false)
          return
        }
        if (normalized.repaired.length > 0) {
          // Worth knowing when a save is investigated later, not worth a toast:
          // the repair is exactly what makes the save correct.
          console.info('[docs] repaired missing docx parts', normalized.repaired)
        }
        const file = new File([normalized.bytes as BlobPart], docName, {
          type: DOCX_MIME,
        })
        engine = await createDocEngine({
          editor: editorHost,
          toolbar: `#${toolbarId}`,
          file,
          onReady: () => {
            if (cancelled) return
            setLoading(false)
            setDirty(false)
            // Count once the document is actually loaded. Doing it when the
            // engine object is constructed is too early — `getHTML()` has
            // nothing to give yet, and the toolbar read "0 words" over a
            // document with nineteen, which is worse than no counter at all.
            const ready = engineRef.current
            if (ready) setCounts(countText(htmlToText(ready.html())))
          },
          onEdit: () => {
            if (!cancelled) setDirty(true)
          },
          onError: (err) => {
            if (!cancelled) {
              setError(reportFileFailure(system, 'open', err, { noun: 'document', name: docName }))
              setLoading(false)
            }
          },
        })
        if (cancelled) {
          engine.destroy()
          return
        }
        engineRef.current = engine
      } catch (err) {
        if (!cancelled) {
          setError(reportFileFailure(system, 'open', err, { noun: 'document', name: docName }))
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
      engineRef.current = null
      engine?.destroy()
      editorHost.remove()
      toolbarHost.remove()
    }
  }, [system, source, refusal, windowId, docName])

  // ── Word count ──────────────────────────────────────────────────────────────
  // Recomputed on demand rather than on every keystroke: reading the whole
  // document's HTML is cheap but not free, and a live counter that re-serializes
  // the document per character typed is the kind of thing that makes an editor
  // feel heavy for a number nobody is watching that closely.
  const refreshCounts = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    setCounts(countText(htmlToText(engine.html())))
  }, [])

  // ── Find ────────────────────────────────────────────────────────────────────
  const runSearch = useCallback((text: string) => {
    const engine = engineRef.current
    setFindText(text)
    if (!engine || text.trim() === '') {
      matchesRef.current = []
      setMatchCount(0)
      setMatchIndex(0)
      return
    }
    const matches = engine.search(text)
    matchesRef.current = matches
    setMatchCount(matches.length)
    setMatchIndex(matches.length > 0 ? 1 : 0)
    if (matches.length > 0) engine.goToMatch(matches[0])
  }, [])

  const stepMatch = useCallback((direction: 1 | -1) => {
    const engine = engineRef.current
    const matches = matchesRef.current
    if (!engine || matches.length === 0) return
    setMatchIndex((prev) => {
      // 1-based, wrapping — a find bar that stops at the last hit makes the user
      // retype the query to go round again.
      const next = ((prev - 1 + direction + matches.length) % matches.length) + 1
      engine.goToMatch(matches[next - 1])
      return next
    })
  }, [])

  const openFind = useCallback(() => {
    setFindOpen(true)
    refreshCounts()
  }, [refreshCounts])

  // Ctrl/Cmd+F opens the find bar. Scoped to the TOP window via the SDK seam so
  // it never fires for a background Docs window or steals the keystroke from
  // another app; preventDefault so the browser's own find does not take it — the
  // OS's find is the one that can reach inside the editor's document model.
  // `ignoreTextEntry: false` because the document surface is contentEditable, so
  // the user is always "typing" — dropping the key there would kill the shortcut.
  useTopWindowKeydown(
    (e) => {
      if (!source || refusal) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        openFind()
      }
    },
    { ignoreTextEntry: false }
  )

  const handleSave = useCallback(async () => {
    const engine = engineRef.current
    if (!engine || !source || saving) return
    // Record the edit counter before exporting. If the user edits while the
    // export+upload is in flight the counter advances, so we must NOT clear
    // dirty on resolve — those edits aren't in the bytes we uploaded.
    const savedAtEditCount = engine.editCount()
    setSaving(true)
    setError(null)
    try {
      const bytes = await engine.exportDocx()
      await system.fs.upload(source.root, source.path, bytes, docName)
      if (
        shouldClearDirty({
          uploaded: true,
          editCountBefore: savedAtEditCount,
          editCountAfter: engine.editCount(),
        })
      ) {
        setDirty(false)
      }
    } catch (err) {
      // `dirty` is deliberately untouched: the bytes did not land, so the
      // document still differs from disk and the close guard must stay armed.
      setError(reportFileFailure(system, 'save', err, { noun: 'document', name: docName }))
    } finally {
      setSaving(false)
    }
  }, [system, source, saving, docName])

  // Ctrl/Cmd+S saves — but only for the top-most window.
  useSaveHotkey(handleSave)

  // Reflect filename + dirty marker in the window title; closing with unsaved
  // changes asks Save / Don't Save / Cancel through the themed dialog.
  const unsavedDialog = useUnsavedGuard(dirty, docName, handleSave)

  if (source && refusal) {
    return (
      <div className="bg-surface-container-lowest text-on-surface-variant flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <FileWarning size={40} strokeWidth={1} className="text-error" />
        <span className="font-ui text-on-surface text-[12px] font-semibold">{docName}</span>
        <span className="font-ui max-w-[340px] text-[12px]">{refusal}</span>
        <Button size="sm" variant="primary" onClick={pickFile}>
          Open a .docx instead
        </Button>
      </div>
    )
  }

  if (!source) {
    return (
      <div className="bg-surface-container-lowest text-on-surface-variant flex h-full flex-col items-center justify-center gap-2 text-center">
        <FileText size={40} strokeWidth={1} />
        <span className="font-ui text-[12px]">Nothing open</span>
        <Button size="sm" variant="primary" onClick={pickFile}>
          Open a document
        </Button>
      </div>
    )
  }

  return (
    <div className="bg-surface-container-lowest flex h-full flex-col">
      {/* App toolbar (Save) */}
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

        <Tooltip content="Find (Ctrl+F)">
          <Button
            variant={findOpen ? 'primary' : 'ghost'}
            size="sm"
            className="h-6 w-6 p-0"
            aria-label="Find in document"
            aria-pressed={findOpen}
            onClick={openFind}
          >
            <Search size={12} />
          </Button>
        </Tooltip>
        <Tooltip content="Word count">
          <button
            type="button"
            onClick={refreshCounts}
            className="font-ui text-on-surface-variant hover:text-on-surface text-[11px] tabular-nums"
          >
            {counts.words} words
          </button>
        </Tooltip>

        <div className="flex-1" />

        {error && (
          <span className="text-error font-ui mr-2 max-w-[280px] truncate text-[11px]">
            {error}
          </span>
        )}
        <span className="font-ui text-on-surface-variant max-w-[200px] truncate text-[11px]">
          {docName}
          {dirty ? ' •' : ''}
        </span>
      </div>

      {findOpen && (
        <div className="border-outline-variant bg-surface-container flex items-center gap-1 border-b px-2 py-1">
          <Search size={12} className="text-on-surface-variant shrink-0" />
          <input
            autoFocus
            value={findText}
            placeholder="Find in document"
            aria-label="Find in document"
            onChange={(e) => runSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') stepMatch(e.shiftKey ? -1 : 1)
              if (e.key === 'Escape') setFindOpen(false)
            }}
            className="border-outline-variant bg-surface-container-lowest font-ui text-on-surface w-[220px] border px-1.5 py-0.5 text-[12px] outline-none"
          />
          <span className="font-ui text-on-surface-variant min-w-[64px] text-[11px] tabular-nums">
            {findText.trim() === ''
              ? ''
              : matchCount === 0
                ? 'No matches'
                : `${matchIndex} of ${matchCount}`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            aria-label="Previous match"
            disabled={matchCount === 0}
            onClick={() => stepMatch(-1)}
          >
            <ChevronUp size={12} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            aria-label="Next match"
            disabled={matchCount === 0}
            onClick={() => stepMatch(1)}
          >
            <ChevronDown size={12} />
          </Button>
          <div className="flex-1" />
          <span className="font-ui text-on-surface-variant text-[11px] tabular-nums">
            {counts.words} words · {counts.charactersNoSpaces} characters
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            aria-label="Close find"
            onClick={() => setFindOpen(false)}
          >
            <X size={12} />
          </Button>
        </div>
      )}

      {/* SuperDoc's own formatting toolbar mounts into a fresh child here. */}
      <div
        ref={toolbarWrapRef}
        className="border-outline-variant bg-surface-container-low border-b"
      />

      {/* Document surface — SuperDoc mounts into a fresh child of this wrapper. */}
      <div className="relative min-h-0 flex-1 overflow-auto">
        <div ref={editorWrapRef} className="min-h-full" />
        {loading && (
          <div className="bg-surface-container-lowest text-on-surface-variant font-ui absolute inset-0 flex items-center justify-center gap-2 text-[12px]">
            <Loader2 size={16} className="animate-spin" />
            Loading document…
          </div>
        )}
      </div>

      {unsavedDialog}
    </div>
  )
}
