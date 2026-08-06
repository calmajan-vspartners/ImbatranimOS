import type { SystemHttp } from '@imbatranim/ui'
import type { Alarm, AlarmPatch, WorldClock } from '../types'

/**
 * The app's own backend module, reached through the injected handle (brief 48).
 * Plain functions take the capability as their first argument; only hooks may
 * call `useSystem()`, and these are not hooks.
 */

export async function fetchWorldClocks(http: SystemHttp): Promise<WorldClock[]> {
  const res = await http.get<WorldClock[]>('/clock/world-clocks')
  return res.data
}

export async function createWorldClock(
  http: SystemHttp,
  label: string,
  timeZone: string
): Promise<WorldClock> {
  const res = await http.post<WorldClock>('/clock/world-clocks', { label, timeZone })
  return res.data
}

export async function deleteWorldClock(http: SystemHttp, id: number): Promise<void> {
  await http.delete(`/clock/world-clocks/${id}`)
}

export async function fetchAlarms(http: SystemHttp): Promise<Alarm[]> {
  const res = await http.get<Alarm[]>('/clock/alarms')
  return res.data
}

export async function createAlarm(
  http: SystemHttp,
  label: string,
  time: string,
  days: string
): Promise<Alarm> {
  const res = await http.post<Alarm>('/clock/alarms', { label, time, days })
  return res.data
}

export async function patchAlarm(http: SystemHttp, id: number, patch: AlarmPatch): Promise<Alarm> {
  const res = await http.patch<Alarm>(`/clock/alarms/${id}`, patch)
  return res.data
}

export async function deleteAlarm(http: SystemHttp, id: number): Promise<void> {
  await http.delete(`/clock/alarms/${id}`)
}

/** Result of the one-time localStorage hand-over. */
export type ImportResult = { imported: boolean; worldClocks: number; alarms: number }

export async function importClockState(
  http: SystemHttp,
  payload: {
    worldClocks?: { label: string; timeZone: string }[]
    alarms?: { label?: string; time: string; enabled?: boolean }[]
  }
): Promise<ImportResult> {
  const res = await http.post<ImportResult>('/clock/import', payload)
  return res.data
}
