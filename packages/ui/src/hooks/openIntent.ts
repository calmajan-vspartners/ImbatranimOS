import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useSystem } from '../systemContext'
import type { FileChoice, PickOpenOptions, PickSaveOptions } from '../system'

export type OpenedFile = FileChoice

/** The one-shot open-intent payload an app is launched with. */
type OpenPayload = { openPath?: string; root?: string }

/**
 * windowId → the file that window is editing, plus a tiny subscription so the
 * hook below is reactive. Module-level and SDK-private: the OS never sees it,
 * because which file an app has open is the app's own business — the OS only
 * delivered the intent.
 */
const fileMap = new Map<string, OpenedFile>()
const listeners = new Set<() => void>()

function latch(windowId: string, file: OpenedFile): void {
  const prev = fileMap.get(windowId)
  // Idempotent for StrictMode's double effects: same file, no notification.
  if (prev && prev.root === file.root && prev.path === file.path) return
  fileMap.set(windowId, file)
  listeners.forEach((l) => l())
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Test seam: forget every latched file. */
export function resetOpenedFilesForTest(): void {
  fileMap.clear()
  listeners.forEach((l) => l())
}

/**
 * The file this window was opened with (File Manager double-click, a recent
 * entry, the Open dialog), or null. Reactive: a payload re-delivered to an
 * already-open window latches the new file and re-renders.
 */
export function useOpenIntent(): OpenedFile | null {
  const system = useSystem()
  const windowId = system.windowId

  useEffect(() => {
    if (windowId === null) return
    return system.intents.onIntent((payload) => {
      const p = payload as OpenPayload | undefined
      if (p && typeof p.openPath === 'string' && typeof p.root === 'string') {
        latch(windowId, { root: p.root, path: p.openPath })
      }
    })
  }, [system, windowId])

  return useSyncExternalStore(subscribe, () =>
    windowId === null ? null : (fileMap.get(windowId) ?? null)
  )
}

/**
 * The OS Open / Save-as dialog, portal-style (brief 48): the OS renders the
 * picker and the app awaits pure data. A successful `openFile` also latches
 * the choice into the same store `useOpenIntent` reads, so the app's one load
 * path fires exactly as if File Manager had handed it the file.
 *
 * The old core hook returned a `fileDialog` node the app had to render; the
 * portal owns rendering now, so there is nothing to place in the tree.
 */
export function useFileDialog() {
  const system = useSystem()

  const openFile = useCallback(
    async (opts: PickOpenOptions = {}): Promise<FileChoice | null> => {
      const choice = await system.fs.pickOpen(opts)
      if (choice && system.windowId !== null) latch(system.windowId, choice)
      if (choice) system.fs.recordRecent(choice.root, choice.path)
      return choice
    },
    [system]
  )

  const saveFile = useCallback(
    async (opts: PickSaveOptions = {}): Promise<FileChoice | null> => {
      const choice = await system.fs.pickSave(opts)
      // A saved-as file is a recent file too — it is where the user's
      // attention just went.
      if (choice) system.fs.recordRecent(choice.root, choice.path)
      return choice
    },
    [system]
  )

  const pickDirectory = useCallback(
    (opts: { title?: string } = {}) => system.fs.pickDirectory(opts),
    [system]
  )

  return { openFile, saveFile, pickDirectory }
}
