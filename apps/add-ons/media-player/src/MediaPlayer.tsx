import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PlayCircle } from 'lucide-react'
import { Button, useFileDialog, useOpenIntent } from '@imbatranim/core'
import { listFolderTracks, mediaKind, type Track } from './api/listDir'
import { TrackStage } from './components/TrackStage'
import { Playlist } from './components/Playlist'

/**
 * Native `<audio>`/`<video>` playback with a custom, token-styled transport
 * bar (native `controls` stay off) and a folder playlist/queue built from
 * `@imbatranim/core`'s file listing. `TrackStage` sets the element's own
 * `src` to the authed download URL — playback issues HTTP Range requests
 * itself, so large files stream rather than loading into memory (see brief
 * 38). This component just owns navigation (queue, prev/next/auto-advance)
 * and the volume/mute preference that should persist across tracks.
 */
export function MediaPlayer({ windowId }: { windowId: string }) {
  // One-shot open intent, drained by the shared hook (StrictMode-safe). Fixes
  // this window's root; the active track within that root can still change
  // as the user browses the queue.
  const source = useOpenIntent(windowId)

  // Lets the app open a file on its own instead of dead-ending on
  // "open one from Files". The pick latches into the same store
  // useOpenIntent reads, so the existing load path runs unchanged.
  const { openFile, fileDialog } = useFileDialog(windowId)
  const pickFile = () =>
    void openFile({
      extensions: [
        'mp3',
        'wav',
        'ogg',
        'flac',
        'm4a',
        'aac',
        'opus',
        'weba',
        'mp4',
        'webm',
        'mkv',
        'mov',
        'avi',
        'm4v',
      ],
    })
  // `null` until the user picks a track explicitly (queue click, prev/next,
  // or auto-advance) — before that, the active track falls back to the
  // opened file, and playback does NOT autostart just from opening a file.
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)

  const tracksQuery = useQuery({
    queryKey: ['media-player', 'tracks', source?.root, source?.path],
    queryFn: () => listFolderTracks(source!.root, source!.path),
    enabled: !!source,
  })
  const tracks = tracksQuery.data ?? []

  const activePath = selectedPath ?? source?.path ?? null
  const autoPlay = selectedPath !== null
  const index = activePath ? tracks.findIndex((t) => t.path === activePath) : -1
  const canPrev = index > 0
  const canNext = index !== -1 && index < tracks.length - 1

  // Mirrors the latest tracks/activePath for `goToOffset`, kept fresh from an
  // effect (never mutated during render) so prev/next/auto-advance always
  // read the current queue even though they're wrapped in a stable
  // (deps-empty) callback handed down to `TrackStage`.
  const queueRef = useRef<{ tracks: Track[]; activePath: string | null }>({
    tracks: [],
    activePath: null,
  })
  useEffect(() => {
    queueRef.current = { tracks, activePath }
  })

  const selectTrack = useCallback((path: string) => {
    setSelectedPath(path)
  }, [])

  const goToOffset = useCallback(
    (offset: number) => {
      const { tracks: currentTracks, activePath: currentPath } = queueRef.current
      const currentIndex = currentTracks.findIndex((t) => t.path === currentPath)
      const nextIndex = currentIndex + offset
      if (currentIndex === -1 || nextIndex < 0 || nextIndex >= currentTracks.length) return
      selectTrack(currentTracks[nextIndex].path)
    },
    [selectTrack]
  )

  const onPrev = useCallback(() => goToOffset(-1), [goToOffset])
  const onNext = useCallback(() => goToOffset(1), [goToOffset])
  const onEnded = useCallback(() => goToOffset(1), [goToOffset])

  const handleVolumeChange = useCallback((v: number, m: boolean) => {
    setVolume(v)
    setMuted(m)
  }, [])

  if (!source) {
    return (
      <div className="bg-surface-container-lowest text-on-surface-variant flex h-full flex-col items-center justify-center gap-2 text-center">
        <PlayCircle size={40} strokeWidth={1} />
        <span className="font-ui text-[12px]">Nothing open</span>
        <Button size="sm" variant="primary" onClick={pickFile}>
          Open media
        </Button>
        {fileDialog}
      </div>
    )
  }

  const kind = activePath ? mediaKind(activePath) : null
  const showQueue = tracks.length > 1

  return (
    <div className="bg-surface-container-lowest flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        {kind && activePath ? (
          <TrackStage
            key={activePath}
            root={source.root}
            path={activePath}
            kind={kind}
            initialVolume={volume}
            initialMuted={muted}
            autoPlay={autoPlay}
            canPrev={canPrev}
            canNext={canNext}
            onPrev={onPrev}
            onNext={onNext}
            onEnded={onEnded}
            onVolumeChange={handleVolumeChange}
          />
        ) : (
          <div className="text-on-surface-variant flex flex-1 items-center justify-center">
            <span className="font-ui text-[12px]">Unsupported file type</span>
          </div>
        )}

        {showQueue && <Playlist tracks={tracks} activePath={activePath} onSelect={selectTrack} />}
      </div>
    </div>
  )
}
