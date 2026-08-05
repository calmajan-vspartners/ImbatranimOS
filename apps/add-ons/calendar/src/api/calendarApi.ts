import { api } from '@imbatranim/core'
import type { CalendarEvent, CalendarEventInput } from '../types'

export async function fetchEvents(): Promise<CalendarEvent[]> {
  const res = await api.get<CalendarEvent[]>('/calendar/events')
  return res.data
}

export async function createEvent(input: CalendarEventInput): Promise<CalendarEvent> {
  const res = await api.post<CalendarEvent>('/calendar/events', input)
  return res.data
}

export async function patchEvent(
  id: number,
  patch: Partial<CalendarEventInput>
): Promise<CalendarEvent> {
  const res = await api.patch<CalendarEvent>(`/calendar/events/${id}`, patch)
  return res.data
}

export async function deleteEvent(id: number): Promise<void> {
  await api.delete(`/calendar/events/${id}`)
}

export type ImportResponse = { imported: number; skipped: 'not-empty' | null }

/**
 * Bulk insert. `onlyIfEmpty` is the one-time localStorage hand-over; without it
 * this is an ICS import appending to whatever is already there.
 */
export async function importEvents(
  events: CalendarEventInput[],
  onlyIfEmpty = false
): Promise<ImportResponse> {
  const res = await api.post<ImportResponse>('/calendar/import', { events, onlyIfEmpty })
  return res.data
}
