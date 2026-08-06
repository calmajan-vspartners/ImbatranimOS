import { describe, expect, it } from 'vitest'
import {
  EVERY_DAY,
  NO_REPEAT,
  WEEKDAYS,
  SNOOZE_MS,
  describeDays,
  dayIndex,
  dueOccurrence,
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

describe('dueOccurrence (window-based, brief 93)', () => {
  const since = (d: Date, secondsBefore: number) => d.getTime() - secondsBefore * 1000

  it('a throttled tick landing after the minute still catches the alarm', () => {
    // Hidden-tab reality: previous tick 06:59:30, this one 07:00:45.
    const tick = new Date(2026, 6, 20, 7, 0, 45)
    const due = dueOccurrence(alarm(), tick, since(tick, 75))
    expect(due).toEqual({ reason: 'scheduled', occurrenceMs: monday0700.getTime() })
  })

  it('reports the occurrence instant, not the tick that observed it', () => {
    const tick = new Date(2026, 6, 20, 7, 1, 20)
    const due = dueOccurrence(alarm(), tick, since(tick, 110))
    expect(due?.occurrenceMs).toBe(monday0700.getTime())
  })

  it('refuses an occurrence older than the late-fire window', () => {
    // Reopening a desktop at 07:02:00 must not ring the 07:00 alarm.
    const tick = new Date(2026, 6, 20, 7, 2, 0)
    expect(dueOccurrence(alarm(), tick, since(tick, 600))).toBeNull()
  })

  it('catches an alarm across midnight', () => {
    const lateAlarm = alarm({ time: '23:59' })
    const tick = new Date(2026, 6, 21, 0, 0, 20)
    const due = dueOccurrence(lateAlarm, tick, since(tick, 90))
    expect(due?.occurrenceMs).toBe(new Date(2026, 6, 20, 23, 59, 0).getTime())
  })

  it('weekday mask is judged on the occurrence day, not the tick day', () => {
    // Sunday 23:59 alarm observed Monday 00:00:30 — mask says Sundays only.
    // (since is strictly exclusive: 00:00:30 − 91s puts 23:59:00 inside it.)
    const sundayOnly = alarm({ time: '23:59', days: '0000001' })
    const tick = new Date(2026, 6, 20, 0, 0, 30)
    const due = dueOccurrence(sundayOnly, tick, since(tick, 91))
    expect(due?.occurrenceMs).toBe(new Date(2026, 6, 19, 23, 59, 0).getTime())
  })

  it('the minute guard keys on the occurrence minute', () => {
    const occurrence = new Date(2026, 6, 20, 7, 0, 0)
    const rang = alarm({ lastFiredAt: minuteKey(occurrence) })
    const tick = new Date(2026, 6, 20, 7, 0, 45)
    expect(dueOccurrence(rang, tick, since(tick, 75))).toBeNull()
  })

  it('a pending snooze yields its deadline as the occurrence', () => {
    const deadline = monday0700.getTime() + SNOOZE_MS
    const snoozed = alarm({ snoozedUntil: deadline })
    const tick = new Date(2026, 6, 20, 7, 5, 30)
    expect(dueOccurrence(snoozed, tick, since(tick, 60))).toEqual({
      reason: 'snooze',
      occurrenceMs: deadline,
    })
  })

  it('nothing due inside a quiet window', () => {
    const tick = new Date(2026, 6, 20, 6, 59, 50)
    expect(dueOccurrence(alarm(), tick, since(tick, 60))).toBeNull()
  })
})

describe('dueReason', () => {
  it('fires at its minute, for the whole minute, until it is marked', () => {
    expect(dueReason(alarm(), monday0700)).toBe('scheduled')
    expect(dueReason(alarm(), new Date(2026, 6, 20, 7, 0, 59))).toBe('scheduled')
    expect(dueReason(alarm(), new Date(2026, 6, 20, 6, 59, 59))).toBeNull()
    expect(dueReason(alarm(), new Date(2026, 6, 20, 7, 1, 0))).toBeNull()
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
