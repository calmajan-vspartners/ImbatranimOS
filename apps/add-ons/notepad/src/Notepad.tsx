import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import {
  Button,
  api,
  notify,
  openApp,
  useFileDialog,
  useIntentStore,
  useWindowStore,
} from '@imbatranim/core'
import { NoteEditor } from './components/NoteEditor'
import { useNotepadStore, type OpenDoc } from './store/notepadStore'
import { useNotesRootHasFilesQuery, useUpsertRecentMutation } from './queries/notepadQueries'
import {
  defaultRoot,
  formatBytes,
  isTooLarge,
  MAX_OPEN_BYTES,
  type NotepadRoot,
} from './lib/notepadRoot'

/** Is a path inside the legacy notes tree, per the intent that opened us? */
function rootOf(value: unknown): NotepadRoot {
  return value === 'notes' ? 'notes' : 'home'
}

export function Notepad({ windowId }: { windowId: string }) {
  const doc = useNotepadStore((s) => s.editorMap[windowId])
  const setEditor = useNotepadStore((s) => s.setEditor)
  const clearEditor = useNotepadStore((s) => s.clearEditor)
  const openWindow = useWindowStore((s) => s.openWindow)
  const upsertRecent = useUpsertRecentMutation()

  // Which root to offer first. Asked once per session; see `lib/notepadRoot.ts` for
  // why the answer depends on whether the legacy notes root still has anything in it.
  const legacyQuery = useNotesRootHasFilesQuery()
  const initialRoot = defaultRoot(legacyQuery.data ?? null)

  const { openFile, fileDialog } = useFileDialog(windowId)
  const [checking, setChecking] = useState(false)

  /**
   * Refuse to open a file too large for a controlled textarea, and offer the app
   * that can handle it.
   *
   * The size is read from the directory listing rather than by downloading the file
   * — downloading a 200 MB log to discover it is too big to open would be the exact
   * problem this guard exists to avoid.
   */
  const openDoc = useCallback(
    async (next: OpenDoc) => {
      setChecking(true)
      try {
        const dir = next.path.includes('/') ? next.path.slice(0, next.path.lastIndexOf('/')) : ''
        const res = await api.get<{ name: string; path: string; size?: number }[]>('/files', {
          params: { root: next.root, path: dir },
        })
        const entry = res.data.find((e) => e.path === next.path)
        const size = entry?.size ?? NaN
        if (isTooLarge(size)) {
          notify({
            title: 'Too large for Notepad',
            body: `${next.path.split('/').pop()} is ${formatBytes(size)}. Notepad holds the whole file in memory, so anything over ${formatBytes(MAX_OPEN_BYTES)} types badly. Opening it in Code Editor instead.`,
            level: 'warning',
            appId: 'notepad',
          })
          // Handed off rather than just refused: "no" with nowhere to go is not help.
          openApp('code-editor', { openPath: next.path, root: next.root })
          return
        }
      } catch {
        // Could not read the size. Opening is the better failure than blocking the
        // user out of their own file.
      } finally {
        setChecking(false)
      }
      setEditor(windowId, next)
      upsertRecent.mutate(next.path)
    },
    [setEditor, windowId, upsertRecent]
  )

  // Drain the one-shot open intent exactly once in a ref-guarded effect — never in a
  // render selector, because StrictMode double-renders would drain it twice and
  // open-from-Files would arrive empty (brief 30).
  const consumedRef = useRef(false)
  useEffect(() => {
    if (consumedRef.current) return
    consumedRef.current = true
    const intent = useIntentStore.getState().consumeIntent(windowId) as
      | { openPath?: string; root?: string }
      | undefined
    if (intent?.openPath && !doc) {
      // The root comes from the intent: File Manager opens home files, and the
      // launcher can open either. Defaulting to `home` when absent matches every
      // other app rather than the old hardwired `notes`.
      //
      // Draining a one-shot intent IS the "sync from an external system" an effect is
      // for, and it runs at most once (ref-guarded). The state it sets is inside
      // `openDoc`'s async body, but the rule traces the call — same scoped disable
      // file-manager uses for the identical drain.
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      void openDoc({ root: rootOf(intent.root), path: intent.openPath })
    }
    // Mount-once drain; `doc`/`openDoc` are read at that instant only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowId])

  /**
   * Open through the shared picker.
   *
   * ONE button, not one per root: core's `FilePicker` already has a root switcher
   * (Home / Notes), which is the point of brief 54 promoting it — there is one picker
   * in the OS rather than Notepad's private copy plus everyone else's. The chosen
   * root comes back in the result, so both filesystems stay reachable without this
   * app reimplementing the switch.
   */
  const pick = useCallback(async () => {
    const choice = await openFile({
      title: 'Open in Notepad',
      extensions: ['txt', 'log', 'md', 'json', 'csv', 'conf', 'ini', 'yaml', 'yml'],
    })
    if (!choice) return
    await openDoc({ root: rootOf(choice.root), path: choice.path })
  }, [openFile, openDoc])

  function handleOpenInNewWindow(next: OpenDoc) {
    const newWindowId = openWindow(
      'notepad',
      next.path.split('/').pop() || 'Notepad',
      { width: 600, height: 500 },
      { width: 400, height: 300 }
    )
    setEditor(newWindowId, next)
    upsertRecent.mutate(next.path)
  }

  if (doc) {
    return <NoteEditor windowId={windowId} doc={doc} onBack={() => clearEditor(windowId)} />
  }

  return (
    <div className="bg-surface-container-lowest text-on-surface-variant flex h-full flex-col items-center justify-center gap-3 text-center">
      <FileText size={40} strokeWidth={1} />
      <span className="font-ui text-[12px]">Nothing open</span>

      {checking && (
        <span className="font-ui flex items-center gap-1 text-[11px]">
          <Loader2 size={11} className="animate-spin" /> checking the file…
        </span>
      )}

      <Button size="sm" variant="primary" onClick={() => void pick()}>
        Open a file
      </Button>

      {legacyQuery.data === true && (
        <span className="font-ui max-w-[300px] text-[10px]">
          Your existing notes are under the <span className="font-semibold">Notes</span> location in
          the picker. New files belong in <span className="font-semibold">Home</span>, where every
          other app can see them.
        </span>
      )}

      <button
        className="font-ui text-[10px] underline"
        onClick={() => handleOpenInNewWindow({ root: initialRoot ?? 'home', path: 'untitled.txt' })}
      >
        or start a new file in a new window
      </button>

      {fileDialog}
    </div>
  )
}
