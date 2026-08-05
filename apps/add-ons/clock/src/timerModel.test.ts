import { describe, expect, it } from 'vitest'
import { formatClockDuration } from './format'
import {
  DEFAULT_TIMER_MS,
  completionBody,
  complete,
  createTimer,
  isDue,
  parseDurationInput,
  pause,
  remainingMs,
  reset,
  setDuration,
  start,
} from './timerModel'

const T0 = 1_800_000_000_000

describe('a fresh timer', () => {
  it('is paused at its full duration', () => {
    const t = createTimer('a', 'Tea', 300_000)
    expect(t.running).toBe(false)
    expect(t.endAt).toBeNull()
    expect(remainingMs(t, T0)).toBe(300_000)
    expect(formatClockDuration(remainingMs(t, T0))).toBe('05:00')
  })

  it('defaults to five minutes', () => {
    expect(DEFAULT_TIMER_MS).toBe(300_000)
  })
})

describe('remaining time comes from timestamps, never from tick counting', () => {
  it('is derived from endAt, so a skipped interval cannot skew it', () => {
    const running = start(createTimer('a', '', 300_000), T0)
    expect(running.endAt).toBe(T0 + 300_000)
    expect(remainingMs(running, T0)).toBe(300_000)
    // The tab was throttled and no interval fired for two minutes: the value is
    // still exact, because nothing counted the ticks.
    expect(remainingMs(running, T0 + 120_000)).toBe(180_000)
    expect(remainingMs(running, T0 + 299_000)).toBe(1_000)
  })

  it('clamps at zero rather than going negative', () => {
    const running = start(createTimer('a', '', 5_000), T0)
    expect(remainingMs(running, T0 + 9_000)).toBe(0)
  })

  it('never reports more time left than the timer is long', () => {
    // A caller whose `now` predates the start would otherwise compute a
    // remaining time above the duration — measured as a 6-second timer flashing
    // 00:08 for 263ms after Start.
    const running = start(createTimer('a', '', 6_000), T0)
    expect(remainingMs(running, T0 - 2_000)).toBe(6_000)
  })

  it('survives pause/resume with no drift', () => {
    // 5:00 timer, run 60s, pause for an hour, resume, run 30s more.
    let t = start(createTimer('a', '', 300_000), T0)
    t = pause(t, T0 + 60_000)
    expect(t.running).toBe(false)
    expect(t.endAt).toBeNull()
    expect(remainingMs(t, T0 + 60_000)).toBe(240_000)
    // Paused time does not count, no matter how long it lasts.
    expect(remainingMs(t, T0 + 3_660_000)).toBe(240_000)

    const resumedAt = T0 + 3_660_000
    t = start(t, resumedAt)
    expect(t.endAt).toBe(resumedAt + 240_000)
    expect(remainingMs(t, resumedAt + 30_000)).toBe(210_000)

    // Total elapsed running time is exactly 90s, whatever the wall clock did.
    expect(remainingMs(t, resumedAt + 30_000)).toBe(300_000 - 90_000)
  })

  it('ignores a second start while already running', () => {
    const running = start(createTimer('a', '', 300_000), T0)
    expect(start(running, T0 + 60_000)).toBe(running)
  })

  it('ignores a pause while not running', () => {
    const t = createTimer('a', '', 300_000)
    expect(pause(t, T0)).toBe(t)
  })
})

describe('due detection', () => {
  it('is due only at or past endAt, and only once', () => {
    const running = start(createTimer('a', '', 5_000), T0)
    expect(isDue(running, T0 + 4_999)).toBe(false)
    expect(isDue(running, T0 + 5_000)).toBe(true)
    const done = complete(running)
    expect(isDue(done, T0 + 6_000)).toBe(false)
    expect(done.fired).toBe(true)
    expect(remainingMs(done, T0 + 6_000)).toBe(0)
    expect(formatClockDuration(remainingMs(done, T0 + 6_000))).toBe('00:00')
  })

  it('shows 00:01 right up to the moment it fires', () => {
    // The countdown/off-by-one pairing: while not yet due, the display must not
    // read 00:00.
    const running = start(createTimer('a', '', 5_000), T0)
    expect(formatClockDuration(remainingMs(running, T0 + 4_600))).toBe('00:01')
    expect(isDue(running, T0 + 4_600)).toBe(false)
  })
})

describe('reset and duration', () => {
  it('reset restores the configured length and clears the fired flag', () => {
    let t = start(createTimer('a', '', 300_000), T0)
    t = complete(t)
    t = reset(t)
    expect(t.fired).toBe(false)
    expect(remainingMs(t, T0)).toBe(300_000)
  })

  it('a completed timer restarts from its full duration, not from zero', () => {
    const done = complete(start(createTimer('a', '', 60_000), T0))
    const again = start(done, T0 + 60_000)
    expect(remainingMs(again, T0 + 60_000)).toBe(60_000)
  })

  it('setDuration is refused while running', () => {
    const running = start(createTimer('a', '', 300_000), T0)
    expect(setDuration(running, 60_000)).toBe(running)
    const paused = pause(running, T0 + 10_000)
    expect(remainingMs(setDuration(paused, 60_000), T0)).toBe(60_000)
  })
})

describe('parseDurationInput', () => {
  it('reads a bare number as minutes, as the box always meant', () => {
    expect(parseDurationInput('5')).toBe(300_000)
    expect(parseDurationInput('1')).toBe(60_000)
    expect(parseDurationInput(' 20 ')).toBe(1_200_000)
    expect(parseDurationInput('0.5')).toBe(30_000)
  })

  it('reads a colon form as clock parts, which is what makes sub-minute possible', () => {
    expect(parseDurationInput('0:05')).toBe(5_000)
    expect(parseDurationInput('0:30')).toBe(30_000)
    expect(parseDurationInput('1:30')).toBe(90_000)
    expect(parseDurationInput('5:00')).toBe(300_000)
    expect(parseDurationInput('90:00')).toBe(5_400_000)
    expect(parseDurationInput('1:02:03')).toBe(3_723_000)
  })

  it('refuses what it cannot mean', () => {
    expect(parseDurationInput('')).toBeNull()
    expect(parseDurationInput('   ')).toBeNull()
    expect(parseDurationInput('0')).toBeNull()
    expect(parseDurationInput('-5')).toBeNull()
    expect(parseDurationInput('abc')).toBeNull()
    expect(parseDurationInput('1:2:3:4')).toBeNull()
    expect(parseDurationInput('1:60')).toBeNull()
    expect(parseDurationInput('1:2:60')).toBeNull()
    expect(parseDurationInput('1:70:00')).toBeNull()
    expect(parseDurationInput('0:00')).toBeNull()
    expect(parseDurationInput(':30')).toBeNull()
    expect(parseDurationInput('5m')).toBeNull()
  })

  it('caps at a day', () => {
    expect(parseDurationInput('1440')).toBe(86_400_000)
    expect(parseDurationInput('1441')).toBeNull()
    expect(parseDurationInput('24:00:01')).toBeNull()
  })
})

describe('completionBody', () => {
  it('names the timer when it has a name', () => {
    expect(completionBody(createTimer('a', 'Tea', 300_000), '05:00')).toContain('Tea')
    expect(completionBody(createTimer('a', '', 300_000), '05:00')).toBe(
      'Your 05:00 countdown reached zero.'
    )
  })
})
