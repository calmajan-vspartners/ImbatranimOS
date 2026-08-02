import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Download, Music } from 'lucide-react'
import { Button, downloadUrl, fileName } from '@imbatranim/core'
import type { MediaKind } from '../api/listDir'
import { describeMediaError } from '../lib/mediaError'
import { TransportBar } from './TransportBar'
import { useRegisteredHotkeys } from '@imbatranim/core'
import {
  ARROW_SKIP_SECONDS,
  COARSE_SKIP_SECONDS,
  bufferedRanges,
  clampSeek,
} from '../lib/transport'

type TrackStageProps = {
  root: string
  path: string
  kind: MediaKind
  initialVolume: number
  initialMuted: boolean
  autoPlay: boolean
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
  onEnded: () => void
  onVolumeChange: (volume: number, muted: boolean) => void
}

/**
 * Owns the native `<video>`/`<audio>` element + transport bar for exactly
 * ONE track. The parent mounts this with `key={path}`, so every track switch
 * is a full remount: per-track state (currentTime/duration/isPlaying/error)
 * starts fresh from its `useState` initializer — no reset effect needed —
 * and the outgoing element (with every listener it held) is torn down by
 * React, so nothing keeps decoding after the user has moved on.
 */
export function TrackStage({
  root,
  path,
  kind,
  initialVolume,
  initialMuted,
  autoPlay,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onEnded,
  onVolumeChange,
}: TrackStageProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(initialVolume)
  const [muted, setMuted] = useState(initialMuted)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [buffered, setBuffered] = useState<[number, number][]>([])
  const [playbackRate, setPlaybackRate] = useState(1)
  const mediaRef = useRef<HTMLMediaElement | null>(null)

  // Wire this track's element exactly once: attach listeners that call
  // setState from their own (later-firing) callback, apply the persisted
  // volume/mute + autoplay intent, and tear everything down on unmount/track
  // change. `onEnded`/`onVolumeChange` are stable callbacks from the parent
  // (useCallback with empty deps), and `initialVolume`/`initialMuted`/
  // `autoPlay` are one-shot-by-contract for this mount, so this effect is
  // intentionally mount-once rather than re-synced on every prop tick.
  useEffect(() => {
    const el = mediaRef.current
    if (!el) return

    function handleLoadedMetadata() {
      setDuration(el!.duration || 0)
    }
    function handleTimeUpdate() {
      setCurrentTime(el!.currentTime)
    }
    function handlePlay() {
      setIsPlaying(true)
    }
    function handlePause() {
      setIsPlaying(false)
    }
    function handleVolumeChange() {
      setVolume(el!.volume)
      setMuted(el!.muted)
      onVolumeChange(el!.volume, el!.muted)
    }
    function handleEnded() {
      setIsPlaying(false)
      onEnded()
    }
    function handleError() {
      setIsPlaying(false)
      setErrorMsg(describeMediaError(el!.error))
    }

    const handleProgress = () => setBuffered(bufferedRanges(el!))
    el.addEventListener('loadedmetadata', handleLoadedMetadata)
    el.addEventListener('timeupdate', handleTimeUpdate)
    el.addEventListener('progress', handleProgress)
    el.addEventListener('play', handlePlay)
    el.addEventListener('pause', handlePause)
    el.addEventListener('volumechange', handleVolumeChange)
    el.addEventListener('ended', handleEnded)
    el.addEventListener('error', handleError)

    el.volume = initialVolume
    el.muted = initialMuted
    if (autoPlay) {
      el.play().catch(() => {
        setErrorMsg('Playback was blocked by the browser. Press play to start.')
      })
    }

    return () => {
      el.removeEventListener('loadedmetadata', handleLoadedMetadata)
      el.removeEventListener('timeupdate', handleTimeUpdate)
      el.removeEventListener('progress', handleProgress)
      el.removeEventListener('play', handlePlay)
      el.removeEventListener('pause', handlePause)
      el.removeEventListener('volumechange', handleVolumeChange)
      el.removeEventListener('ended', handleEnded)
      el.removeEventListener('error', handleError)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once for this track; see the comment above the effect.
  }, [])

  function setMediaRef(el: HTMLVideoElement | HTMLAudioElement | null) {
    mediaRef.current = el
  }

  function togglePlay() {
    const el = mediaRef.current
    if (!el) return
    if (el.paused || el.ended) {
      el.play().catch(() => {
        setErrorMsg('Playback was blocked by the browser. Press play to start.')
      })
    } else {
      el.pause()
    }
  }

  function seek(time: number) {
    const el = mediaRef.current
    if (!el) return
    const next = clampSeek(time, el.duration)
    if (next !== null) el.currentTime = next
  }

  /** Relative skip, clamped — used by the buttons and the arrow keys. */
  function skip(seconds: number) {
    const el = mediaRef.current
    if (!el) return
    const next = clampSeek(el.currentTime + seconds, el.duration)
    if (next !== null) el.currentTime = next
  }

  // VLC's keyboard set, scoped to the top-most window so two players cannot
  // fight over a keystroke, and registered so it appears in the `?` overlay
  // instead of being invisible.
  useRegisteredHotkeys([
    {
      id: 'media.playpause',
      keys: 'space',
      description: 'Play / pause',
      scope: 'Editing',
      handler: togglePlay,
    },
    {
      id: 'media.back',
      keys: 'left',
      description: `Back ${ARROW_SKIP_SECONDS}s`,
      scope: 'Editing',
      handler: () => skip(-ARROW_SKIP_SECONDS),
    },
    {
      id: 'media.forward',
      keys: 'right',
      description: `Forward ${ARROW_SKIP_SECONDS}s`,
      scope: 'Editing',
      handler: () => skip(ARROW_SKIP_SECONDS),
    },
    {
      id: 'media.back.coarse',
      keys: 'shift+left',
      description: `Back ${COARSE_SKIP_SECONDS}s`,
      scope: 'Editing',
      handler: () => skip(-COARSE_SKIP_SECONDS),
    },
    {
      id: 'media.forward.coarse',
      keys: 'shift+right',
      description: `Forward ${COARSE_SKIP_SECONDS}s`,
      scope: 'Editing',
      handler: () => skip(COARSE_SKIP_SECONDS),
    },
    {
      id: 'media.mute',
      keys: 'm',
      description: 'Mute / unmute',
      scope: 'Editing',
      handler: toggleMute,
    },
  ])

  function changeRate(rate: number) {
    const el = mediaRef.current
    if (!el) return
    el.playbackRate = rate
    setPlaybackRate(rate)
  }

  function changeVolume(next: number) {
    const el = mediaRef.current
    if (!el) return
    el.volume = next
    if (next > 0) el.muted = false
  }

  function toggleMute() {
    const el = mediaRef.current
    if (el) el.muted = !el.muted
  }

  function triggerDownload() {
    const url = downloadUrl(root, path)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName(path, 'media')
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const src = downloadUrl(root, path)

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="bg-surface-dim relative flex min-h-0 flex-1 items-center justify-center">
        {kind === 'video' ? (
          <video
            ref={setMediaRef}
            src={src}
            preload="metadata"
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <>
            <audio ref={setMediaRef} src={src} preload="metadata" hidden />
            <div className="text-on-surface-variant flex flex-col items-center gap-2 px-6 text-center">
              <Music size={48} strokeWidth={1} />
              <span className="font-ui text-on-surface max-w-[280px] truncate text-[12px]">
                {fileName(path, 'audio')}
              </span>
            </div>
          </>
        )}

        {errorMsg && (
          <div className="bg-surface-dim/95 absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <AlertTriangle size={32} className="text-error" strokeWidth={1.5} />
            <span className="font-ui text-error text-[12px]">{errorMsg}</span>
            <Button
              variant="default"
              size="sm"
              className="flex items-center gap-1"
              onClick={triggerDownload}
            >
              <Download size={12} />
              Download instead
            </Button>
          </div>
        )}
      </div>

      <TransportBar
        buffered={buffered}
        playbackRate={playbackRate}
        onRateChange={changeRate}
        onSkip={skip}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        volume={volume}
        muted={muted}
        canPrev={canPrev}
        canNext={canNext}
        disabled={false}
        onTogglePlay={togglePlay}
        onSeek={seek}
        onVolumeChange={changeVolume}
        onToggleMute={toggleMute}
        onPrev={onPrev}
        onNext={onNext}
      />
    </div>
  )
}
