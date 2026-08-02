import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Dialog } from '../components/ui/Dialog'
import { FilePicker } from '../components/files/FilePicker'
import { setOpenedFile } from './useOpenIntent'

export type FileChoice = { root: string; path: string }

type OpenOptions = {
  title?: string
  /** Preferred extensions, lowercase without the dot. A hint, not a jail. */
  extensions?: string[]
}

type SaveOptions = OpenOptions & { suggestedName?: string }

/**
 * The OS's Open / Save-as dialog.
 *
 * Shaped like `useConfirm` / `usePrompt` — await a promise, render the returned
 * element — because that is already the house pattern for imperative dialogs.
 *
 * Pass a `windowId` and a successful `openFile` also latches the choice into
 * the same opened-file store `useOpenIntent` reads. That is what makes adoption
 * one button per app: the app's existing load path fires exactly as it does
 * when File Manager hands it a file, with no second code path to maintain.
 */
export function useFileDialog(windowId?: string) {
  const [state, setState] = useState<{
    mode: 'open' | 'save'
    title: string
    extensions?: string[]
    suggestedName?: string
  } | null>(null)
  const resolveRef = useRef<((choice: FileChoice | null) => void) | null>(null)

  const finish = useCallback((choice: FileChoice | null) => {
    setState(null)
    resolveRef.current?.(choice)
    resolveRef.current = null
  }, [])

  const openFile = useCallback(
    (opts: OpenOptions = {}) =>
      new Promise<FileChoice | null>((resolve) => {
        resolveRef.current = (choice) => {
          if (choice && windowId) setOpenedFile(windowId, choice)
          resolve(choice)
        }
        setState({
          mode: 'open',
          title: opts.title ?? 'Open file',
          extensions: opts.extensions,
        })
      }),
    [windowId]
  )

  const saveFile = useCallback(
    (opts: SaveOptions = {}) =>
      new Promise<FileChoice | null>((resolve) => {
        resolveRef.current = resolve
        setState({
          mode: 'save',
          title: opts.title ?? 'Save as',
          extensions: opts.extensions,
          suggestedName: opts.suggestedName,
        })
      }),
    []
  )

  const fileDialog: ReactNode = state ? (
    <Dialog
      open
      onOpenChange={(open) => {
        // Closing by Escape or the backdrop resolves null — a cancel, not a hang.
        if (!open) finish(null)
      }}
      title={state.title}
    >
      <FilePicker
        mode={state.mode}
        extensions={state.extensions}
        suggestedName={state.suggestedName}
        onPick={(choice) => finish(choice)}
      />
    </Dialog>
  ) : null

  return { openFile, saveFile, fileDialog }
}
