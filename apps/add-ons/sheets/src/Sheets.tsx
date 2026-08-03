import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Save, Sheet as SheetIcon } from 'lucide-react'
import {
  Button,
  Tooltip,
  fetchFileBytes,
  fileName,
  notify,
  reportFileFailure,
  uploadFileBytes,
  useFileDialog,
  useOpenIntent,
  useSaveHotkey,
  useUnsavedGuard,
} from '@imbatranim/core'
import { createSheetEngine, type SheetEngine } from './engine/univer'
import { univerToXlsx, xlsxToUniver } from './engine/xlsxBridge'
import { csvToUniver, univerToCsv } from './engine/csv'
import { lossyWarning, type LossyFeature } from './engine/xlsxScan'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

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
  // Kept in view for as long as the file is open, not just as a toast: it is a
  // standing property of this workbook, and the moment it matters is the moment
  // the user reaches for Save — which may be an hour after a toast has gone.
  const [lossy, setLossy] = useState<LossyFeature[]>([])

  const name = source ? fileName(source.path, 'workbook.xlsx') : ''
  const isCsv = /\.csv$/i.test(source?.path ?? '')
  const lossyNote = lossyWarning(lossy)

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
    const csvFile = /\.csv$/i.test(source.path)
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

        if (csvFile) {
          engine.loadWorkbook(csvToUniver(decoder.decode(bytes), fileName(source.path, 'Sheet1')))
          setLossy([])
        } else {
          const { workbook, lossy: found } = await xlsxToUniver(bytes)
          if (cancelled) return
          engine.loadWorkbook(workbook)
          setLossy(found)
          // Sticky in the notification centre as well as in the window: a user
          // who opens six workbooks and comes back later still needs to know
          // which one will lose its charts.
          const warning = lossyWarning(found)
          if (warning) {
            notify({
              level: 'warning',
              appId: 'sheets',
              title: 'Some of this workbook cannot be saved',
              body: `${fileName(source.path, 'workbook.xlsx')} — ${warning}`,
            })
          }
        }
        setDirty(false)
      } catch (err) {
        if (!cancelled) {
          setError(
            reportFileFailure('open', err, {
              appId: 'sheets',
              noun: 'spreadsheet',
              name: fileName(source.path, 'workbook.xlsx'),
            })
          )
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
      const docName = fileName(source.path, isCsv ? 'data.csv' : 'workbook.xlsx')
      const bytes = isCsv
        ? (encoder.encode(univerToCsv(snapshot)).slice().buffer as ArrayBuffer)
        : await univerToXlsx(snapshot)
      await uploadFileBytes(source.root, source.path, bytes, docName)
      // Only on a resolved write, and only if no edit landed mid-flight — the
      // export ran before the upload, so those edits are not in these bytes.
      if (engine.editCount() === savedAtEditCount) setDirty(false)
    } catch (err) {
      // `dirty` is deliberately untouched: the bytes did not land, so the
      // workbook still differs from disk and the close guard stays armed.
      setError(
        reportFileFailure('save', err, {
          appId: 'sheets',
          noun: 'spreadsheet',
          name: fileName(source.path, isCsv ? 'data.csv' : 'workbook.xlsx'),
        })
      )
    } finally {
      setSaving(false)
    }
  }, [source, saving, isCsv])

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

      {/* A standing note for the length of the session, not a toast: the moment
          it matters is the moment the user reaches for Save, which can be an
          hour after a toast has gone. */}
      {lossyNote && (
        <div className="border-outline-variant bg-surface-container text-on-surface font-ui flex items-start gap-2 border-b px-2 py-1.5 text-[11px]">
          <AlertTriangle size={13} className="text-error mt-[1px] shrink-0" />
          <span className="min-w-0 flex-1">{lossyNote}</span>
          <button
            type="button"
            aria-label="Dismiss"
            className="text-on-surface-variant hover:text-on-surface shrink-0"
            onClick={() => setLossy([])}
          >
            ×
          </button>
        </div>
      )}

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
