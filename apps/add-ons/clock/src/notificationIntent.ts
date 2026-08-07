/**
 * Payloads Clock accepts from its own notification actions (brief 107).
 *
 * A toast action is intent-shaped DATA — `openApp('clock', payload)` — so the
 * app must be able to recognise its own payload after a reload, from history,
 * or with no Clock window previously open. Pure, so the recogniser is
 * unit-tested without React.
 */
export type ClockNotificationIntent = { action: 'snooze'; alarmId: number }

export function normaliseClockIntent(raw: unknown): ClockNotificationIntent | null {
  if (raw === null || typeof raw !== 'object') return null
  const it = raw as Record<string, unknown>
  if (it.action !== 'snooze') return null
  if (typeof it.alarmId !== 'number' || !Number.isFinite(it.alarmId)) return null
  return { action: 'snooze', alarmId: it.alarmId }
}
