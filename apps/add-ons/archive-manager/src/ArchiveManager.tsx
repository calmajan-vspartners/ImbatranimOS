import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  FileArchive,
  Folder,
  File as FileIcon,
  Loader2,
  PackageOpen,
  X,
  XCircle,
} from 'lucide-react'
import { Button, cn, useSystem } from '@imbatranim/ui'
import {
  basename,
  compressPaths,
  errorMessage,
  fetchJob,
  formatBytes,
  listArchive,
  listDir,
  startExtractJob,
} from './lib/archiveApi'
import type { ArchiveIntent, ArchiveListing, DirEntry } from './types'
import { deliveryFor, normaliseIntent, type Phase } from './lib/intentDelivery'
import { EntryBrowser } from './components/EntryBrowser'
import { APP_NAME } from './appName'

interface Outcome {
  title: string
  detail: string
  contents: DirEntry[]
}

/** How often the job is polled. Fast enough to feel live, slow enough to be cheap. */
const POLL_MS = 400

/**
 * Browse an archive, then extract all of it or just part of it.
 *
 * Brief 78 turned this from a progress window into a browser: an extract intent now
 * **lists first** and waits, because being able to see what is in a zip and pull out
 * one file is most of what an archive manager is for. Extraction runs as a polled
 * job so a large archive shows progress instead of looking hung.
 *
 * All the security — the FS jail, the zip-slip guard, the resource caps, and the
 * re-validation of a selected subset — lives on the backend. This is purely UI, and
 * deliberately so: a selection made here is untrusted input there.
 */
