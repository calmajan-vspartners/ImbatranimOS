import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Loader2, Save } from 'lucide-react'
import {
  Button,
  Tooltip,
  UploadTooLargeError,
  fetchFileBytes,
  fileName,
  uploadFileBytes,
  useFileDialog,
  useOpenIntent,
  useSaveHotkey,
  useUnsavedGuard,
} from '@imbatranim/core'
import { createDocEngine, type DocEngine } from './engine/superdoc'
import { normalizeDocx } from './engine/docxNormalize'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export function Docs({ windowId }: { windowId: string }) {
  // One-shot open intent, drained by the shared hook (StrictMode-safe).
  const source = useOpenIntent(windowId)

  // Lets the app open a file on its own instead of dead-ending on
  // "open one from Files". The pick latches into the same store
  // useOpenIntent reads, so the existing load path runs unchanged.
  const { openFile, fileDialog } = useFileDialog(windowId)
  const pickFile = () => void openFile({ extensions: ['docx'] })
  const editorWrapRef = useRef<HTMLDivElement>(null)
  const toolbarWrapRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<DocEngine | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const name = source ? fileName(source.path, 'document.docx') : ''

  // Reflect filename + dirty marker in the window title and warn before closing
  // with unsaved changes.
  useUnsavedGuard(windowId, dirty, name)

  // Boot SuperDoc and load the docx. Each run mounts into FRESH host nodes
  // (not the persistent wrappers) so React StrictMode's mount→cleanup→mount and
  // any future remount never leave two SuperDoc instances fighting over the same
  // DOM — the discarded instance's nodes are removed whole on cleanup, and the
  // surviving instance owns its own untouched nodes (so export reads live edits).
  useEffect(() => {
    if (!source) return
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
        const bytes = await fetchFileBytes(source.root, source.path)
        if (cancelled) return
        // Guarantee the parts SuperDoc's exporter needs, so Save actually
        // re-serializes edits instead of silently re-emitting the original.
        const normalized = await normalizeDocx(bytes)
        if (cancelled) return
        const file = new File([normalized as BlobPart], fileName(source.path, 'document.docx'), {
          type: DOCX_MIME,
        })
        engine = await createDocEngine({
          editor: editorHost,
          toolbar: `#${toolbarId}`,
          file,
          onReady: () => {
            if (!cancelled) {
              setLoading(false)
              setDirty(false)
            }
          },
          onEdit: () => {
            if (!cancelled) setDirty(true)
          },
          onError: (err) => {
            if (!cancelled) {
              console.error('[docs] document error', err)
              setError('Could not open this document.')
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
          console.error('[docs] failed to open', err)
          setError('Could not open this document.')
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
  }, [source, windowId])

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
      await uploadFileBytes(source.root, source.path, bytes, fileName(source.path, 'document.docx'))
      if (engine.editCount() === savedAtEditCount) setDirty(false)
    } catch (err) {
      if (err instanceof UploadTooLargeError) {
        setError(err.message)
      } else {
        console.error('[docs] failed to save', err)
        setError('Could not save this document.')
      }
    } finally {
      setSaving(false)
    }
  }, [source, saving])

  // Ctrl/Cmd+S saves — but only for the top-most window.
  useSaveHotkey(windowId, handleSave)

  if (!source) {
    return (
      <div className="bg-surface-container-lowest text-on-surface-variant flex h-full flex-col items-center justify-center gap-2 text-center">
        <FileText size={40} strokeWidth={1} />
        <span className="font-ui text-[12px]">Nothing open</span>
        <Button size="sm" variant="primary" onClick={pickFile}>
          Open a document
        </Button>
        {fileDialog}
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
    </div>
  )
}
