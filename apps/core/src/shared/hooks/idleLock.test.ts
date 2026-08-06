import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createIdleLock, type IdleLockController } from './idleLock'

describe('createIdleLock', () => {
  let onLock: ReturnType<typeof vi.fn<() => void>>
  let mediaPlaying: boolean
  let ctl: IdleLockController | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    onLock = vi.fn()
    mediaPlaying = false
  })

  afterEach(() => {
    ctl?.dispose()
    ctl = undefined
    vi.useRealTimers()
  })

  function make(timeoutMs: number | null) {
    ctl = createIdleLock({
      timeoutMs,
      onLock,
      isMediaPlaying: () => mediaPlaying,
    })
    return ctl
  }

  it('locks exactly at expiry with no activity', () => {
    make(60_000)
    vi.advanceTimersByTime(59_999)
    expect(onLock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onLock).toHaveBeenCalledTimes(1)
  })

  it('activity defers the lock by a full period from the stamp', () => {
    make(60_000)
    vi.advanceTimersByTime(45_000)
    ctl!.markActivity()
    vi.advanceTimersByTime(59_999)
    expect(onLock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onLock).toHaveBeenCalledTimes(1)
  })

  it('repeated activity keeps deferring without timer churn', () => {
    make(60_000)
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(30_000)
      ctl!.markActivity()
    }
    expect(onLock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(onLock).toHaveBeenCalledTimes(1)
  })

  it('null timeout never locks', () => {
    make(null)
    vi.advanceTimersByTime(24 * 60 * 60_000)
    expect(onLock).not.toHaveBeenCalled()
  })

  it('playing media suppresses the lock and restarts the period', () => {
    make(60_000)
    mediaPlaying = true
    vi.advanceTimersByTime(60_000)
    expect(onLock).not.toHaveBeenCalled()
    // Media stops mid-period; the lock fires one full period after the fire
    // that found media playing (playback stamped activity at that moment).
    mediaPlaying = false
    vi.advanceTimersByTime(59_999)
    expect(onLock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onLock).toHaveBeenCalledTimes(1)
  })

  it('setTimeoutMs mid-countdown re-arms from now', () => {
    make(30 * 60_000)
    vi.advanceTimersByTime(20 * 60_000)
    // Shrinking the period must not lock instantly off the stale stamp.
    ctl!.setTimeoutMs(5 * 60_000)
    vi.advanceTimersByTime(4 * 60_000 + 59_999)
    expect(onLock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onLock).toHaveBeenCalledTimes(1)
  })

  it('setTimeoutMs(null) disables a pending lock', () => {
    make(60_000)
    ctl!.setTimeoutMs(null)
    vi.advanceTimersByTime(10 * 60_000)
    expect(onLock).not.toHaveBeenCalled()
  })

  it('checkNow locks immediately once the deadline has passed (throttled tab)', () => {
    // Simulate a background tab whose timer never fired: dispose the real timer
    // by advancing nothing, then jump the clock via a manual stamp offset.
    const start = Date.now()
    let fakeNow = start
    ctl = createIdleLock({
      timeoutMs: 60_000,
      onLock,
      isMediaPlaying: () => false,
      now: () => fakeNow,
    })
    fakeNow = start + 61_000
    ctl.checkNow()
    expect(onLock).toHaveBeenCalledTimes(1)
  })

  it('dispose stops everything', () => {
    make(60_000)
    ctl!.dispose()
    vi.advanceTimersByTime(10 * 60_000)
    expect(onLock).not.toHaveBeenCalled()
  })
})
