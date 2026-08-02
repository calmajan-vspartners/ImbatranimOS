import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Save, Sheet as SheetIcon } from 'lucide-react'
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
import { createSheetEngine, type SheetEngine } from './engine/univer'
import { univerToXlsx, xlsxToUniver } from './engine/xlsxBridge'

export function Sheets({ windowId }: { windowId: string }) {
  // One-shot open intent, drained by the shared hook (StrictMode-safe).
  const source = useOpenIntent(windowId)

  // Lets the app open a file on its own instead of dead-ending on
  // "open one from Files". The pick latches into the same store
  // useOpenIntent reads, so the existing load path runs unchanged.
  const { openFile, fileDialog } = useFileDialog(windowId)
  const pickFile = () => void openFile({ extensions: ['xlsx', 'csv'] })
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<SheetEngine | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const name = source ? fileName(source.path, 'workbook.xlsx') : ''

  // Reflect filename + dirty marker in the window title and warn before closing
  // with unsaved changes.
  useUnsavedGuard(windowId, dirty, name)

  // Boot Univer, fetch the file, map it through the ExcelJS bridge into the grid.
  useEffect(() => {
    if (!source) return
    const container = containerRef.current
    if (!container) return
    let cancelled = false
    let engine: SheetEngine | null = null
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        engine = await createSheetEngine(container)
        if (cancelled) {
          engine.destroy()
          return
        }
        engineRef.current = engine
        engine.onEdit(() => setDirty(true))
        const bytes = await fetchFileBytes(source.root, source.path)
        if (cancelled) return
        const workbookData = await xlsxToUniver(bytes)
        if (cancelled) return
        engine.loadWorkbook(workbookData)
        setDirty(false)
      } catch (err) {
        if (!cancelled) {
          console.error('[sheets] failed to open', err)
          setError('Could not open this spreadsheet.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      engineRef.current = null
      engine?.destroy()
    }
  }, [source])

  const handleSave = useCallback(async () => {
    const engine = engineRef.current
    if (!engine || !source || saving) return
    const snapshot = engine.snapshot()
    if (!snapshot) return
    // Record the edit counter at snapshot time. If the user edits while the
    // serialize+upload is in flight the counter advances, so we must NOT clear
    // dirty on resolve — those edits aren't in the bytes we uploaded.
    const savedAtEditCount = engine.editCount()
    setSaving(true)
    setError(null)
    try {
      const bytes = await univerToXlsx(snapshot)
      await uploadFileBytes(source.root, source.path, bytes, fileName(source.path, 'workbook.xlsx'))
      if (engine.editCount() === savedAtEditCount) setDirty(false)
    } catch (err) {
      if (err instanceof UploadTooLargeError) {
        setError(err.message)
      } else {
        console.error('[sheets] failed to save', err)
        setError('Could not save this spreadsheet.')
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
        <SheetIcon size={40} strokeWidth={1} />
        <span className="font-ui text-[12px]">Nothing open</span>
        <Button size="sm" variant="primary" onClick={pickFile}>
          Open a spreadsheet
        </Button>
        {fileDialog}
      </div>
    )
  }

  return (
    <div className="bg-surface-container-lowest flex h-full flex-col">
      {/* Toolbar */}
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

      {/* Grid surface — Univer mounts its canvas here. */}
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        {loading && (
          <div className="bg-surface-container-lowest text-on-surface-variant font-ui absolute inset-0 flex items-center justify-center gap-2 text-[12px]">
            <Loader2 size={16} className="animate-spin" />
            Loading spreadsheet…
          </div>
        )}
      </div>
    </div>
  )
}
