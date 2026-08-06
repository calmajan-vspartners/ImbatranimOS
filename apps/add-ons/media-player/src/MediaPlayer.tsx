import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PlayCircle } from 'lucide-react'
import { Button, useFileDialog, useOpenIntent, useSystem } from '@imbatranim/ui'
import { listFolder, MEDIA_EXTENSIONS, mediaKind } from './api/listDir'
import { TrackStage } from './components/TrackStage'
import { Playlist } from './components/Playlist'
import { advance, canAdvance, nextRepeatMode, shuffledOrder } from './lib/queueOrder'
import { findSubtitle } from './lib/subtitles'
import { resumeKey } from './lib/resume'
import { useMediaPrefs } from './store/mediaPrefsStore'
import { useTrackDurations } from './hooks/useTrackDurations'

/**
 * Native `<audio>`/`<video>` playback with a custom, token-styled transport
 * bar (native `controls` stay off) and a folder playlist/queue built from
 * the OS file listing. `TrackStage` sets the element's own
 * `src` to the authed download URL — playback issues HTTP Range requests
 * itself, so large files stream rather than loading into memory (see brief
 * 38). This component owns navigation (queue order, shuffle/repeat,
 * prev/next/auto-advance) and the preferences that outlive a track.
 *
 * **Closing the window stops playback**, deliberately: the window *is* the player, and an
 * audio element outliving its window would contradict the compositor model the whole
 * desktop is built on. Playback continues while the window is merely unfocused or behind
 * others — only closing it ends the track. A background mini-player is a compositor
 * feature, not something this app should smuggle in (brief 68).
 */
