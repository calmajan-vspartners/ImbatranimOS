import { Crop, FolderOpen, Monitor, Timer } from 'lucide-react'
import { Button, cn } from '@imbatranim/core'
import { DELAYS, type LaunchMode } from '../lib/captureModes'

/**
 * What the app opens to.
 *
 * The app used to arm capture on launch: opening it dropped a full-screen overlay that
 * swallowed every click on the desktop. Escape did get out (and the overlay said so, which
 * the brief claims it did not), but an app that seizes the whole screen the instant it is
 * launched is startling, and it made the desktop unusable for anyone who had opened it by
 * accident. Capture is now armed by choosing a mode.
 *
 * The capture model is stated here rather than left implicit. This tool rasterises the DOM;
 * it is not reading the screen, and the difference shows up in `<canvas>`, `<video>` and
 * cross-origin images. Saying so once, where the user is deciding, is cheaper than a
 * mysterious blank rectangle in a saved PNG.
 */
export function CaptureLauncher({
  onArm,
  onOpenSaved,
  busy,
}: {
  onArm: (mode: LaunchMode) => void
  onOpenSaved: () => void
  busy: boolean
}) {
  const row =
    'flex w-full items-center gap-2 border px-2.5 py-2 text-left text-[12px] font-medium ' +
    'border-outline-variant text-on-surface hover:bg-surface-container-high ' +
    'disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <div className="bg-surface-container-lowest flex h-full flex-col gap-2 overflow-auto p-3">
      <button
        type="button"
        className={cn(row, 'border-primary')}
        disabled={busy}
        onClick={() => onArm({ kind: 'region' })}
      >
        <Crop size={14} strokeWidth={1.75} />
        <span className="flex-1">Select a region</span>
        <span className="text-on-surface-variant text-[10px]">drag · Esc to cancel</span>
      </button>

      <button
        type="button"
        className={row}
        disabled={busy}
        onClick={() => onArm({ kind: 'fullscreen' })}
      >
        <Monitor size={14} strokeWidth={1.75} />
        <span className="flex-1">Whole desktop</span>
      </button>

      {DELAYS.map((seconds) => (
        <button
          key={seconds}
          type="button"
          className={row}
          disabled={busy}
          onClick={() => onArm({ kind: 'delayed', seconds })}
        >
          <Timer size={14} strokeWidth={1.75} />
          <span className="flex-1">Whole desktop after {seconds}s</span>
          <span className="text-on-surface-variant text-[10px]">for menus &amp; hovers</span>
        </button>
      ))}

      <div className="bg-outline-variant my-1 h-px w-full" />

      <Button size="sm" variant="default" onClick={onOpenSaved} disabled={busy}>
        <span className="flex items-center gap-1.5">
          <FolderOpen size={13} strokeWidth={1.75} />
          Open a saved capture…
        </span>
      </Button>

      <p className="text-on-surface-variant mt-auto text-[10px] leading-relaxed">
        Captures are drawn from the desktop's own markup, not read off the screen, so
        <span className="text-on-surface"> canvas and video content may be missing</span>. You will
        be told when a capture contained any.
      </p>
    </div>
  )
}
