import { useEffect } from 'react'
import { useIntentStore } from '../store/intentStore'
import { createOpenedFileStore, type OpenedFile } from '../store/createOpenedFileStore'

/** The one-shot open-intent payload an add-on is launched with. */
type OpenPayload = { openPath?: string; root?: string }

// ONE module-level opened-file store shared by every window that uses this hook.
// Created exactly once (not per-render, not per-window) so latched files survive
// re-renders and StrictMode remounts.
const useOpenedFileStore = createOpenedFileStore()

/**
 * Drain the one-shot open intent for `windowId` into a per-window store and
 * return the latched file (or null before/without one).
 *
 * The intent is consumed exactly once in a ref-guarded effect — never in a
 * render selector, because StrictMode double-renders would drain it twice. Only
 * latches when both `root` and `openPath` are present.
 */
/**
 * Latch a file into the same per-window store `useOpenIntent` reads.
 *
 * Used by the Open dialog so a file chosen inside an app drives that app's
 * existing load path, identical to being handed one by File Manager. Without
 * this, every app would need a second way in.
 */
export function setOpenedFile(windowId: string, file: OpenedFile): void {
  useOpenedFileStore.getState().setFile(windowId, file)
}

/** Read the latched file for a window without subscribing (close cleanup / tests). */
export function getOpenedFile(windowId: string): OpenedFile | null {
  return useOpenedFileStore.getState().fileMap[windowId] ?? null
}

/** Drop a window's latched file so the per-window entry does not leak on close. */
export function clearOpenedFile(windowId: string): void {
  useOpenedFileStore.getState().clearFile(windowId)
}

export function useOpenIntent(windowId: string): OpenedFile | null {
  const source = useOpenedFileStore((s) => s.fileMap[windowId]) ?? null
  const setFile = useOpenedFileStore((s) => s.setFile)
  // Subscribe to the intent reactively: a re-delivered payload to an already-open
  // window (extract A, then extract B) mints a NEW payload object, so the effect
  // below — keyed on that value — fires again and latches the new file. The old
  // ref-guard consumed exactly once and silently dropped every later payload.
  const intent = useIntentStore((s) => s.intents.get(windowId)) as OpenPayload | undefined
  useEffect(() => {
    if (intent?.openPath && intent?.root) {
      // Drain first, then latch. StrictMode double-invokes this effect: the second
      // pass sees the intent already gone (consumeIntent is a no-op) and re-latches
      // the same file (setFile is idempotent), so the drain stays exactly-once in
      // effect even though the effect body runs twice.
      useIntentStore.getState().consumeIntent(windowId)
      setFile(windowId, { root: intent.root, path: intent.openPath })
    }
  }, [windowId, intent, setFile])
  return source
}
