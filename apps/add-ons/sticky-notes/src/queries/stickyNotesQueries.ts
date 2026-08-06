import { useMutation, useQuery } from '@tanstack/react-query'
import { queryClient, useSystem, type SystemHandle } from '@imbatranim/ui'
import {
  createStickyNote,
  deleteStickyNote,
  fetchStickyNotes,
  updateStickyNote,
} from '../api/stickyNotesApi'
import type { StickyNote, StickyNoteInput, StickyNotePatch } from '../types'

export const NOTES_KEY = ['sticky-notes'] as const

/**
 * Report a failed write.
 *
 * Before brief 74 the only failure signal in this app was a `console.error` in the
 * create path — a note could fail to save and the user was told nothing, three
 * briefs after `notify()` shipped.
 */
function reportFailure(system: SystemHandle, action: string): void {
  system.notify({
    title: `Could not ${action}`,
    body: 'The change was not saved.',
    level: 'error',
  })
}

export function useStickyNotesQuery() {
  const system = useSystem()
  return useQuery({ queryKey: NOTES_KEY, queryFn: () => fetchStickyNotes(system.http) })
}

export function useCreateStickyNoteMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: (input: StickyNoteInput) => createStickyNote(system.http, input),
    onError: () => reportFailure(system, 'create that note'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: NOTES_KEY }),
  })
}

export function useUpdateStickyNoteMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: StickyNotePatch }) =>
      updateStickyNote(system.http, id, patch),
    // Optimistic: a dragged note must stay where it was dropped, not snap back to
    // its old position for the length of a round trip.
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: NOTES_KEY })
      const previous = queryClient.getQueryData<StickyNote[]>(NOTES_KEY)
      queryClient.setQueryData<StickyNote[]>(NOTES_KEY, (old) =>
        old?.map((n) => (n.id === id ? applyPatch(n, patch) : n))
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(NOTES_KEY, ctx.previous)
      reportFailure(system, 'save that note')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: NOTES_KEY }),
  })
}

export function useDeleteStickyNoteMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: (id: number) => deleteStickyNote(system.http, id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: NOTES_KEY })
      const previous = queryClient.getQueryData<StickyNote[]>(NOTES_KEY)
      queryClient.setQueryData<StickyNote[]>(NOTES_KEY, (old) => old?.filter((n) => n.id !== id))
      return { previous }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(NOTES_KEY, ctx.previous)
      reportFailure(system, 'delete that note')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: NOTES_KEY }),
  })
}

/** `color: null` is meaningful, so a plain spread would not do. */
function applyPatch(note: StickyNote, patch: StickyNotePatch): StickyNote {
  return {
    ...note,
    ...(patch.content !== undefined ? { content: patch.content } : {}),
    ...(patch.x !== undefined ? { x: patch.x } : {}),
    ...(patch.y !== undefined ? { y: patch.y } : {}),
    ...(patch.width !== undefined ? { width: patch.width } : {}),
    ...(patch.height !== undefined ? { height: patch.height } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.onDesktop !== undefined ? { onDesktop: patch.onDesktop } : {}),
  }
}
