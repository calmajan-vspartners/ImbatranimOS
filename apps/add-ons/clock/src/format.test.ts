import { describe, expect, it } from 'vitest'
import {
  currentHHmm,
  formatClockDuration,
  formatStopwatch,
  formatTimeInZone,
  formatUtcOffset,
  pad2,
} from './format'

describe('formatClockDuration — the countdown rule (ceil)', () => {
  it('shows the full duration for the whole first second', () => {
    // The bug this pins: with Math.round, 5:00 flipped to 04:59 after ~500ms.
    expect(formatClockDuration(300_000)).toBe('05:00')
    expect(formatClockDuration(299_999)).toBe('05:00')
    expect(formatClockDuration(299_500)).toBe('05:00')
    expect(formatClockDuration(299_001)).toBe('05:00')
    // Only once a full second has actually elapsed does it read 04:59.
    expect(formatClockDuration(299_000)).toBe('04:59')
  })

  it('never reads 00:00 while time remains', () => {
    expect(formatClockDuration(1)).toBe('00:01')
    expect(formatClockDuration(400)).toBe('00:01')
    expect(formatClockDuration(999)).toBe('00:01')
    expect(formatClockDuration(1_000)).toBe('00:01')
    expect(formatClockDuration(1_001)).toBe('00:02')
  })

  it('reads 00:00 only at exact zero, and clamps below it', () => {
    expect(formatClockDuration(0)).toBe('00:00')
    expect(formatClockDuration(-1)).toBe('00:00')
    expect(formatClockDuration(-5_000)).toBe('00:00')
  })

  it('grows an hours field only when there are hours', () => {
    expect(formatClockDuration(59 * 60_000)).toBe('59:00')
    expect(formatClockDuration(60 * 60_000)).toBe('01:00:00')
    expect(formatClockDuration(3 * 3_600_000 + 7 * 60_000 + 9_000)).toBe('03:07:09')
    // Same ceil rule with hours present: a hair under the hour is still 01:00:00.
    expect(formatClockDuration(3_599_999)).toBe('01:00:00')
  })
})

describe('formatStopwatch — the elapsed rule (floor), deliberately opposite', () => {
  it('starts at zero rather than at a duration', () => {
    expect(formatStopwatch(0)).toBe('00:00.00')
    expect(formatStopwatch(9)).toBe('00:00.00')
    expect(formatStopwatch(10)).toBe('00:00.01')
  })

  it('floors: it never shows time that has not passed', () => {
    // The mirror image of the countdown test above — 999ms elapsed is 0.99s,
    // not 1s. If someone "unifies" the two formatters, one of these two
    // describe blocks fails.
    expect(formatStopwatch(999)).toBe('00:00.99')
    expect(formatStopwatch(1_000)).toBe('00:01.00')
    expect(formatStopwatch(61_230)).toBe('01:01.23')
  })

  it('clamps negatives', () => {
    expect(formatStopwatch(-1)).toBe('00:00.00')
  })
})

describe('pad2', () => {
  it('pads single digits only', () => {
    expect(pad2(0)).toBe('00')
    expect(pad2(9)).toBe('09')
    expect(pad2(10)).toBe('10')
    expect(pad2(99)).toBe('99')
  })
})

describe('currentHHmm', () => {
  it('is 24h and zero-padded, matching the alarm time format', () => {
    expect(currentHHmm(new Date(2026, 6, 18, 7, 5))).toBe('07:05')
    expect(currentHHmm(new Date(2026, 6, 18, 0, 0))).toBe('00:00')
    expect(currentHHmm(new Date(2026, 6, 18, 23, 59))).toBe('23:59')
  })
})

describe('zone formatting stays Intl-based (and therefore DST-correct)', () => {
  // 2026-07-18 is inside British Summer Time and inside US Eastern DST; the
  // same instant in January is not. Nothing in this app tracks offsets by hand.
  const summer = new Date('2026-07-18T12:00:00Z')
  const winter = new Date('2026-01-18T12:00:00Z')

  it('shifts London by an hour between winter and summer', () => {
    expect(formatTimeInZone(summer, 'Europe/London')).toBe('13:00:00')
    expect(formatTimeInZone(winter, 'Europe/London')).toBe('12:00:00')
  })

  it('reports the offset in force at that instant', () => {
    expect(formatUtcOffset(summer, 'Europe/London')).toBe('GMT+1')
    // ICU spells a zero offset either "GMT" or "GMT+0" depending on version;
    // what matters is that it is zero, not which spelling this build picked.
    expect(formatUtcOffset(winter, 'Europe/London')).toMatch(/^GMT(\+0)?$/)
    expect(formatUtcOffset(summer, 'America/New_York')).toBe('GMT-4')
    expect(formatUtcOffset(winter, 'America/New_York')).toBe('GMT-5')
  })
})
