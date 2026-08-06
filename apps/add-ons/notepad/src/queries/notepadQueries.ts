import { useMutation, useQuery } from '@tanstack/react-query'
import { queryClient, useSystem } from '@imbatranim/ui'
import {
  createDirectory,
  createFile,
  deleteDirectory,
  deleteFile,
  fetchNotes,
  notesRootHasFiles,
  readFile,
  updateFile,
} from '../api/notepadApi'
import type { NotepadRoot } from '../lib/notepadRoot'

export function useNotesQuery(root: NotepadRoot, path: string = '') {
  const system = useSystem()
  return useQuery({
    // The root is part of the key: the same path in two roots is two documents, and
    // sharing a cache entry between them would serve one file's content for the
    // other.
    queryKey: ['notes', 'list', root, path],
    queryFn: () => fetchNotes(system.http, root, path),
  })
}

export function useNoteFileQuery(root: NotepadRoot, path: string | undefined) {
  const system = useSystem()
  return useQuery({
    queryKey: ['notes', 'file', root, path],
    queryFn: () => readFile(system.http, root, path!),
    enabled: !!path,
    // Never served stale: the file may have changed on disk (the Terminal is right
    // there), and re-reading on focus is what makes an explicit-save editor safe.
    staleTime: 0,
  })
}

/**
 * Whether the legacy `notes` root still has anything in it.
 *
 * Asked once per session — `staleTime: Infinity` — because it only decides the
 * initial root, and re-answering it mid-session would move a user's default under
 * them.
 */
export function useNotesRootHasFilesQuery() {
  const system = useSystem()
  return useQuery({
    queryKey: ['notes', 'legacy-root-populated'],
    queryFn: () => notesRootHasFiles(system.http),
    staleTime: Infinity,
  })
}

export function useCreateFileMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: ({ root, path, content }: { root: NotepadRoot; path: string; content?: string }) =>
      createFile(system.http, root, path, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes', 'list'] })
    },
  })
}

export function useUpdateFileMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: ({ root, path, content }: { root: NotepadRoot; path: string; content: string }) =>
      updateFile(system.http, root, path, content),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(['notes', 'file', variables.root, data.path], data)
    },
  })
}

export function useDeleteFileMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: ({ root, path }: { root: NotepadRoot; path: string }) =>
      deleteFile(system.http, root, path),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes', 'list'] })
    },
  })
}

export function useCreateDirectoryMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: ({ root, path }: { root: NotepadRoot; path: string }) =>
      createDirectory(system.http, root, path),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes', 'list'] })
    },
  })
}

export function useDeleteDirectoryMutation() {
  const system = useSystem()
  return useMutation({
    mutationFn: ({ root, path }: { root: NotepadRoot; path: string }) =>
      deleteDirectory(system.http, root, path),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes', 'list'] })
    },
  })
}
