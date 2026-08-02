import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  RotateCw,
  Volume2,
  Volume1,
  VolumeX,
} from 'lucide-react'
import { Button, Tooltip, cn } from '@imbatranim/core'
import { formatTime } from '../lib/formatTime'
import { Timebar } from './Timebar'
import { SKIP_SECONDS, PLAYBACK_RATES } from '../lib/transport'

type TransportBarProps = {
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  canPrev: boolean
  canNext: boolean
  disabled: boolean
  onTogglePlay: () => void
  onSeek: (time: number) => void
  onVolumeChange: (volume: number) => void
  onToggleMute: () => void
  onPrev: () => void
  onNext: () => void
  /** Buffered ranges as [start, end] pairs. */
  buffered: [number, number][]
  playbackRate: number
  onRateChange: (rate: number) => void
  /** Relative skip in seconds; negative goes back. */
  onSkip: (seconds: number) => void
}

// Native range inputs, stripped of the browser's default (rounded) chrome and
// re-skinned flat/square to match the OS's Win7-classic, no-rounded-corners
// look — using the token accent color rather than a hardcoded one.
const RANGE_CLASSES =
  'h-1 cursor-pointer appearance-none bg-surface-container-high accent-primary ' +
  '[&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:bg-primary ' +
  '[&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

function VolumeIcon({ volume, muted }: { volume: number; muted: boolean }) {
  if (muted || volume === 0) return <VolumeX size={14} />
  if (volume < 0.5) return <Volume1 size={14} />
  return <Volume2 size={14} />
}

/** Custom transport bar over a native media element with `controls` off. */
export function TransportBar({
  isPlaying,
  currentTime,
  duration,
  volume,
  muted,
  canPrev,
  canNext,
  disabled,
  onTogglePlay,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onPrev,
  onNext,
  buffered,
  playbackRate,
  onRateChange,
  onSkip,
}: TransportBarProps) {
  return (
    <div className="border-outline-variant bg-surface-container-low flex shrink-0 flex-col gap-1.5 border-t px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className="font-ui text-on-surface-variant w-9 shrink-0 text-right text-[10px] tabular-nums">
          {formatTime(currentTime)}
        </span>
        <Timebar
          currentTime={currentTime}
          duration={duration}
          buffered={buffered}
          disabled={disabled}
          onSeek={onSeek}
        />
        <span className="font-ui text-on-surface-variant w-9 shrink-0 text-[10px] tabular-nums">
          {formatTime(duration)}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <Tooltip content="Previous track">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 shrink-0 p-0"
            onClick={onPrev}
            disabled={disabled || !canPrev}
          >
            <SkipBack size={13} />
          </Button>
        </Tooltip>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 shrink-0 p-0"
          onClick={() => onSkip(-SKIP_SECONDS)}
          disabled={disabled}
          title={`Back ${SKIP_SECONDS}s`}
          aria-label={`Back ${SKIP_SECONDS} seconds`}
        >
          <RotateCcw size={13} />
        </Button>
        <Tooltip content={isPlaying ? 'Pause' : 'Play'}>
          <Button
            variant="primary"
            size="sm"
            className="h-7 w-7 shrink-0 p-0"
            onClick={onTogglePlay}
            disabled={disabled}
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
          </Button>
        </Tooltip>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 shrink-0 p-0"
          onClick={() => onSkip(SKIP_SECONDS)}
          disabled={disabled}
          title={`Forward ${SKIP_SECONDS}s`}
          aria-label={`Forward ${SKIP_SECONDS} seconds`}
        >
          <RotateCw size={13} />
        </Button>
        <Tooltip content="Next track">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 shrink-0 p-0"
            onClick={onNext}
            disabled={disabled || !canNext}
          >
            <SkipForward size={13} />
          </Button>
        </Tooltip>

        <div className="flex-1" />

        <select
          aria-label="Playback speed"
          title="Playback speed"
          className="border-outline-variant bg-surface-container-lowest font-ui text-on-surface-variant h-6 shrink-0 border px-1 text-[11px] tabular-nums outline-none"
          value={playbackRate}
          disabled={disabled}
          onChange={(e) => onRateChange(Number(e.target.value))}
        >
          {PLAYBACK_RATES.map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>

        <Tooltip content={muted ? 'Unmute' : 'Mute'}>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 shrink-0 p-0"
            onClick={onToggleMute}
            disabled={disabled}
          >
            <VolumeIcon volume={volume} muted={muted} />
          </Button>
        </Tooltip>
        <input
          type="range"
          aria-label="Volume"
          className={cn(RANGE_CLASSES, 'w-16 flex-none')}
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          disabled={disabled}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
        />
      </div>
    </div>
  )
}
