import { useMemo } from 'react'
import { Columns2, Minus, Plus, Rows3 } from 'lucide-react'
import { Button, ScrollArea, cn } from '@imbatranim/core'
import {
  hunkStats,
  parseDiff,
  patchForHunk,
  toSideBySide,
  wordDiff,
  type DiffLine,
  type FileDiff,
  type Hunk,
} from '../lib/diffModel'

/**
 * The diff pane: unified or side-by-side, word-level highlight, per-hunk staging.
 *
 * Per-hunk is the feature that makes this a Git GUI rather than a diff viewer — it
 * is how a reviewable commit gets built. The button hands `patchForHunk`'s output
 * up to the caller, which POSTs it to `git apply --cached`; nothing here talks to
 * the network.
 */

export type DiffViewProps = {
  diff: string
  /** True when the pane is showing the index side, which flips what a hunk does. */
  staged: boolean
  sideBySide: boolean
  onToggleLayout: () => void
  /** Stage (or unstage, when `staged`) one hunk. */
  onApplyHunk: (patch: string, reverse: boolean) => void
  busy: boolean
}

export function DiffView({
  diff,
  staged,
  sideBySide,
  onToggleLayout,
  onApplyHunk,
  busy,
}: DiffViewProps) {
  const files = useMemo(() => parseDiff(diff), [diff])

  if (diff.trim().length === 0) {
    return (
      <div className="text-on-surface-variant flex flex-1 items-center justify-center text-[12px]">
        No changes to show
      </div>
    )
  }

  const totalHunks = files.reduce((n, f) => n + f.hunks.length, 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-outline-variant bg-surface-container-low flex shrink-0 items-center gap-2 border-b px-2 py-1">
        <span className="font-ui text-on-surface-variant text-[11px]">
          {totalHunks} hunk{totalHunks === 1 ? '' : 's'}
        </span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          onClick={onToggleLayout}
          aria-pressed={sideBySide}
          title={sideBySide ? 'Switch to a single column' : 'Switch to side by side'}
        >
          {sideBySide ? (
            <Rows3 size={12} strokeWidth={2} />
          ) : (
            <Columns2 size={12} strokeWidth={2} />
          )}
          {sideBySide ? 'Unified' : 'Side by side'}
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1" orientation="both">
        {files.map((file) => (
          <div key={`${file.oldPath}->${file.newPath}`}>
            <div className="bg-surface-container text-on-surface font-ui sticky top-0 z-10 px-2 py-1 text-[11px] font-semibold">
              {file.path}
              {file.oldPath && file.newPath && file.oldPath !== file.newPath && (
                <span className="text-on-surface-variant font-normal"> ← {file.oldPath}</span>
              )}
            </div>
            {file.binary ? (
              <div className="text-on-surface-variant px-2 py-2 text-[12px]">
                Binary file — nothing to show
              </div>
            ) : (
              file.hunks.map((hunk, i) => (
                <HunkBlock
                  key={`${hunk.header}:${i}`}
                  file={file}
                  hunk={hunk}
                  staged={staged}
                  sideBySide={sideBySide}
                  onApplyHunk={onApplyHunk}
                  busy={busy}
                />
              ))
            )}
          </div>
        ))}
      </ScrollArea>
    </div>
  )
}

function HunkBlock({
  file,
  hunk,
  staged,
  sideBySide,
  onApplyHunk,
  busy,
}: {
  file: FileDiff
  hunk: Hunk
  staged: boolean
  sideBySide: boolean
  onApplyHunk: (patch: string, reverse: boolean) => void
  busy: boolean
}) {
  const stats = hunkStats(hunk)
  return (
    <div className="border-outline-variant border-b last:border-b-0">
      <div className="bg-surface-container-low flex items-center gap-2 px-2 py-0.5">
        <span className="text-on-surface-variant font-mono text-[11px]">{hunk.header}</span>
        <span className="text-primary font-ui text-[11px]">+{stats.added}</span>
        <span className="text-error font-ui text-[11px]">−{stats.removed}</span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          disabled={busy}
          // Staging one hunk and unstaging one hunk are the same patch applied in
          // opposite directions — see applyPatch on the backend.
          onClick={() => onApplyHunk(patchForHunk(file, hunk), staged)}
          title={staged ? 'Unstage just this hunk' : 'Stage just this hunk'}
        >
          {staged ? <Minus size={11} strokeWidth={2} /> : <Plus size={11} strokeWidth={2} />}
          {staged ? 'Unstage hunk' : 'Stage hunk'}
        </Button>
      </div>
      {sideBySide ? <SideBySide hunk={hunk} /> : <Unified hunk={hunk} />}
    </div>
  )
}

