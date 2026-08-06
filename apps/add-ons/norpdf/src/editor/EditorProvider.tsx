/**
 * Holds all PART B editor state and the annotation mutation actions, and
 * provides them via {@link EditorContext}. Mounted inside NorPdf, wrapping the
 * app body, so the annotate toolbar, the per-page overlay, the forms panel and
 * the organize view all share one controller.
 *
 * Re-render contract (from the PART A handoff):
 *  • adding an annotation is an overlay-only preview → `bumpRenderEpoch()`;
 *  • making it (or a form value / page order) show in the rasterised canvas
 *    needs `doc.save()` then `reloadDocument()` — that is {@link syncRaster}.
 * We keep session-added ids in `addedIds` and render only those in the overlay,
 * so a mark never appears twice (once baked, once overlaid).
 */
import { useCallback, useMemo, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import type { AnnotationSpec, Color, SignatureMark } from '@pdfcore/engine'
import { useSystem } from '@imbatranim/ui'
import { useReader } from '../app/context'
import { EditorContext } from './context'
import type { AnnotateTool, EditorController } from './types'

const DEFAULT_COLOR: Color = { r: 0.95, g: 0.72, b: 0.2 } // saffron marker

const msgOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Download bytes as a `.pdf` — the fallback when a document has no OS home. */
function downloadBytes(bytes: Uint8Array, name: string): void {
  const buf = bytes.slice().buffer
  const blob = new Blob([buf], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name.replace(/\.pdf$/i, '') || 'document'}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function EditorProvider({ children }: { children: ReactNode }): JSX.Element {
  const system = useSystem()
  const ctrl = useReader()
  const { doc, docName, saveTarget, reloadDocument, markDirty, markSaved } = ctrl

  const [tool, setToolState] = useState<AnnotateTool>('select')
  const [color, setColor] = useState<Color>(DEFAULT_COLOR)
  const [opacity, setOpacity] = useState(1)
  const [strokeWidth, setStrokeWidth] = useState(2)
  const [signMark, setSignMark] = useState<SignatureMark | null>(null)
  const [signDialogOpen, setSignDialogOpen] = useState(false)
  const [signFieldName, setSignFieldName] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Session-added, not-yet-baked annotation ids. Held as plain state and mutated
  // with functional updates (consecutive synchronous adds accumulate correctly),
  // so no render-phase ref writes are needed.
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())

  // Reset all session state when a different document is opened — the
  // "adjust state on prop change during render" pattern (not an effect).
  const [lastDoc, setLastDoc] = useState(doc)
  if (doc !== lastDoc) {
    setLastDoc(doc)
    setAddedIds(new Set())
    setSelectedId(null)
    setToolState('select')
    setSignMark(null)
  }

  const setTool = useCallback((next: AnnotateTool) => {
    setSelectedId(null)
    setToolState(next)
  }, [])

  const addAnnotation = useCallback(
    (spec: AnnotationSpec): string => {
      if (!doc) return ''
      const id = doc.annotate.add(spec)
      // Overlay-only preview: the mark renders in the SVG overlay, driven by the
      // addedIds change — no raster re-key (which would flash the canvas).
      setAddedIds((prev) => new Set(prev).add(id))
      // An unsaved edit — arm the close guard and the Save button.
      markDirty()
      return id
    },
    [doc, markDirty]
  )

  const syncRaster = useCallback(async () => {
    if (!doc) return
    setBusy(true)
    try {
      await doc.save()
      await reloadDocument()
      // Everything is baked into the fresh raster now.
      setAddedIds(new Set())
      // Baked in memory, but not yet written to disk — still a dirty document.
      markDirty()
    } finally {
      setBusy(false)
    }
  }, [doc, reloadDocument, markDirty])

  /**
   * The primary Save. Serialise the document and WRITE IT BACK to the OS file it
   * came from, then run the SAME reload+clear path `syncRaster` uses so the
   * overlay and the baked raster stay in sync (T1-1 + T1-2). Falls back to a
   * download for a document with no OS home.
   */
  const saveToDisk = useCallback(async () => {
    if (!doc) return
    setBusy(true)
    try {
      const bytes = await doc.save()
      if (saveTarget) {
        await system.fs.upload(saveTarget.root, saveTarget.path, bytes, docName || 'document.pdf')
      } else {
        downloadBytes(bytes, docName)
      }
      // Re-read from the saved bytes and drop the overlay marks — they are baked
      // into the raster now, so leaving them in `addedIds` would double-render
      // each mark (baked + overlay) and send its delete down the overlay-only
      // branch. This is exactly what `syncRaster` does after a bake.
      await reloadDocument()
      setAddedIds(new Set())
      markSaved()
      system.notify({
        level: 'success',
        title: saveTarget ? 'Saved' : 'Saved a copy',
        body: saveTarget
          ? `“${docName}” written back to disk.`
          : 'This document has no file to write back to, so a copy was downloaded.',
      })
    } catch (err) {
      // `dirty` is deliberately left armed: the bytes did not land, so the
      // document still differs from disk and the close guard must stay on.
      system.notify({ level: 'error', title: 'Save failed', body: msgOf(err) })
    } finally {
      setBusy(false)
    }
  }, [doc, saveTarget, docName, reloadDocument, markSaved, system])

  const deleteAnnotation = useCallback(
    async (id: string) => {
      if (!doc) return
      doc.annotate.delete(id)
      setSelectedId((cur) => (cur === id ? null : cur))
      if (addedIds.has(id)) {
        // Session mark, overlay-only — drop it; the overlay refreshes on the
        // addedIds change.
        setAddedIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      } else {
        // Already baked into the raster — re-rasterise without it. `syncRaster`
        // can reject (save/reload failure); surface it rather than let it become
        // an unhandled rejection with no user feedback (M6).
        try {
          await syncRaster()
        } catch (err) {
          system.notify({ level: 'error', title: 'Delete failed', body: msgOf(err) })
        }
      }
    },
    [doc, addedIds, syncRaster, system]
  )

  const openSignDialog = useCallback(() => {
    setSignFieldName(null)
    setSignDialogOpen(true)
  }, [])
  const openSignDialogForField = useCallback((name: string) => {
    setSignFieldName(name)
    setSignDialogOpen(true)
  }, [])
  const closeSignDialog = useCallback(() => setSignDialogOpen(false), [])

  const applySignatureMark = useCallback(
    (mark: SignatureMark) => {
      setSignDialogOpen(false)
      if (signFieldName && doc) {
        // Fill a specific AcroForm signature field, then bake it into the raster.
        doc.sign.fillSignatureField(signFieldName, mark)
        setSignFieldName(null)
        void syncRaster().catch((err) =>
          system.notify({ level: 'error', title: 'Sign failed', body: msgOf(err) })
        )
        return
      }
      // Arm the Sign tool: the next drag on a page places the mark.
      setSignMark(mark)
      setTool('sign')
    },
    [doc, signFieldName, syncRaster, setTool, system]
  )

  const value = useMemo<EditorController>(
    () => ({
      tool,
      setTool,
      color,
      setColor,
      opacity,
      setOpacity,
      strokeWidth,
      setStrokeWidth,
      signMark,
      setSignMark,
      signDialogOpen,
      openSignDialog,
      openSignDialogForField,
      closeSignDialog,
      applySignatureMark,
      selectedId,
      setSelectedId,
      addAnnotation,
      deleteAnnotation,
      addedIds,
      syncRaster,
      saveToDisk,
      busy,
    }),
    [
      tool,
      setTool,
      color,
      opacity,
      strokeWidth,
      signMark,
      signDialogOpen,
      openSignDialog,
      openSignDialogForField,
      closeSignDialog,
      applySignatureMark,
      selectedId,
      addAnnotation,
      deleteAnnotation,
      addedIds,
      syncRaster,
      saveToDisk,
      busy,
    ]
  )

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
}
