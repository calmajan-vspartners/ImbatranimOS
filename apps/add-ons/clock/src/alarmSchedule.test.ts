import { describe, expect, it } from 'vitest'
import {
  ALARM_CATCHUP_MS,
  EVERY_DAY,
  NO_REPEAT,
  WEEKDAYS,
  SNOOZE_MS,
  describeDays,
  dayIndex,
  dueReason,
  firedPatch,
  isValidDayMask,
  minuteKey,
  repeatsOn,
  snoozePatch,
  toggleDay,
  type SchedulableAlarm,
} from './alarmSchedule'

/** 2026-07-20 is a Monday; 2026-07-18 a Saturday; 2026-07-19 a Sunday. */
const monday0700 = new Date(2026, 6, 20, 7, 0, 0)
const saturday0700 = new Date(2026, 6, 18, 7, 0, 0)
const sunday0700 = new Date(2026, 6, 19, 7, 0, 0)

function alarm(over: Partial<SchedulableAlarm> = {}): SchedulableAlarm {
  return {
    time: '07:00',
    enabled: true,
    days: NO_REPEAT,
    lastFiredAt: null,
    snoozedUntil: null,
    ...over,
  }
}

describe('day mask', () => {
  it('is Monday-first, unlike getDay()', () => {
    expect(dayIndex(monday0700)).toBe(0)
    expect(dayIndex(saturday0700)).toBe(5)
    expect(dayIndex(sunday0700)).toBe(6)
  })

  it('validates shape', () => {
    expect(isValidDayMask('0000000')).toBe(true)
    expect(isValidDayMask('1010101')).toBe(true)
    expect(isValidDayMask('101010')).toBe(false)
    expect(isValidDayMask('10101012')).toBe(false)
    expect(isValidDayMask('abcdefg')).toBe(false)
  })

  it('toggles one day at a time and repairs a malformed mask', () => {
    expect(toggleDay(NO_REPEAT, 0)).toBe('1000000')
    expect(toggleDay('1000000', 0)).toBe(NO_REPEAT)
    expect(toggleDay('1000000', 6)).toBe('1000001')
    expect(toggleDay('nonsense', 2)).toBe('0010000')
  })

  it('reads the mask for a given weekday', () => {
    expect(repeatsOn(WEEKDAYS, dayIndex(monday0700))).toBe(true)
    expect(repeatsOn(WEEKDAYS, dayIndex(saturday0700))).toBe(false)
    expect(repeatsOn(EVERY_DAY, dayIndex(sunday0700))).toBe(true)
  })

  it('describes itself the way the row shows it', () => {
    expect(describeDays(NO_REPEAT)).toBe('Once')
    expect(describeDays(EVERY_DAY)).toBe('Every day')
    expect(describeDays(WEEKDAYS)).toBe('Weekdays')
    expect(describeDays('0000011')).toBe('Weekends')
    expect(describeDays('1010100')).toBe('Mon, Wed, Fri')
    expect(describeDays('bad')).toBe('Once')
  })
})

describe('minuteKey', () => {
  it('changes with the minute and with the day, not with the second', () => {
    expect(minuteKey(new Date(2026, 6, 20, 7, 0, 0))).toBe(
      minuteKey(new Date(2026, 6, 20, 7, 0, 59))
    )
    expect(minuteKey(new Date(2026, 6, 20, 7, 0))).not.toBe(minuteKey(new Date(2026, 6, 20, 7, 1)))
    expect(minuteKey(new Date(2026, 6, 20, 7, 0))).not.toBe(minuteKey(new Date(2026, 6, 21, 7, 0)))
  })
})

