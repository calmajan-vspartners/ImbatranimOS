import { create } from 'zustand'
import {
  DEFAULT_TIMER_MS,
  complete,
  createTimer,
  pause,
  reset,
  setDuration,
  start,
  type TimerEntry,
} from './timerModel'

/**
 * Clock's **session** state: the stopwatch, the countdown timers, and which
 * alarms are ringing right now.
 *
 * There is no `persist` middleware here any more, and that is the point of brief
 * 71. World clocks and alarms are documents — they belong to the computer, so
 * they live in the container behind `/api/clock` (see `queries/clockQueries.ts`).
 * What is left is genuinely ephemeral: a running countdown must not resurrect
 * after a reload, nobody expects to find yesterday's stopwatch, and a ringing
 * alarm is a thing happening now.
 *
 * All timer transitions delegate to `timerModel`, which takes `now` explicitly —
 * that is what keeps the countdown timestamp-driven rather than tick-counted.
 */

type StopwatchState = {
  /** Timestamp the current running segment started, or null when paused/reset. */
  startedAt: number | null
  /** Elapsed ms accumulated from previous run segments. */
  accumulatedMs: number
  running: boolean
  /** Lap elapsed-ms readings, newest first. */
  laps: number[]
}

/** An alarm the user has to deal with: snooze it or dismiss it. */
export type RingingAlarm = {
  alarmId: number
  label: string
  time: string
  /** epoch ms it rang, so the banner can say "3 min ago" if it ever wants to. */
  at: number
}

const initialStopwatch: StopwatchState = {
  startedAt: null,
  accumulatedMs: 0,
  running: false,
  laps: [],
}

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `c-${Date.now()}-${Math.floor(Math.random() * 1e9)}`

/** Guard-rail: a list model invites "add" being held down. */
export const MAX_TIMERS = 8

type ClockStore = {
  // --- session-only: stopwatch ---------------------------------------------
  stopwatch: StopwatchState
  startStopwatch: () => void
  stopStopwatch: () => void
  lapStopwatch: () => void
  resetStopwatch: () => void

  // --- session-only: countdown timers ---------------------------------------
  timers: TimerEntry[]
  addTimer: (label: string, durationMs: number) => void
  removeTimer: (id: string) => void
  setTimerDuration: (id: string, ms: number) => void
  setTimerLabel: (id: string, label: string) => void
  startTimer: (id: string) => void
  pauseTimer: (id: string) => void
  resetTimer: (id: string) => void
  /** Called by the notification watcher once a countdown hits zero. */
  completeTimer: (id: string) => void

  // --- session-only: ringing alarms -----------------------------------------
  ringing: RingingAlarm[]
  ringAlarm: (entry: RingingAlarm) => void
  clearRinging: (alarmId: number) => void
}

/** The window opens with one five-minute timer, so the tab is usable at once. */
const initialTimers = (): TimerEntry[] => [createTimer(newId(), '', DEFAULT_TIMER_MS)]

/** Applies a `timerModel` transition to one timer by id. */
function mapTimer(
  timers: TimerEntry[],
  id: string,
  fn: (timer: TimerEntry) => TimerEntry
): TimerEntry[] {
  return timers.map((t) => (t.id === id ? fn(t) : t))
}

export const useClockStore = create<ClockStore>()((set) => ({
  stopwatch: initialStopwatch,
  startStopwatch: () =>
    set((s) =>
      s.stopwatch.running
        ? s
        : { stopwatch: { ...s.stopwatch, running: true, startedAt: Date.now() } }
    ),
  stopStopwatch: () =>
    set((s) => {
      if (!s.stopwatch.running || s.stopwatch.startedAt === null) return s
      return {
        stopwatch: {
          ...s.stopwatch,
          running: false,
          startedAt: null,
          accumulatedMs: s.stopwatch.accumulatedMs + (Date.now() - s.stopwatch.startedAt),
        },
      }
    }),
  lapStopwatch: () =>
    set((s) => {
      const { stopwatch } = s
      const elapsed =
        stopwatch.accumulatedMs +
        (stopwatch.running && stopwatch.startedAt !== null ? Date.now() - stopwatch.startedAt : 0)
      return { stopwatch: { ...stopwatch, laps: [elapsed, ...stopwatch.laps] } }
    }),
  resetStopwatch: () => set({ stopwatch: initialStopwatch }),

  timers: initialTimers(),
  addTimer: (label, durationMs) =>
    set((s) =>
      s.timers.length >= MAX_TIMERS
        ? s
        : { timers: [...s.timers, createTimer(newId(), label, durationMs)] }
    ),
  removeTimer: (id) => set((s) => ({ timers: s.timers.filter((t) => t.id !== id) })),
  setTimerDuration: (id, ms) =>
    set((s) => ({ timers: mapTimer(s.timers, id, (t) => setDuration(t, ms)) })),
  setTimerLabel: (id, label) =>
    set((s) => ({ timers: mapTimer(s.timers, id, (t) => ({ ...t, label })) })),
  startTimer: (id) => set((s) => ({ timers: mapTimer(s.timers, id, (t) => start(t, Date.now())) })),
  pauseTimer: (id) => set((s) => ({ timers: mapTimer(s.timers, id, (t) => pause(t, Date.now())) })),
  resetTimer: (id) => set((s) => ({ timers: mapTimer(s.timers, id, reset) })),
  completeTimer: (id) => set((s) => ({ timers: mapTimer(s.timers, id, complete) })),

  ringing: [],
  ringAlarm: (entry) =>
    set((s) =>
      s.ringing.some((r) => r.alarmId === entry.alarmId) ? s : { ringing: [...s.ringing, entry] }
    ),
  clearRinging: (alarmId) =>
    set((s) => ({ ringing: s.ringing.filter((r) => r.alarmId !== alarmId) })),
}))

// Re-exported for callers that just need a fresh read without subscribing (the
// notification watcher).
export function getClockState() {
  return useClockStore.getState()
}
