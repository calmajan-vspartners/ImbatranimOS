/**
 * norPDF — the reader application (PART A). Top-level composition of the reader
 * shell: owns the shared {@link ReaderController} (via context) and lays out the
 * console, side panel and main area. File I/O (OS open-intent + manual picker +
 * drag-drop) lives here.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  PART B MOUNT POINTS (all marked; not built in PART A)
 * ═══════════════════════════════════════════════════════════════════════════
 *  1. Annotate toolbar  → pass a node as `<TopBar toolbarSlot={…} />` (renders a
 *                         second console row, `data-slot="annotate-toolbar"`).
 *  2. Forms panel       → add a tab via `<SidePanel extraTabs={[…]} />`
 *                         ({ id, label, icon: <lucide comp>, render }).
 *  3. Organize view     → render in the `mode === 'organize'` branch of the main
 *                         area (swap out <Reader/>); toggle via `setMode('organize')`.
 *  4. Sign / dialogs    → mount alongside the shell (e.g. a signature dialog),
 *                         driving `doc.sign` then `bumpRenderEpoch()`.
 *  5. Per-page overlay  → PageView marks an annotation-overlay slot keyed to the
 *                         page's `vp` (PageViewport).
 *
 *  After a mutating edit (both actions are on the controller from useReader()):
 *   • in-place annotation add/update/delete → `bumpRenderEpoch()`
 *   • structural change (reorder/insert/delete) or `await doc.save()` →
 *     `await reloadDocument()`
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
// The pdf.js worker: hand the engine the bundled worker URL up front (the
// documented escape hatch). Runs once when this lazy chunk first loads.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { configureWorker } from '@pdfcore/engine'
import {
  fetchFileBytes,
  fileName,
  installMapGetOrInsert,
  notify,
  useFileDialog,
  useOpenIntent,
} from '@imbatranim/core'
import { Download, FileText } from 'lucide-react'
import { ReaderContext } from './app/context'
import { useReaderController } from './app/useReaderController'
import { EmptyState } from './app/EmptyState'
import { TopBar } from './shell/TopBar'
import { SidePanel } from './shell/SidePanel'
import type { SidePanelTab } from './shell/SidePanel'
import { Reader } from './reader/Reader'
import { EditorProvider } from './editor/EditorProvider'
import { AnnotateToolbar } from './editor/AnnotateToolbar'
import { SignatureDialog } from './editor/SignatureDialog'
import { FormsPanel } from './forms/FormsPanel'
import { OrganizeView } from './organize/OrganizeView'
import './norpdf.css'

// pdf.js 6.1 calls Map.prototype.getOrInsertComputed on every render; without
// it every page is blank on Chrome 141 and earlier (brief 91). Installed here,
// at module scope of this lazy chunk, so it is in place before the first render.
installMapGetOrInsert()
configureWorker(workerUrl)

export function NorPdf({ windowId }: { windowId: string }): JSX.Element {
  const ctrl = useReaderController(windowId)
  // One-shot open intent, drained by the shared hook (StrictMode-safe).
  const source = useOpenIntent(windowId)
  const [dragging, setDragging] = useState(false)
  const [fetching, setFetching] = useState(false)
  const dragDepth = useRef(0)

  // Ctrl/Cmd+S (write-back Save) is registered in TopBar, which lives inside
  // EditorProvider and can reach the editor's save-and-reload path.

  /* ── Open the OS-provided file once the intent latches ─────────────────── */
  const openBytes = ctrl.openBytes
  useEffect(() => {
    if (!source) return
    let cancelled = false
    void (async () => {
      setFetching(true)
      try {
        const buf = await fetchFileBytes(source.root, source.path)
        if (cancelled) return
        // Retain the source as the write-back target: Save writes back here,
        // rather than only offering a download.
        await openBytes(new Uint8Array(buf), fileName(source.path, 'document.pdf'), {
          root: source.root,
          path: source.path,
        })
      } catch (err) {
        if (!cancelled) {
          notify({
            title: 'Could not open PDF',
            body: err instanceof Error ? err.message : String(err),
            level: 'error',
            appId: 'norpdf',
          })
        }
      } finally {
        if (!cancelled) setFetching(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [source, openBytes])

  /* ── Manual open (OS picker + drag-drop) ───────────────────────────────── */
  // The OS's own Open dialog, browsing the CONTAINER's filesystem. It used to be
  // a native `<input type="file">`, which reads the *host* machine — the one
  // thing brief 54 rules out by name, because "the computer is the container"
  // and a dialog that browses the user's laptop instead of their home directory
  // is actively wrong here. The pick latches into the same store `useOpenIntent`
  // reads, so it runs the identical load path a File Manager double-click does.
  const { openFile: pickFromOs, fileDialog } = useFileDialog(windowId)
  const pickFile = useCallback(() => {
    void pickFromOs({ extensions: ['pdf'] })
  }, [pickFromOs])

  const takeFile = useCallback(
    (file: File | undefined | null) => {
      if (file) void ctrl.openFile(file)
    },
    [ctrl]
  )

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }, [])
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])
  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }, [])
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const file = Array.from(e.dataTransfer.files).find(
        (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
      )
      takeFile(file)
    },
    [takeFile]
  )

  // PART B: the Forms side-panel tab (appended to the reader's rail).
  const formsTab: SidePanelTab = {
    id: 'forms',
    label: 'Forms',
    icon: FileText,
    render: () => <FormsPanel />,
  }

  return (
    <ReaderContext.Provider value={ctrl}>
      <EditorProvider>
        <div
          className="bg-surface-container-lowest relative flex h-full min-h-0 flex-col"
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {fileDialog}

          {/* 1. PART B annotate toolbar mounts via `toolbarSlot` when a doc is open. */}
          <TopBar onOpenClick={pickFile} toolbarSlot={ctrl.doc ? <AnnotateToolbar /> : undefined} />

          <div className="flex min-h-0 flex-1">
            {/* 2. PART B forms tab appends to the side panel via `extraTabs`. */}
            {ctrl.doc && ctrl.panelOpen && <SidePanel extraTabs={[formsTab]} />}

            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
              {!ctrl.doc ? (
                <EmptyState
                  onOpenClick={pickFile}
                  error={ctrl.error}
                  loading={ctrl.loading || fetching}
                />
              ) : ctrl.mode === 'organize' ? (
                /* 3. PART B organize view replaces the reader here. */
                <div className="min-h-0 flex-1" data-slot="organize-view">
                  <OrganizeView />
                </div>
              ) : (
                <Reader />
              )}
            </main>
          </div>

          {/* 4. PART B: signature capture pad (Sign tool + form signature fields). */}
          <SignatureDialog />

          {dragging && (
            <div
              className="border-primary bg-surface/80 pointer-events-none absolute inset-2 z-50 grid place-items-center border-2 border-dashed backdrop-blur-sm"
              aria-hidden="true"
            >
              <div className="text-on-surface flex flex-col items-center gap-2">
                <Download size={34} strokeWidth={1.5} />
                <p className="font-ui text-[13px]">Drop a PDF to open</p>
              </div>
            </div>
          )}
        </div>
      </EditorProvider>
    </ReaderContext.Provider>
  )
}
