import { describe, expect, it } from 'vitest'
import { normaliseClockIntent } from './notificationIntent'

/**
 * Clock is the first adopter of toast actions (brief 107). The payload arrives
 * as plain data through `openApp`, so it has to be validated like any other
 * untrusted input — it can come from persisted history or another tab.
 */
describe('normaliseClockIntent', () => {
  it('accepts the snooze payload the alarm toast sends', () => {
    expect(normaliseClockIntent({ action: 'snooze', alarmId: 7 })).toEqual({
      action: 'snooze',
      alarmId: 7,
    })
  })

  it('refuses anything else', () => {
    expect(normaliseClockIntent(null)).toBeNull()
    expect(normaliseClockIntent(undefined)).toBeNull()
    expect(normaliseClockIntent('snooze')).toBeNull()
    expect(normaliseClockIntent({ action: 'dismiss', alarmId: 7 })).toBeNull()
    // A plain launch (no payload) must not be mistaken for an action.
    expect(normaliseClockIntent({})).toBeNull()
  })

  it('refuses a non-numeric or non-finite alarm id', () => {
    expect(normaliseClockIntent({ action: 'snooze', alarmId: '7' })).toBeNull()
    expect(normaliseClockIntent({ action: 'snooze', alarmId: Number.NaN })).toBeNull()
    expect(normaliseClockIntent({ action: 'snooze' })).toBeNull()
  })
})
