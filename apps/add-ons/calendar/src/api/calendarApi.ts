import type { SystemHttp } from '@imbatranim/ui'
import type { CalendarEvent, CalendarEventInput } from '../types'

/**
 * The app's own backend module, reached through the injected handle (brief 48).
 * Plain functions take the capability as their first argument; only hooks may
 * call `useSystem()`, and these are not hooks.
 */

export async function fetchEvents(http: SystemHttp): Promise<CalendarEvent[]> {
  const res = await http.get<CalendarEvent[]>('/calendar/events')
  return res.data
}

export async function createEvent(
  http: SystemHttp,
  input: CalendarEventInput
): Promise<CalendarEvent> {
  const res = await http.post<CalendarEvent>('/calendar/events', input)
  return res.data
}

export async function patchEvent(
  http: SystemHttp,
  id: number,
  patch: Partial<CalendarEventInput>
): Promise<CalendarEvent> {
  const res = await http.patch<CalendarEvent>(`/calendar/events/${id}`, patch)
  return res.data
}

export async function deleteEvent(http: SystemHttp, id: number): Promise<void> {
  await http.delete(`/calendar/events/${id}`)
}

export type ImportResponse = { imported: number; skipped: 'not-empty' | null }

/**
 * Bulk insert. `onlyIfEmpty` is the one-time localStorage hand-over; without it
 * this is an ICS import appending to whatever is already there.
 */
export async function importEvents(
  http: SystemHttp,
  events: CalendarEventInput[],
  onlyIfEmpty = false
): Promise<ImportResponse> {
  const res = await http.post<ImportResponse>('/calendar/import', { events, onlyIfEmpty })
  return res.data
}
