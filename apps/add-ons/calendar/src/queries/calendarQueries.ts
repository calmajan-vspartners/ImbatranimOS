import { useMutation, useQuery } from '@tanstack/react-query'
import { queryClient, useSystem } from '@imbatranim/ui'
import { createEvent, deleteEvent, fetchEvents, importEvents, patchEvent } from '../api/calendarApi'
import type { CalendarEvent, CalendarEventInput } from '../types'

export const EVENTS_KEY = ['calendar', 'events'] as const

/**
 * The events as the cache holds them, without subscribing — the reminder watcher
 * runs on a plain interval outside React's render cycle and must not re-subscribe
 * every minute.
 */
export function peekEvents(): CalendarEvent[] {
  return queryClient.getQueryData<CalendarEvent[]>(EVENTS_KEY) ?? []
}

export function invalidateEvents(): void {
  void queryClient.invalidateQueries({ queryKey: EVENTS_KEY })
}

export function useEventsQuery(options?: { refetchIntervalMs?: number }) {
  const system = useSystem()
  return useQuery({
    queryKey: EVENTS_KEY,
    queryFn: () => fetchEvents(system.http),
    // The background service (brief 93) keeps this cache warm for the reminder
    // watcher even with no Calendar window open — and keeps polling while the
    // tab is hidden, because that is exactly when a reminder must still fire.
    refetchInterval: options?.refetchIntervalMs,
    refetchIntervalInBackground: options?.refetchIntervalMs !== undefined,
  })
}

export function useCreateEventMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: (input: CalendarEventInput) => createEvent(system.http, input),
    onSettled: invalidateEvents,
  })
}

export function usePatchEventMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<CalendarEventInput> }) =>
      patchEvent(system.http, id, patch),
    // Optimistic: an edited event must move on the grid immediately, not after a
    // round trip — the grid is the feedback.
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: EVENTS_KEY })
      const previous = queryClient.getQueryData<CalendarEvent[]>(EVENTS_KEY)
      queryClient.setQueryData<CalendarEvent[]>(EVENTS_KEY, (old) =>
        old?.map((e) => (e.id === id ? applyPatch(e, patch) : e))
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(EVENTS_KEY, ctx.previous)
    },
    onSettled: invalidateEvents,
  })
}

export function useDeleteEventMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: (id: number) => deleteEvent(system.http, id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: EVENTS_KEY })
      const previous = queryClient.getQueryData<CalendarEvent[]>(EVENTS_KEY)
      queryClient.setQueryData<CalendarEvent[]>(EVENTS_KEY, (old) =>
        old?.filter((e) => e.id !== id)
      )
      return { previous }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(EVENTS_KEY, ctx.previous)
    },
    onSettled: invalidateEvents,
  })
}

export function useImportEventsMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: (events: CalendarEventInput[]) => importEvents(system.http, events, false),
    onSettled: invalidateEvents,
  })
}

/**
 * Apply a patch to a cached event.
 *
 * Not a plain spread: the API omits absent optional fields, so a patch that sets
 * `notes: null` must *remove* the key rather than leave `null` sitting in a field
 * typed `string | undefined`.
 */
function applyPatch(event: CalendarEvent, patch: Partial<CalendarEventInput>): CalendarEvent {
  const next: CalendarEvent = { ...event }
  if (patch.title !== undefined) next.title = patch.title
  if (patch.start !== undefined) next.start = patch.start
  if (patch.end !== undefined) next.end = patch.end
  if (patch.allDay !== undefined) next.allDay = patch.allDay
  if (patch.exceptions !== undefined) next.exceptions = patch.exceptions
  if (patch.recurrence !== undefined) next.recurrence = patch.recurrence ?? null
  if (patch.notes !== undefined) {
    if (patch.notes) next.notes = patch.notes
    else delete next.notes
  }
  if (patch.color !== undefined) {
    if (patch.color) next.color = patch.color
    else delete next.color
  }
  if (patch.reminderMinutes !== undefined) {
    if (patch.reminderMinutes) next.reminderMinutes = patch.reminderMinutes
    else delete next.reminderMinutes
  }
  return next
}
