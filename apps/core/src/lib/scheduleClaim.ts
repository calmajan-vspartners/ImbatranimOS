import { api } from './axios'

export type ScheduleDomain = 'clock' | 'calendar' | 'todo'

/**
 * Ask the backend whether this tab won a scheduled occurrence (brief 93).
 *
 * The `schedule_fired` primary key makes the claim atomic: with two desktop
 * tabs polling the same alarms, exactly one INSERT succeeds and only that tab
 * shows the toast. Durable, so a reload inside the same minute cannot re-toast
 * an alarm either.
 *
 * Fails **open**: if the backend is unreachable the caller should still
 * notify — a duplicate toast in a rare failure mode beats a silently missed
 * alarm in the same one.
 */
export async function claimScheduleOccurrence(
  domain: ScheduleDomain,
  itemId: string,
  occurrenceMs: number
): Promise<boolean> {
  try {
    const { data } = await api.post<{ claimed: boolean }>('/schedule/claim', {
      domain,
      itemId,
      occurrenceMs,
    })
    return data.claimed
  } catch {
    return true
  }
}