describe('dueReason', () => {
  it('fires from its minute onward, and not before', () => {
    expect(dueReason(alarm(), monday0700)).toBe('scheduled')
    expect(dueReason(alarm(), new Date(2026, 6, 20, 7, 0, 59))).toBe('scheduled')
    expect(dueReason(alarm(), new Date(2026, 6, 20, 6, 59, 59))).toBeNull()
  })

  it('catches up when a throttled or slept tab ticks after the minute (T1-7)', () => {
    // The bug: an exact HH:mm match meant a tick that landed at 07:03 (never at
    // 07:00) skipped the alarm entirely. It must ring on the next tick instead.
    expect(dueReason(alarm(), new Date(2026, 6, 20, 7, 3, 0))).toBe('scheduled')
    // …once. Marking the scheduled minute stops the following ticks re-ringing it.
    const rung = alarm({ lastFiredAt: minuteKey(monday0700) })
    expect(dueReason(rung, new Date(2026, 6, 20, 7, 3, 0))).toBeNull()
    // …but only within the bounded window: a machine slept for hours must not
    // resurrect the stale morning alarm.
    expect(dueReason(alarm(), new Date(monday0700.getTime() + ALARM_CATCHUP_MS + 1000))).toBeNull()
  })

  it('does not fire twice inside the same minute', () => {
    const rang = alarm({ lastFiredAt: minuteKey(monday0700) })
    expect(dueReason(rang, monday0700)).toBeNull()
    expect(dueReason(rang, new Date(2026, 6, 20, 7, 0, 42))).toBeNull()
    // …but the same alarm is due again tomorrow (when it repeats).
    expect(dueReason({ ...rang, days: EVERY_DAY }, new Date(2026, 6, 21, 7, 0))).toBe('scheduled')
  })

  it('ignores disabled alarms', () => {
    expect(dueReason(alarm({ enabled: false }), monday0700)).toBeNull()
  })

  it('honours the weekday mask', () => {
    expect(dueReason(alarm({ days: WEEKDAYS }), monday0700)).toBe('scheduled')
    expect(dueReason(alarm({ days: WEEKDAYS }), saturday0700)).toBeNull()
    expect(dueReason(alarm({ days: '0000011' }), saturday0700)).toBe('scheduled')
    expect(dueReason(alarm({ days: EVERY_DAY }), sunday0700)).toBe('scheduled')
  })

  it('lets an unrepeated alarm ring on whatever day comes first', () => {
    expect(dueReason(alarm({ days: NO_REPEAT }), saturday0700)).toBe('scheduled')
    expect(dueReason(alarm({ days: NO_REPEAT }), sunday0700)).toBe('scheduled')
  })

  it('suppresses the scheduled time while a snooze is pending', () => {
    // The bug this pins: snoozing at 07:00:10 must not re-ring at 07:00:11,
    // even though the wall clock still reads 07:00.
    const snoozed = alarm({ snoozedUntil: monday0700.getTime() + SNOOZE_MS })
    expect(dueReason(snoozed, new Date(2026, 6, 20, 7, 0, 11))).toBeNull()
    expect(dueReason(snoozed, new Date(2026, 6, 20, 7, 4, 59))).toBeNull()
  })

  it('fires when the snooze expires, whatever the clock reads', () => {
    const snoozed = alarm({ snoozedUntil: monday0700.getTime() + SNOOZE_MS })
    expect(dueReason(snoozed, new Date(2026, 6, 20, 7, 5, 0))).toBe('snooze')
    expect(dueReason(snoozed, new Date(2026, 6, 20, 7, 9, 0))).toBe('snooze')
  })
})

describe('the patches persisted around a ring', () => {
  it('disables a one-shot alarm once it has rung', () => {
    expect(firedPatch(alarm({ days: NO_REPEAT }), monday0700)).toEqual({
      lastFiredAt: minuteKey(monday0700),
      snoozedUntil: null,
      enabled: false,
    })
  })

  it('leaves a repeating alarm armed', () => {
    const patch = firedPatch(alarm({ days: WEEKDAYS }), monday0700)
    expect(patch).toEqual({ lastFiredAt: minuteKey(monday0700), snoozedUntil: null })
    expect(patch.enabled).toBeUndefined()
  })

  it('re-arms on snooze, so a snoozed one-shot still arrives', () => {
    // firedPatch has just set enabled:false on a "Once" alarm; without the
    // enabled:true here, dueReason would ignore it forever.
    const patch = snoozePatch(monday0700.getTime())
    expect(patch).toEqual({ enabled: true, snoozedUntil: monday0700.getTime() + SNOOZE_MS })
    // The alarm as firedPatch left it (disabled), with the snooze patch applied.
    const after = { ...alarm({ days: NO_REPEAT, enabled: false }), ...patch }
    expect(dueReason(after, new Date(2026, 6, 20, 7, 5, 0))).toBe('snooze')
  })
})
