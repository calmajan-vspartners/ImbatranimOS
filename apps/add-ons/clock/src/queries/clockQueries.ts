import { useMutation, useQuery } from '@tanstack/react-query'
import { queryClient, useSystem } from '@imbatranim/ui'
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

export function useWorldClocksQuery() {
  const system = useSystem()
  return useQuery({ queryKey: WORLD_CLOCKS_KEY, queryFn: () => fetchWorldClocks(system.http) })
}

export function useCreateWorldClockMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: ({ label, timeZone }: { label: string; timeZone: string }) =>
      createWorldClock(system.http, label, timeZone),
    onSettled: () => queryClient.invalidateQueries({ queryKey: WORLD_CLOCKS_KEY }),
  })
}

export function useDeleteWorldClockMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: (id: number) => deleteWorldClock(system.http, id),
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

export function useAlarmsQuery(options?: { refetchIntervalMs?: number }) {
  const system = useSystem()
  return useQuery({
    queryKey: ALARMS_KEY,
    queryFn: () => fetchAlarms(system.http),
    // The background service (brief 93) keeps this cache warm for the watcher
    // even with no Clock window open — and keeps polling while the tab is
    // hidden, because that is exactly when an alarm must still ring.
    refetchInterval: options?.refetchIntervalMs,
    refetchIntervalInBackground: options?.refetchIntervalMs !== undefined,
  })
}

export function useCreateAlarmMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: ({ label, time, days }: { label: string; time: string; days: string }) =>
      createAlarm(system.http, label, time, days),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ALARMS_KEY }),
  })
}

export function usePatchAlarmMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: AlarmPatch }) =>
      patchAlarm(system.http, id, patch),
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
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ALARMS_KEY }),
  })
}

export function useDeleteAlarmMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: (id: number) => deleteAlarm(system.http, id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ALARMS_KEY })
      const previous = queryClient.getQueryData<Alarm[]>(ALARMS_KEY)
      queryClient.setQueryData<Alarm[]>(ALARMS_KEY, (old) => old?.filter((a) => a.id !== id))
      return { previous }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(ALARMS_KEY, ctx.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ALARMS_KEY }),
  })
}
