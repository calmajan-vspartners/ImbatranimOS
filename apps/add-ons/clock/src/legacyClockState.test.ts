import { describe, expect, it } from 'vitest'
import { describeMigration, readLegacyClockState } from './legacyClockState'

/** What zustand's persist middleware actually wrote. */
function persisted(state: unknown): string {
  return JSON.stringify({ state, version: 0 })
}

describe('readLegacyClockState', () => {
  it('reads the real zustand shape', () => {
    const raw = persisted({
      worldClocks: [{ id: 'a', label: 'Tokyo', timeZone: 'Asia/Tokyo' }],
      alarms: [{ id: 'b', label: 'Wake up', time: '07:00', enabled: true, lastFiredAt: null }],
    })
    expect(readLegacyClockState(raw)).toEqual({
      worldClocks: [{ label: 'Tokyo', timeZone: 'Asia/Tokyo' }],
      alarms: [{ label: 'Wake up', time: '07:00', enabled: true }],
      skipped: 0,
    })
  })

  it('accepts the bare shape too', () => {
    const raw = JSON.stringify({ alarms: [{ time: '06:30' }] })
    expect(readLegacyClockState(raw)?.alarms).toEqual([{ label: '', time: '06:30', enabled: true }])
  })

  it('has nothing to say about a missing, empty or unparseable key', () => {
    expect(readLegacyClockState(null)).toBeNull()
    expect(readLegacyClockState('')).toBeNull()
    expect(readLegacyClockState('{"state":{')).toBeNull()
    expect(readLegacyClockState('"a string"')).toBeNull()
    expect(readLegacyClockState(persisted({}))).toBeNull()
    expect(readLegacyClockState(persisted({ worldClocks: [], alarms: [] }))).toBeNull()
  })

  it('keeps an alarm armed unless it was explicitly disabled', () => {
    const raw = persisted({
      alarms: [
        { time: '07:00', enabled: false },
        { time: '08:00' },
        { time: '09:00', enabled: true },
      ],
    })
    expect(readLegacyClockState(raw)?.alarms.map((a) => a.enabled)).toEqual([false, true, true])
  })

  it('counts the entries it cannot use instead of dropping them silently', () => {
    const raw = persisted({
      worldClocks: [{ label: 'Nowhere' }, { timeZone: '' }, { timeZone: 'Asia/Tokyo' }],
      alarms: [{ time: '25:00' }, { time: 'noon' }, {}, { time: '07:00' }],
    })
    const legacy = readLegacyClockState(raw)
    expect(legacy?.worldClocks).toHaveLength(1)
    expect(legacy?.alarms).toHaveLength(1)
    expect(legacy?.skipped).toBe(5)
  })

  it('falls back to the zone as the label', () => {
    const raw = persisted({ worldClocks: [{ timeZone: 'Europe/Berlin' }] })
    expect(readLegacyClockState(raw)?.worldClocks).toEqual([
      { label: 'Europe/Berlin', timeZone: 'Europe/Berlin' },
    ])
  })

  it('caps labels at the length the backend accepts', () => {
    const raw = persisted({ alarms: [{ time: '07:00', label: 'x'.repeat(500) }] })
    expect(readLegacyClockState(raw)?.alarms[0].label).toHaveLength(120)
  })

  it('survives junk in place of the arrays', () => {
    expect(readLegacyClockState(persisted({ alarms: 'nope', worldClocks: 7 }))).toBeNull()
    expect(readLegacyClockState(persisted({ alarms: [null, 5, 'x'] }))?.skipped).toBe(3)
  })
})

describe('describeMigration', () => {
  it('says what moved, in singular or plural', () => {
    expect(describeMigration(0, 1)).toContain('1 alarm ')
    expect(describeMigration(0, 2)).toContain('2 alarms')
    expect(describeMigration(1, 0)).toContain('1 world clock')
    expect(describeMigration(2, 3)).toContain('3 alarms and 2 world clocks')
  })
})
