import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Save, Sheet as SheetIcon } from 'lucide-react'
import {
  Button,
  Tooltip,
  fileName,
  reportFileFailure,
  useConfirm,
  useFileDialog,
  useOpenIntent,
  useSaveHotkey,
  useSystem,
  useUnsavedGuard,
} from '@imbatranim/ui'
import { createSheetEngine, type SheetEngine } from './engine/univer'
import { univerToXlsx, xlsxToUniver } from './engine/xlsxBridge'
import { csvToUniver, univerToCsv } from './engine/csv'
import { lossyWarning, type LossyFeature } from './engine/xlsxScan'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function Sheets({ windowId: _windowId }: { windowId: string }) {
  const system = useSystem()
  // One-shot open intent, drained by the shared hook (StrictMode-safe).
  const source = useOpenIntent()

  // Lets the app open a file on its own instead of dead-ending on
  // "open one from Files". The pick latches into the same store
  // useOpenIntent reads, so the existing load path runs unchanged.
  const { openFile } = useFileDialog()
  const { confirm, confirmDialog } = useConfirm()
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
  useUnsavedGuard(dirty, name)

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
        const bytes = await system.fs.read(source.root, source.path)
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
            system.notify({
              level: 'warning',
              title: 'Some of this workbook cannot be saved',
              body: `${fileName(source.path, 'workbook.xlsx')} — ${warning}`,
            })
          }
        }
        setDirty(false)
      } catch (err) {
        if (!cancelled) {
          setError(
            reportFileFailure(system, 'open', err, {
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
  }, [source, system])

  const handleSave = useCallback(async () => {
    const engine = engineRef.current
    if (!engine || !source || saving) return
    const snapshot = engine.snapshot()
    if (!snapshot) return

    // CSV holds a single sheet, and `univerToCsv` writes only the first — so a
    // multi-sheet workbook saved to .csv silently drops every other sheet. Say
    // so and get explicit consent before proceeding (the promised warning that
    // was never built): a quiet save that discards sheets is exactly the kind of
    // data loss this app must not do.
    if (isCsv && (snapshot.sheetOrder?.length ?? 0) > 1) {
      const count = snapshot.sheetOrder.length
      const firstId = snapshot.sheetOrder[0]
      const firstName = snapshot.sheets?.[firstId]?.name ?? 'the first sheet'
      const ok = await confirm({
        title: 'CSV saves one sheet only',
        message: `This workbook has ${count} sheets, but a CSV file holds only one. Saving will write "${firstName}" and discard the other ${count - 1}. To keep every sheet, save it as an .xlsx file instead.`,
        confirmLabel: 'Save first sheet only',
        destructive: true,
      })
      // Cancel leaves `dirty` armed and the file untouched — the workbook still
      // differs from disk, so the Save button and close guard stay active.
      if (!ok) return
    }

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
      await system.fs.upload(source.root, source.path, bytes, docName)
      // Only on a resolved write, and only if no edit landed mid-flight — the
      // export ran before the upload, so those edits are not in these bytes.
      if (engine.editCount() === savedAtEditCount) setDirty(false)
    } catch (err) {
      // `dirty` is deliberately untouched: the bytes did not land, so the
      // workbook still differs from disk and the close guard stays armed.
      setError(
        reportFileFailure(system, 'save', err, {
          noun: 'spreadsheet',
          name: fileName(source.path, isCsv ? 'data.csv' : 'workbook.xlsx'),
        })
      )
    } finally {
      setSaving(false)
    }
  }, [source, saving, isCsv, confirm, system])

  // Ctrl/Cmd+S saves — but only for the top-most window.
  useSaveHotkey(handleSave)

  if (!source) {
    return (
      <div className="bg-surface-container-lowest text-on-surface-variant flex h-full flex-col items-center justify-center gap-2 text-center">
        <SheetIcon size={40} strokeWidth={1} />
        <span className="font-ui text-[12px]">Nothing open</span>
        <Button size="sm" variant="primary" onClick={pickFile}>
          Open a spreadsheet
        </Button>
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
      {confirmDialog}
    </div>
  )
}
