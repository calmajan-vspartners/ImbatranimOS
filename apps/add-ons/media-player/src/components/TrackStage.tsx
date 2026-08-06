import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Download, Music, RotateCcw } from 'lucide-react'
import { Button, api, downloadUrl, fileName, notify } from '@imbatranim/core'
import type { MediaKind } from '../api/listDir'
import { mediaErrorReport } from '../lib/mediaError'
import { TransportBar } from './TransportBar'
import { useDocumentedShortcuts, useTopWindowKeydown } from '@imbatranim/core'
import {
  ARROW_SKIP_SECONDS,
  COARSE_SKIP_SECONDS,
  VOLUME_STEP,
  bufferedRanges,
  clampSeek,
} from '../lib/transport'
import { parseSubtitles, stripSsaOverrides } from '../lib/subtitles'
import { shouldResume } from '../lib/resume'
import type { RepeatMode } from '../lib/queueOrder'
import { formatTime } from '../lib/formatTime'

type TrackStageProps = {
  /** The media-player window this stage lives in, so its keys stay scoped to it. */
  windowId: string
  root: string
  path: string
  kind: MediaKind
  initialVolume: number
  initialMuted: boolean
  initialRate: number
  autoPlay: boolean
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
  onEnded: () => void
  onVolumeChange: (volume: number, muted: boolean) => void
  onRateChange: (rate: number) => void
  repeat: RepeatMode
  onCycleRepeat: () => void
  shuffle: boolean
  onToggleShuffle: () => void
  /** Sidecar subtitle path for this track, or null when there is none. */
  subtitlePath: string | null
  /** Where to resume from, in seconds, or null to start at the beginning. */
  resumeAt: number | null
  /** Called (throttled) with the current position, so it can be remembered. */
  onProgress: (position: number, duration: number) => void
  /** The user asked to start this file over. */
  onStartOver: () => void
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
  windowId,
  root,
  path,
  kind,
  initialVolume,
  initialMuted,
  initialRate,
  autoPlay,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onEnded,
  onVolumeChange,
  onRateChange,
  repeat,
  onCycleRepeat,
  shuffle,
  onToggleShuffle,
  subtitlePath,
  resumeAt,
  onProgress,
  onStartOver,
}: TrackStageProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(initialVolume)
  const [muted, setMuted] = useState(initialMuted)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [errorHint, setErrorHint] = useState('')
  const [buffered, setBuffered] = useState<[number, number][]>([])
  const [playbackRate, setPlaybackRate] = useState(initialRate)
  const [subtitlesOn, setSubtitlesOn] = useState<boolean | null>(null)
  const [resumedFrom, setResumedFrom] = useState<number | null>(null)
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const textTrackRef = useRef<TextTrack | null>(null)
  // Latest values for the mount-once effect below, which must not re-run per track tick.
  const liveRef = useRef({ resumeAt, onProgress, repeat })
  useEffect(() => {
    liveRef.current = { resumeAt, onProgress, repeat }
  })

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
      // Resume only once the duration is known, and only when the stored position is
      // actually resumable for THIS duration. `clampSeek` alone would pin a stale
      // position past the end (the file was replaced on disk) to `duration`, so the
      // track would instantly fire `ended` and auto-advance (T1-13). `shouldResume`
      // is the decision that guards against that — a candidate is passed in and
      // checked here, where the duration is finally known.
      const target = liveRef.current.resumeAt
      if (target !== null && shouldResume(target, el!.duration)) {
        const seekTo = clampSeek(target, el!.duration)
        if (seekTo !== null) {
          el!.currentTime = seekTo
          setResumedFrom(seekTo)
        }
      }
    }
    let lastReported = 0
    function handleTimeUpdate() {
      setCurrentTime(el!.currentTime)
      // `timeupdate` fires ~4×/second; a write per event would mean a JSON.stringify and a
      // localStorage round-trip 240 times a minute for a value nobody reads until the file
      // is reopened.
      if (Math.abs(el!.currentTime - lastReported) < 5) return
      lastReported = el!.currentTime
      liveRef.current.onProgress(el!.currentTime, el!.duration)
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
      // Reaching the end clears any remembered position — reopening a finished file should
      // start it again, not offer to resume the credits.
      liveRef.current.onProgress(0, el!.duration)
      // Repeat-one is replayed HERE, on the element, rather than by the parent re-selecting
      // the same path: that would change no state, so nothing would remount and the track
      // would simply stop. Replaying in place also avoids re-fetching what is already
      // buffered.
      if (liveRef.current.repeat === 'one') {
        el!.currentTime = 0
        void el!.play().catch(() => undefined)
        return
      }
      onEnded()
    }
    function handleError() {
      setIsPlaying(false)
      const report = mediaErrorReport(el!.error, path, fileName(path, 'this file'))
      setErrorMsg(report.message)
      setErrorHint(report.hint)
      // The window may be behind others by the time a queued track fails, so the overlay
      // alone can go unseen — which is the "dead player, no message" state this replaces.
      notify({
        title: 'Cannot play this file',
        body: report.hint ? `${report.message} ${report.hint}` : report.message,
        level: 'error',
        appId: 'media-player',
      })
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
    el.playbackRate = initialRate
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

  /**
   * Load a sidecar subtitle into a `TextTrack` built by hand.
   *
   * Not `<track src=…>`, for two measured reasons: `/files/download` serves
   * `application/octet-stream` and a text track is only parsed as `text/vtt`, and the
   * `blob:` URL that would normally paper over that is refused by the shipped CSP (no
   * `media-src`, so it falls back to `default-src 'self'`). Fetching the text through the
   * authed api and adding cues directly needs no new route and no policy change — and it
   * is also what makes `.srt` work, since the cues are parsed here either way.
   */
  useEffect(() => {
    const el = mediaRef.current
    if (!el || !subtitlePath) return
    let cancelled = false
    void (async () => {
      try {
        const res = await api.get<{ content: string }>('/files/content', {
          params: { root, path: subtitlePath },
        })
        if (cancelled) return
        const cues = parseSubtitles(res.data.content)
        if (cues.length === 0) return
        const track = el.addTextTrack('subtitles', fileName(subtitlePath, 'Subtitles'), 'und')
        for (const cue of cues) {
          try {
            track.addCue(new VTTCue(cue.start, cue.end, stripSsaOverrides(cue.text)))
          } catch {
            // One cue the platform rejects must not lose the other nine hundred.
          }
        }
        track.mode = 'showing'
        textTrackRef.current = track
        setSubtitlesOn(true)
      } catch (err) {
        console.error('[media-player] failed to load subtitles', err)
      }
    })()
    return () => {
      cancelled = true
    }
    // Mount-once per track: the stage is remounted with `key={path}` on every track change,
    // so the element (and any track added to it) is always fresh.
  }, [subtitlePath, root])

  const toggleSubtitles = useCallback(() => {
    const track = textTrackRef.current
    if (!track) return
    const next = track.mode !== 'showing'
    track.mode = next ? 'showing' : 'hidden'
    setSubtitlesOn(next)
  }, [])

  /**
   * Fullscreen the whole stage, not the `<video>`.
   *
   * Fullscreening the element hands control to the browser's own overlay; fullscreening the
   * wrapper keeps this app's transport bar, keyboard map and subtitles — the OS's player
   * filling the screen rather than the browser's.
   */
  const toggleFullscreen = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void stage.requestFullscreen().catch(() => undefined)
  }, [])

  const startOver = useCallback(() => {
    const el = mediaRef.current
    if (el) el.currentTime = 0
    setResumedFrom(null)
    onStartOver()
  }, [onStartOver])

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

  // VLC's keyboard set. Published to the `?` overlay for discoverability, but
  // BOUND through `useTopWindowKeydown` — not a bare `window` listener — so the
  // keys fire only for the top-most media-player window and never while the user
  // is typing in another app. The transport used to bind these window-globally
  // (via `useRegisteredHotkeys` → `useGlobalHotkeys`), so `space`/`m`/`f`/arrows
  // fired for every media-player window at once, regardless of which was on top
  // (T2-1).
  useDocumentedShortcuts([
    { id: 'media.playpause', keys: 'space', description: 'Play / pause', scope: 'Editing' },
    { id: 'media.back', keys: 'left', description: `Back ${ARROW_SKIP_SECONDS}s`, scope: 'Editing' },
    {
      id: 'media.forward',
      keys: 'right',
      description: `Forward ${ARROW_SKIP_SECONDS}s`,
      scope: 'Editing',
    },
    {
      id: 'media.back.coarse',
      keys: 'shift+left',
      description: `Back ${COARSE_SKIP_SECONDS}s`,
      scope: 'Editing',
    },
    {
      id: 'media.forward.coarse',
      keys: 'shift+right',
      description: `Forward ${COARSE_SKIP_SECONDS}s`,
      scope: 'Editing',
    },
    { id: 'media.mute', keys: 'm', description: 'Mute / unmute', scope: 'Editing' },
    { id: 'media.volume.up', keys: 'up', description: 'Volume up', scope: 'Editing' },
    { id: 'media.volume.down', keys: 'down', description: 'Volume down', scope: 'Editing' },
    { id: 'media.fullscreen', keys: 'f', description: 'Fullscreen (video)', scope: 'Editing' },
  ])

  useTopWindowKeydown(windowId, (e) => {
    // Real shortcuts (Ctrl/⌘/Alt combos) belong to the shell and other apps.
    if (e.ctrlKey || e.metaKey || e.altKey) return
    // Left/Right take a coarse variant on Shift; everything else is Shift-free.
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      skip(e.shiftKey ? -COARSE_SKIP_SECONDS : -ARROW_SKIP_SECONDS)
      return
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      skip(e.shiftKey ? COARSE_SKIP_SECONDS : ARROW_SKIP_SECONDS)
      return
    }
    if (e.shiftKey) return
    const k = e.key.toLowerCase()
    if (e.key === ' ') {
      e.preventDefault()
      togglePlay()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      nudgeVolume(VOLUME_STEP)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      nudgeVolume(-VOLUME_STEP)
    } else if (k === 'm') {
      e.preventDefault()
      toggleMute()
    } else if (k === 'f') {
      e.preventDefault()
      toggleFullscreen()
    }
  })

  function changeRate(rate: number) {
    const el = mediaRef.current
    if (!el) return
    el.playbackRate = rate
    setPlaybackRate(rate)
    // Reported up so it is remembered: the rate used to reset on every track change,
    // because this component remounts per track.
    onRateChange(rate)
  }

  /** Relative volume change for the arrow keys, clamped. */
  function nudgeVolume(delta: number) {
    const el = mediaRef.current
    if (!el) return
    el.volume = Math.min(1, Math.max(0, el.volume + delta))
    if (el.volume > 0) el.muted = false
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
      <div
        ref={stageRef}
        className="bg-surface-dim relative flex min-h-0 flex-1 flex-col items-center justify-center"
      >
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

        {resumedFrom !== null && (
          <div className="border-outline-variant bg-surface-container-low absolute top-2 left-1/2 flex -translate-x-1/2 items-center gap-2 border px-2 py-1">
            <span className="font-ui text-on-surface-variant text-[11px]">
              Resumed at {formatTime(resumedFrom)}
            </span>
            <button
              type="button"
              onClick={startOver}
              className="font-ui text-primary flex items-center gap-1 text-[11px] underline"
            >
              <RotateCcw size={11} />
              Start over
            </button>
          </div>
        )}

        {errorMsg && (
          <div className="bg-surface-dim/95 absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <AlertTriangle size={32} className="text-error" strokeWidth={1.5} />
            <span className="font-ui text-error text-[12px]">{errorMsg}</span>
            {errorHint && (
              <span className="font-ui text-on-surface-variant max-w-[380px] text-[11px]">
                {errorHint}
              </span>
            )}
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
        repeat={repeat}
        onCycleRepeat={onCycleRepeat}
        shuffle={shuffle}
        onToggleShuffle={onToggleShuffle}
        onFullscreen={kind === 'video' ? toggleFullscreen : null}
        subtitlesOn={subtitlesOn}
        onToggleSubtitles={toggleSubtitles}
      />
    </div>
  )
}