export function ArchiveManager({ windowId: _windowId }: { windowId: string }) {
  const system = useSystem()
  const close = useCallback(() => system.window.requestClose(), [system])

  const [phase, setPhase] = useState<Phase>('idle')
  const [label, setLabel] = useState('')
  const [percent, setPercent] = useState<number | null>(null)
  const [listing, setListing] = useState<ArchiveListing | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [source, setSource] = useState<{ root: string; path: string; dest?: string } | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [errorText, setErrorText] = useState('')

  // Re-delivery plumbing (brief 108). `phaseRef` mirrors the committed phase so
  // the delivery rule can read it from an event handler; `pendingIntentRef`
  // holds at most the NEWEST payload that arrived mid-extraction.
  const phaseRef = useRef<Phase>('idle')
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])
  const pendingIntentRef = useRef<ArchiveIntent | null>(null)
  const applyIntentRef = useRef<(intent: ArchiveIntent) => void>(() => {})

  /** A settled job takes whatever arrived while it was running. */
  const flushPending = useCallback(() => {
    const next = pendingIntentRef.current
    if (!next) return
    pendingIntentRef.current = null
    applyIntentRef.current(next)
  }, [])

  const fail = useCallback(
    (err: unknown) => {
      const msg = errorMessage(err)
      setErrorText(msg)
      setPhase('error')
      system.notify({
        title: 'Archive operation failed',
        body: msg,
        level: 'error',
      })
      flushPending()
    },
    [system, flushPending]
  )

  /**
   * Run an extraction as a polled job.
   *
   * `entries` empty means the whole archive. The poll is the only reason a big
   * extract is distinguishable from a hang, and it is also where a failure that
   * happens minutes in gets reported instead of silently ending.
   */
  const runExtract = useCallback(
    async (root: string, path: string, dest: string | undefined, entries: string[]) => {
      setLabel(
        entries.length > 0
          ? `Extracting ${entries.length} item${entries.length === 1 ? '' : 's'}…`
          : `Extracting ${basename(path)}…`
      )
      setPercent(0)
      setPhase('running')
      try {
        const { id } = await startExtractJob(
          system.http,
          root,
          path,
          dest,
          entries.length ? entries : undefined
        )
        for (;;) {
          await new Promise((r) => setTimeout(r, POLL_MS))
          const job = await fetchJob(system.http, id)
          setPercent(job.percent)
          if (job.state === 'running') continue
          if (job.state === 'failed') {
            fail(new Error(job.error ?? 'Extraction failed'))
            return
          }
          const result = job.result!
          let contents: DirEntry[] = []
          try {
            contents = await listDir(system.http, root, result.dest)
          } catch {
            contents = []
          }
          setOutcome({
            title: 'Extracted',
            detail: `${result.entries} file${result.entries === 1 ? '' : 's'} · ${formatBytes(
              result.totalBytes
            )} → ${result.dest}`,
            contents,
          })
          setPhase('done')
          system.notify({
            title: 'Extraction complete',
            body: `${basename(path)} → ${result.dest}`,
            level: 'success',
          })
          flushPending()
          return
        }
      } catch (err) {
        fail(err)
      }
    },
    [fail, system, flushPending]
  )

  const run = useCallback(
    async (intent: ArchiveIntent) => {
      if (intent.action === 'extract') {
        // List first, and WAIT. The user gets to see what is inside and decide.
        setSource({ root: intent.root, path: intent.path, dest: intent.dest })
        setLabel(`Reading ${basename(intent.path)}…`)
        setPhase('listing')
        try {
          const found = await listArchive(system.http, intent.root, intent.path)
          setListing(found)
          setPhase('browsing')
        } catch (err) {
          fail(err)
        }
        return
      }

      setLabel(`Compressing ${intent.paths.length} item${intent.paths.length === 1 ? '' : 's'}…`)
      setPercent(null)
      setPhase('running')
      try {
        const res = await compressPaths(
          system.http,
          intent.root,
          intent.paths,
          intent.dest,
          intent.format
        )
        setOutcome({
          title: 'Compressed',
          detail: `${res.entries} file${res.entries === 1 ? '' : 's'} · ${formatBytes(
            res.bytes
          )} → ${intent.dest}`,
          contents: [],
        })
        setPhase('done')
        flushPending()
        system.notify({
          title: 'Archive created',
          body: `${res.entries} file${res.entries === 1 ? '' : 's'} → ${intent.dest}`,
          level: 'success',
        })
      } catch (err) {
        fail(err)
      }
    },
    [fail, system, flushPending]
  )

  /**
   * Start a delivered intent from a clean slate.
   *
   * The reset is explicit and total: a switched-to archive must never show the
   * previous archive's listing, selection or outcome.
   */
  const applyIntent = useCallback(
    (intent: ArchiveIntent) => {
      setListing(null)
      setSelected(new Set())
      setSource(null)
      setOutcome(null)
      setErrorText('')
      setPercent(null)
      setLabel('')
      void run(intent)
    },
    [run]
  )
  useEffect(() => {
    applyIntentRef.current = applyIntent
  }, [applyIntent])

  /**
   * SUBSCRIBE to intents rather than draining once (brief 108).
   *
   * `openApp` on an already-open single-instance app focuses the window and
   * re-sets its intent — but the old consume-once effect never looked again,
   * so opening zip B while zip A was on screen silently dropped B. Archive
   * Manager is the only manifest that is both single-instance and declares
   * `opens`, so it is the one app where a user hits this.
   *
   * `onIntent` delivers the pending launch payload immediately on subscribe,
   * which is also why `startedRef` retired: a StrictMode remount finds nothing
   * left to double-run, and the unsubscriber is the effect's cleanup.
   */
  const deliverRef = useRef<(raw: unknown) => void>(() => {})
  useEffect(() => {
    deliverRef.current = (raw: unknown) => {
      const intent = normaliseIntent(raw)
      switch (deliveryFor(phaseRef.current, intent)) {
        case 'run':
          applyIntentRef.current(intent!)
          break
        case 'defer':
          // Latest wins: the intent map holds one slot per window, so a deeper
          // queue would be state the store cannot back.
          pendingIntentRef.current = intent
          break
        case 'ignore':
          break
      }
    }
  })
  useEffect(() => system.intents.onIntent((raw) => deliverRef.current(raw)), [system])

  const toggle = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  return (
    <div className="bg-surface text-on-surface flex h-full flex-col">
      <div className="border-outline-variant bg-surface-container-low flex items-center gap-2 border-b px-3 py-2">
        <FileArchive size={15} strokeWidth={1.75} className="text-primary" />
        <span className="text-[12px] font-bold tracking-tight">{APP_NAME}</span>
        {source && (
          <span className="text-on-surface-variant min-w-0 truncate text-[11px]">
            {basename(source.path)}
          </span>
        )}
        <div className="flex-1" />
        <button
          title="Close"
          aria-label="Close"
          onClick={close}
          className="hover:bg-error hover:text-on-error border-outline-variant flex h-7 w-7 items-center justify-center border transition-colors"
        >
          <X size={14} strokeWidth={1.75} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        {phase === 'idle' && (
          <div className="text-on-surface-variant m-auto max-w-[80%] text-center text-[12px]">
            Right-click an archive in Files and choose
            <span className="text-on-surface font-semibold"> Extract here</span> to look inside it,
            or select items and choose
            <span className="text-on-surface font-semibold"> Compress</span>.
          </div>
        )}

        {(phase === 'listing' || phase === 'running') && (
          <div className="text-on-surface m-auto flex w-full max-w-sm flex-col items-center gap-3 text-[12px] font-semibold">
            <Loader2 size={26} strokeWidth={1.75} className="animate-spin" />
            {label}
            {percent !== null && (
              <>
                <div
                  className="border-outline-variant h-2 w-full border"
                  role="progressbar"
                  aria-valuenow={percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="bg-primary h-full transition-all"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <span className="text-on-surface-variant font-normal tabular-nums">{percent}%</span>
              </>
            )}
          </div>
        )}

        {phase === 'browsing' && listing && source && (
          <>
            <EntryBrowser
              listing={listing}
              selected={selected}
              onToggle={toggle}
              onSelectAll={(names) => setSelected(new Set(names))}
              onClear={() => setSelected(new Set())}
            />
            <div className="flex shrink-0 items-center justify-end gap-2">
              <Button variant="default" size="sm" onClick={close}>
                Close
              </Button>
              <Button
                variant="default"
                size="sm"
                className="gap-1"
                disabled={selected.size === 0 || listing.encrypted}
                onClick={() =>
                  void runExtract(source.root, source.path, source.dest, [...selected])
                }
              >
                <PackageOpen size={12} strokeWidth={2} />
                Extract selected ({selected.size})
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="gap-1"
                disabled={listing.encrypted}
                onClick={() => void runExtract(source.root, source.path, source.dest, [])}
              >
                <PackageOpen size={12} strokeWidth={2} />
                Extract all
              </Button>
            </div>
          </>
        )}

        {phase === 'error' && (
          <div className="m-auto flex max-w-[90%] flex-col items-center gap-2 text-center">
            <XCircle size={26} strokeWidth={1.75} className="text-error" />
            <div className="text-[12px] font-semibold">Operation failed</div>
            <div className="text-on-surface-variant text-[11px]">{errorText}</div>
            <Button variant="default" size="sm" onClick={close}>
              Close
            </Button>
          </div>
        )}

        {phase === 'done' && outcome && (
          <>
            <div className="flex items-center gap-2">
              <CheckCircle2 size={18} strokeWidth={1.75} className="text-primary" />
              <div>
                <div className="text-[12px] font-semibold">{outcome.title}</div>
                <div className="text-on-surface-variant text-[11px]">{outcome.detail}</div>
              </div>
            </div>

            {outcome.contents.length > 0 && (
              <div className="border-outline-variant min-h-0 flex-1 overflow-auto border">
                <ul className="divide-outline-variant/50 divide-y">
                  {outcome.contents.map((entry) => (
                    <li
                      key={entry.path}
                      className="hover:bg-surface-container-high flex items-center gap-2 px-2 py-1 text-[11px]"
                    >
                      {entry.type === 'directory' ? (
                        <Folder size={13} strokeWidth={1.75} className="text-primary shrink-0" />
                      ) : (
                        <FileIcon
                          size={13}
                          strokeWidth={1.75}
                          className="text-on-surface-variant shrink-0"
                        />
                      )}
                      <span className="truncate">{entry.name}</span>
                      <span className="text-on-surface-variant ml-auto shrink-0 tabular-nums">
                        {entry.type === 'file' ? formatBytes(entry.size) : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button
              onClick={close}
              className={cn(
                'border-outline-variant hover:bg-surface-container-high self-end border px-3 py-1.5',
                'text-[12px] font-semibold transition-colors'
              )}
            >
              Done
            </button>
          </>
        )}
      </div>
    </div>
  )
}
