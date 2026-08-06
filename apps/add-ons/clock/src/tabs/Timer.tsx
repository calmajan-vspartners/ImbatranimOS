import { useState } from 'react'
import { Play, Pause, Plus, RotateCcw, X } from 'lucide-react'
import { Button, Input, cn } from '@imbatranim/ui'
import { MAX_TIMERS, useClockStore } from '../clockStore'
import { useNow } from '../useNow'
import { formatClockDuration } from '../format'
import { DEFAULT_TIMER_MS, parseDurationInput, remainingMs, type TimerEntry } from '../timerModel'

const PRESETS_MIN = [1, 5, 10, 20, 30, 60]

/**
 * One countdown.
 *
 * `now` is passed down rather than ticked per card, so a tab with four timers
 * still has one interval — and, more importantly, every card reads the same
 * instant. The displayed value is always `remainingMs(timer, now)`; nothing here
 * counts ticks (see timerModel).
 */
function TimerCard({ timer, now }: { timer: TimerEntry; now: number }) {
  const setDuration = useClockStore((s) => s.setTimerDuration)
  const setLabel = useClockStore((s) => s.setTimerLabel)
  const start = useClockStore((s) => s.startTimer)
  const pause = useClockStore((s) => s.pauseTimer)
  const reset = useClockStore((s) => s.resetTimer)
  const remove = useClockStore((s) => s.removeTimer)
  const count = useClockStore((s) => s.timers.length)
  const [customMinutes, setCustomMinutes] = useState('')

  const remaining = remainingMs(timer, now)
  const finished = remaining === 0 && timer.fired

  const parsedCustom = parseDurationInput(customMinutes)

  const applyCustom = () => {
    if (parsedCustom === null) return
    setDuration(timer.id, parsedCustom)
    setCustomMinutes('')
  }

  return (
    <div
      className={cn(
        'border-outline-variant flex flex-col gap-2 border-b p-3',
        finished && 'bg-surface-container-low'
      )}
    >
      <div className="flex items-center gap-2">
        <Input
          placeholder="Name (optional)"
          value={timer.label}
          onChange={(e) => setLabel(timer.id, e.target.value)}
          aria-label="Timer name"
          className="min-w-0 flex-1"
        />
        {count > 1 && (
          <button
            type="button"
            onClick={() => remove(timer.id)}
            title="Remove timer"
            aria-label={timer.label ? `Remove the ${timer.label} timer` : 'Remove this timer'}
            className="text-on-surface-variant hover:text-error shrink-0 p-1"
          >
            <X size={12} strokeWidth={2} />
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'font-mono text-[32px] leading-none font-semibold tabular-nums',
            finished ? 'text-error' : 'text-on-surface'
          )}
        >
          {formatClockDuration(remaining)}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {timer.running ? (
            <Button variant="default" size="sm" onClick={() => pause(timer.id)}>
              <Pause size={12} strokeWidth={2} />
              Pause
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => start(timer.id)}
              disabled={remaining === 0 && timer.durationMs === 0}
            >
              <Play size={12} strokeWidth={2} />
              Start
            </Button>
          )}
          <Button variant="default" size="sm" onClick={() => reset(timer.id)}>
            <RotateCcw size={12} strokeWidth={2} />
            Reset
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS_MIN.map((min) => (
          <Button
            key={min}
            variant="default"
            size="sm"
            disabled={timer.running}
            onClick={() => setDuration(timer.id, min * 60_000)}
          >
            {min}m
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {/* Text, not number: `0:30` has to be typeable, and a number input would
            reject the colon outright. */}
        <Input
          type="text"
          inputMode="numeric"
          placeholder="Minutes or mm:ss"
          value={customMinutes}
          disabled={timer.running}
          aria-label="Custom duration in minutes, or mm:ss"
          onChange={(e) => setCustomMinutes(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyCustom()
          }}
          className="min-w-0 flex-1"
        />
        <Button
          variant="default"
          size="sm"
          onClick={applyCustom}
          disabled={timer.running || parsedCustom === null}
          title={
            parsedCustom === null && customMinutes !== ''
              ? 'Type minutes (5), or mm:ss (0:30)'
              : undefined
          }
        >
          Set
        </Button>
      </div>
    </div>
  )
}

export function Timer() {
  const timers = useClockStore((s) => s.timers)
  const addTimer = useClockStore((s) => s.addTimer)

  // One interval for the whole tab, and only while something is running. The
  // value is a render trigger; every card recomputes from its own endAt.
  const anyRunning = timers.some((t) => t.running)
  const now = useNow(250, anyRunning)

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1">
        {timers.length === 0 ? (
          <p className="font-ui text-on-surface-variant flex h-full items-center justify-center text-[12px]">
            No timers — add one below
          </p>
        ) : (
          timers.map((timer) => <TimerCard key={timer.id} timer={timer} now={now} />)
        )}
      </div>

      <div className="border-outline-variant bg-surface-container-low flex items-center justify-between gap-2 border-t px-3 py-2">
        <p className="font-ui text-on-surface-variant text-[10px]">
          Timers keep running while the desktop is open, even with this window closed.
        </p>
        <Button
          variant="default"
          size="sm"
          onClick={() => addTimer('', DEFAULT_TIMER_MS)}
          disabled={timers.length >= MAX_TIMERS}
          title={
            timers.length >= MAX_TIMERS ? `Up to ${MAX_TIMERS} timers at once` : 'Add another timer'
          }
        >
          <Plus size={12} strokeWidth={2} />
          Add timer
        </Button>
      </div>
    </div>
  )
}
