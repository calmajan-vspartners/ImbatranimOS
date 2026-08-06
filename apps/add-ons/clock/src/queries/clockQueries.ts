import { useMutation, useQuery } from '@tanstack/react-query'
import { notify, queryClient } from '@imbatranim/core'
import {
  createAlarm,
  createWorldClock,
  deleteAlarm,
  deleteWorldClock,
  fetchAlarms,
  fetchWorldClocks,
  patchAlarm,
} from '../api/clockApi'
import type { Alarm, AlarmPatch, WorldClock } from '../types'

export const WORLD_CLOCKS_KEY = ['clock', 'world-clocks'] as const
export const ALARMS_KEY = ['clock', 'alarms'] as const

/**
 * The alarms as the cache currently holds them, without subscribing.
 *
 * The notification watcher runs on a plain 1s interval outside React's render
 * cycle (it must keep firing whichever tab is showing), so it reads the cache
 * directly rather than through a hook. `undefined` means "not loaded yet", which
 * the watcher treats as "no alarms" — a missed check one second before the list
 * arrives is invisible.
 */
export function peekAlarms(): Alarm[] {
  return queryClient.getQueryData<Alarm[]>(ALARMS_KEY) ?? []
}

export function invalidateAlarms(): void {
  void queryClient.invalidateQueries({ queryKey: ALARMS_KEY })
}

/**
 * Write a patch into the cache *synchronously*.
 *
 * The watcher needs this, not just the request: it re-reads the cache once a
 * second, so an alarm marked as rung only by an in-flight PATCH would notify
 * again on the next tick — and again, for the whole minute, until the response
 * landed. Recording it locally first makes the guard immediate.
 */
export function applyAlarmPatchLocally(id: number, patch: AlarmPatch): void {
  queryClient.setQueryData<Alarm[]>(ALARMS_KEY, (old) =>
    old?.map((a) => (a.id === id ? { ...a, ...patch } : a))
  )
}

/**
 * Surface an optimistic-update rollback to the user.
 *
 * A rejected PATCH/DELETE silently springs the row back to its old state, which
 * reads as the app ignoring the click — the same gap todo and bookmarks close
 * with a `notify` on failure (L3).
 */
function reportFailure(action: string): void {
  notify({
    title: `Could not ${action}`,
    body: 'The change was not saved. Your alarms have been put back the way they were.',
    appId: 'clock',
    level: 'error',
  })
}

export function useWorldClocksQuery() {
  return useQuery({ queryKey: WORLD_CLOCKS_KEY, queryFn: fetchWorldClocks })
}

export function useCreateWorldClockMutation() {
  return useMutation({
    mutationFn: ({ label, timeZone }: { label: string; timeZone: string }) =>
      createWorldClock(label, timeZone),
    onSettled: () => queryClient.invalidateQueries({ queryKey: WORLD_CLOCKS_KEY }),
  })
}

export function useDeleteWorldClockMutation() {
  return useMutation({
    mutationFn: (id: number) => deleteWorldClock(id),
    // Optimistic: a removed row must vanish on click, not after a round trip.
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: WORLD_CLOCKS_KEY })
      const previous = queryClient.getQueryData<WorldClock[]>(WORLD_CLOCKS_KEY)
      queryClient.setQueryData<WorldClock[]>(WORLD_CLOCKS_KEY, (old) =>
        old?.filter((w) => w.id !== id)
      )
      return { previous }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(WORLD_CLOCKS_KEY, ctx.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: WORLD_CLOCKS_KEY }),
  })
}

export function useAlarmsQuery() {
  return useQuery({ queryKey: ALARMS_KEY, queryFn: fetchAlarms })
}

export function useCreateAlarmMutation() {
  return useMutation({
    mutationFn: ({ label, time, days }: { label: string; time: string; days: string }) =>
      createAlarm(label, time, days),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ALARMS_KEY }),
  })
}

export function usePatchAlarmMutation() {
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: AlarmPatch }) => patchAlarm(id, patch),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: ALARMS_KEY })
      const previous = queryClient.getQueryData<Alarm[]>(ALARMS_KEY)
      queryClient.setQueryData<Alarm[]>(ALARMS_KEY, (old) =>
        old?.map((a) => (a.id === id ? { ...a, ...patch } : a))
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(ALARMS_KEY, ctx.previous)
      reportFailure('save that alarm')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ALARMS_KEY }),
  })
}

export function useDeleteAlarmMutation() {
  return useMutation({
    mutationFn: (id: number) => deleteAlarm(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ALARMS_KEY })
      const previous = queryClient.getQueryData<Alarm[]>(ALARMS_KEY)
      queryClient.setQueryData<Alarm[]>(ALARMS_KEY, (old) => old?.filter((a) => a.id !== id))
      return { previous }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(ALARMS_KEY, ctx.previous)
      reportFailure('delete that alarm')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ALARMS_KEY }),
  })
}
