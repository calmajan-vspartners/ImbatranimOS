import { Music, Video, ListMusic, History } from 'lucide-react'
import { ScrollArea, Tooltip, cn } from '@imbatranim/core'
import type { Track } from '../api/listDir'
import { formatTime } from '../lib/formatTime'
import { resumeKey } from '../lib/resume'

type PlaylistProps = {
  tracks: Track[]
  activePath: string | null
  /** Probed durations by path; absent until the probe reaches that track. */
  durations: Record<string, number>
  /** Remembered positions, `root:path` → seconds. */
  resume: Record<string, number>
  root: string
  onSelect: (path: string) => void
}

/**
 * The folder queue — sibling media files, name-sorted, click to switch.
 *
 * Two columns beyond the name, both from information the app already has: the duration
 * (probed lazily, see `useTrackDurations`) and a marker for a file with a remembered
 * position. Without the duration a queue is a list of filenames, which is what the brief
 * objected to; without the resume marker there is no way to see which of twelve episodes
 * you are part-way through.
 */
export function Playlist({ tracks, activePath, durations, resume, root, onSelect }: PlaylistProps) {
  return (
    <div className="border-outline-variant bg-surface-container-low flex h-full w-52 shrink-0 flex-col border-l">
      <div className="border-outline-variant flex items-center gap-1.5 border-b px-2 py-1.5">
        <ListMusic size={12} className="text-on-surface-variant shrink-0" />
        <span className="font-ui text-on-surface-variant text-[11px] font-semibold tracking-wide uppercase">
          Queue · {tracks.length}
        </span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ul className="flex flex-col">
          {tracks.map((track) => {
            const active = track.path === activePath
            const Icon = track.kind === 'video' ? Video : Music
            return (
              <li key={track.path}>
                <button
                  type="button"
                  onClick={() => onSelect(track.path)}
                  className={cn(
                    'font-ui border-outline-variant flex w-full cursor-pointer items-center gap-1.5 border-b px-2 py-1.5 text-left text-[11px]',
                    active
                      ? 'bg-primary text-on-primary'
                      : 'text-on-surface hover:bg-surface-container-high'
                  )}
                >
                  <Icon size={12} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{track.name}</span>
                  {resume[resumeKey(root, track.path)] !== undefined && (
                    <Tooltip
                      content={`Resumes at ${formatTime(resume[resumeKey(root, track.path)])}`}
                    >
                      <History size={11} className="shrink-0 opacity-70" />
                    </Tooltip>
                  )}
                  {durations[track.path] > 0 && (
                    <span className="shrink-0 text-[10px] tabular-nums opacity-70">
                      {formatTime(durations[track.path])}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </ScrollArea>
    </div>
  )
}