const GUTTER =
  'text-on-surface-variant w-10 shrink-0 select-none px-1 text-right font-mono text-[11px]'

function Unified({ hunk }: { hunk: Hunk }) {
  return (
    <div className="font-mono text-[11px] leading-snug">
      {hunk.lines.map((line, i) => (
        <div key={i} className={cn('flex', bgFor(line.kind))}>
          <span className={GUTTER}>{line.oldNo ?? ''}</span>
          <span className={GUTTER}>{line.newNo ?? ''}</span>
          <span className={cn('w-3 shrink-0 select-none', fgFor(line.kind))}>
            {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
          </span>
          <span className="whitespace-pre">{line.text || ' '}</span>
        </div>
      ))}
    </div>
  )
}

function SideBySide({ hunk }: { hunk: Hunk }) {
  const rows = useMemo(() => toSideBySide(hunk), [hunk])
  return (
    <div className="font-mono text-[11px] leading-snug">
      {rows.map((row, i) => {
        // Word highlight only for a real replacement pair; highlighting a lone
        // insertion against nothing would mark the whole line for no information.
        const words = row.paired ? wordDiff(row.left!.text, row.right!.text) : null
        return (
          <div key={i} className="flex">
            <Side
              line={row.left}
              side="old"
              parts={words?.left}
              className="border-outline-variant w-1/2 min-w-0 border-r"
            />
            <Side line={row.right} side="new" parts={words?.right} className="w-1/2 min-w-0" />
          </div>
        )
      })}
    </div>
  )
}

function Side({
  line,
  side,
  parts,
  className,
}: {
  line: DiffLine | null
  side: 'old' | 'new'
  parts?: { text: string; changed: boolean }[]
  className?: string
}) {
  if (!line) {
    // A blank filler, tinted so the eye reads "nothing here" rather than "unchanged".
    return <div className={cn('bg-surface-container-low/60 flex', className)}>&nbsp;</div>
  }
  return (
    <div className={cn('flex', bgFor(line.kind), className)}>
      <span className={GUTTER}>{(side === 'old' ? line.oldNo : line.newNo) ?? ''}</span>
      <span className="min-w-0 whitespace-pre">
        {parts
          ? parts.map((part, i) => (
              <span
                key={i}
                className={cn(
                  part.changed &&
                    (line.kind === 'add'
                      ? 'bg-primary/25 text-on-surface'
                      : 'bg-error/25 text-on-surface')
                )}
              >
                {part.text}
              </span>
            ))
          : line.text || ' '}
      </span>
    </div>
  )
}

/**
 * Additions read as the accent and removals as `error`.
 *
 * §10 says never invent a colour to mean a state — but a diff is the one place the
 * whole convention of the tool is colour, and these are both existing tokens rather
 * than new ones. The **sign in the gutter** carries the same information for anyone
 * who cannot use the colour, which is what the rule is actually protecting.
 */
function bgFor(kind: DiffLine['kind']): string {
  if (kind === 'add') return 'bg-primary/10'
  if (kind === 'del') return 'bg-error/10'
  return ''
}

function fgFor(kind: DiffLine['kind']): string {
  if (kind === 'add') return 'text-primary'
  if (kind === 'del') return 'text-error'
  return 'text-on-surface-variant'
}