export function MediaPlayer({ windowId: _windowId }: { windowId: string }) {
  const system = useSystem()

  // One-shot open intent, drained by the shared hook (StrictMode-safe). Fixes
  // this window's root; the active track within that root can still change
  // as the user browses the queue.
  const source = useOpenIntent()

  // Lets the app open a file on its own instead of dead-ending on
  // "open one from Files". The pick latches into the same store
  // useOpenIntent reads, so the existing load path runs unchanged.
  const { openFile } = useFileDialog()
  const pickFile = () => void openFile({ extensions: MEDIA_EXTENSIONS })

  // `null` until the user picks a track explicitly (queue click, prev/next,
  // or auto-advance) — before that, the active track falls back to the
  // opened file, and playback does NOT autostart just from opening a file.
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const { prefs, update, rememberProgress, clearProgress } = useMediaPrefs()

  const folderQuery = useQuery({
    queryKey: ['media-player', 'folder', source?.root, source?.path],
    queryFn: () => listFolder(system.http, source!.root, source!.path),
    enabled: !!source,
  })
  // Memoised so the `??` fallbacks do not mint a new array on every render and restart the
  // derived order and the duration probe with it.
  const tracks = useMemo(() => folderQuery.data?.tracks ?? [], [folderQuery.data])
  const siblings = useMemo(() => folderQuery.data?.siblings ?? [], [folderQuery.data])

  const activePath = selectedPath ?? source?.path ?? null
  const autoPlay = selectedPath !== null

  /**
   * The order prev/next/auto-advance walk.
   *
   * Derived from the folder listing rather than replacing it, so the Playlist keeps drawing
   * the real folder order and turning shuffle off restores navigation exactly.
   *
   * Deliberately independent of the playing track: an order that depends on it is
   * re-derived on every track change, which makes Next re-permute the queue and revisit
   * tracks. The seed is per window and not persisted — opening a folder again should
   * shuffle it differently, which is what shuffle means.
   */
  const [shuffleSeed, setShuffleSeed] = useState(() => Math.floor(Math.random() * 2 ** 31))
  const paths = useMemo(() => tracks.map((t) => t.path), [tracks])
  const order = useMemo(
    () => (prefs.shuffle ? shuffledOrder(paths, shuffleSeed) : paths),
    [paths, prefs.shuffle, shuffleSeed]
  )

  const canPrev = canAdvance(order, activePath, -1, prefs.repeat)
  const canNext = canAdvance(order, activePath, 1, prefs.repeat)

  // Mirrors the latest queue for the stable callbacks handed down to `TrackStage`, kept
  // fresh from an effect (never mutated during render) so prev/next/auto-advance always
  // read the current order.
  const queueRef = useRef<{
    order: string[]
    activePath: string | null
    repeat: typeof prefs.repeat
  }>({ order: [], activePath: null, repeat: 'off' })
  useEffect(() => {
    queueRef.current = { order, activePath, repeat: prefs.repeat }
  })

  const selectTrack = useCallback((path: string) => {
    setSelectedPath(path)
  }, [])

  const step = useCallback(
    (direction: 1 | -1, reason: 'ended' | 'manual') => {
      const queue = queueRef.current
      const next = advance(queue.order, queue.activePath, direction, queue.repeat, reason)
      if (next === null) return
      // Repeat-one on `ended` resolves to the track already playing. `TrackStage` replays it
      // on the element itself — selecting the same path again would change no state, so
      // nothing would remount and nothing would restart. Measured: the track just stopped.
      if (next === queue.activePath) return
      selectTrack(next)
    },
    [selectTrack]
  )

  const onPrev = useCallback(() => step(-1, 'manual'), [step])
  const onNext = useCallback(() => step(1, 'manual'), [step])
  const onEnded = useCallback(() => step(1, 'ended'), [step])

  const handleVolumeChange = useCallback(
    (volume: number, muted: boolean) => update({ volume, muted }),
    [update]
  )
  const handleRateChange = useCallback((rate: number) => update({ rate }), [update])

  const toggleShuffle = useCallback(() => {
    // A fresh seed each time shuffle is switched on, so it is not the same "random" order
    // every time within one window.
    setShuffleSeed(Math.floor(Math.random() * 2 ** 31))
    update({ shuffle: !prefs.shuffle })
  }, [prefs.shuffle, update])

  const cycleRepeat = useCallback(
    () => update({ repeat: nextRepeatMode(prefs.repeat) }),
    [prefs.repeat, update]
  )

  const handleProgress = useCallback(
    (position: number, duration: number) => {
      if (!source || !activePath) return
      rememberProgress(source.root, activePath, position, duration)
    },
    [activePath, rememberProgress, source]
  )

  const handleStartOver = useCallback(() => {
    if (!source || !activePath) return
    clearProgress(source.root, activePath)
  }, [activePath, clearProgress, source])

  // Durations for the queue column. Only probed while the queue is on screen, so a single
  // file opened on its own costs nothing.
  const showQueue = tracks.length > 1
  const durations = useTrackDurations(source?.root ?? '', tracks, showQueue)

  if (!source) {
    return (
      <div className="bg-surface-container-lowest text-on-surface-variant flex h-full flex-col items-center justify-center gap-2 text-center">
        <PlayCircle size={40} strokeWidth={1} />
        <span className="font-ui text-[12px]">Nothing open</span>
        <Button size="sm" variant="primary" onClick={pickFile}>
          Open media
        </Button>
      </div>
    )
  }

  const kind = activePath ? mediaKind(activePath) : null
  const subtitlePath = activePath && kind === 'video' ? findSubtitle(siblings, activePath) : null
  const storedPosition = activePath ? prefs.resume[resumeKey(source.root, activePath)] : undefined
  // The duration is only known once metadata loads, so the *decision* is deferred to the
  // stage; what is passed here is the candidate.
  const resumeAt = storedPosition ?? null

  return (
    <div className="bg-surface-container-lowest flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        {kind && activePath ? (
          <TrackStage
            key={activePath}
            root={source.root}
            path={activePath}
            kind={kind}
            initialVolume={prefs.volume}
            initialMuted={prefs.muted}
            initialRate={prefs.rate}
            autoPlay={autoPlay}
            canPrev={canPrev}
            canNext={canNext}
            onPrev={onPrev}
            onNext={onNext}
            onEnded={onEnded}
            onVolumeChange={handleVolumeChange}
            onRateChange={handleRateChange}
            repeat={prefs.repeat}
            onCycleRepeat={cycleRepeat}
            shuffle={prefs.shuffle}
            onToggleShuffle={toggleShuffle}
            subtitlePath={subtitlePath}
            resumeAt={resumeAt}
            onProgress={handleProgress}
            onStartOver={handleStartOver}
          />
        ) : (
          <div className="text-on-surface-variant flex flex-1 items-center justify-center">
            <span className="font-ui text-[12px]">Unsupported file type</span>
          </div>
        )}

        {showQueue && (
          <Playlist
            tracks={tracks}
            activePath={activePath}
            durations={durations}
            resume={prefs.resume}
            root={source.root}
            onSelect={selectTrack}
          />
        )}
      </div>
    </div>
  )
}
