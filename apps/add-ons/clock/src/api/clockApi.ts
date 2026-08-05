import { api } from '@imbatranim/core'
import type { Alarm, AlarmPatch, WorldClock } from '../types'

export async function fetchWorldClocks(): Promise<WorldClock[]> {
  const res = await api.get<WorldClock[]>('/clock/world-clocks')
  return res.data
}

export async function createWorldClock(label: string, timeZone: string): Promise<WorldClock> {
  const res = await api.post<WorldClock>('/clock/world-clocks', { label, timeZone })
  return res.data
}

export async function deleteWorldClock(id: number): Promise<void> {
  await api.delete(`/clock/world-clocks/${id}`)
}

export async function fetchAlarms(): Promise<Alarm[]> {
  const res = await api.get<Alarm[]>('/clock/alarms')
  return res.data
}

export async function createAlarm(label: string, time: string, days: string): Promise<Alarm> {
  const res = await api.post<Alarm>('/clock/alarms', { label, time, days })
  return res.data
}

export async function patchAlarm(id: number, patch: AlarmPatch): Promise<Alarm> {
  const res = await api.patch<Alarm>(`/clock/alarms/${id}`, patch)
  return res.data
}

export async function deleteAlarm(id: number): Promise<void> {
  await api.delete(`/clock/alarms/${id}`)
}

/** Result of the one-time localStorage hand-over. */
export type ImportResult = { imported: boolean; worldClocks: number; alarms: number }

export async function importClockState(payload: {
  worldClocks?: { label: string; timeZone: string }[]
  alarms?: { label?: string; time: string; enabled?: boolean }[]
}): Promise<ImportResult> {
  const res = await api.post<ImportResult>('/clock/import', payload)
  return res.data
}
