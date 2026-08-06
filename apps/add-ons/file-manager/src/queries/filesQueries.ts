import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSystem } from '@imbatranim/ui'
import {
  copyEntry,
  createDirectory,
  deleteEntry,
  listTrash,
  restoreFromTrash,
  deleteFromTrash,
  emptyTrash,
  listDirectory,
  moveEntry,
  readContent,
  uploadFile,
  writeContent,
} from '../api/filesApi'

export function fsListKey(root: string, path: string) {
  return ['fs-list', root, path] as const
}

/** The directory portion of a path — '' for a top-level entry. */
function dirOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i === -1 ? '' : p.slice(0, i)
}

export function useDirectoryQuery(root: string, path: string) {
  const { http } = useSystem()
  return useQuery({
    queryKey: fsListKey(root, path),
    queryFn: () => listDirectory(http, root, path),
  })
}

export function fsPreviewContentKey(root: string, path: string) {
  return ['fs-preview-content', root, path] as const
}

/**
 * Text/code preview content. Keyed per-path so switching the selection never
 * shows another file's content — react-query just resolves the previous
 * in-flight request into its own (now-inactive) cache entry instead of
 * overwriting what's on screen.
 */
export function usePreviewContentQuery(root: string, path: string | null, enabled: boolean) {
  const { http } = useSystem()
  return useQuery({
    queryKey: fsPreviewContentKey(root, path ?? ''),
    queryFn: () => readContent(http, root, path as string),
    enabled: enabled && path !== null,
    staleTime: 30_000,
  })
}

export function useCreateDirectoryMutation(root: string, path: string) {
  const { http } = useSystem()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (folderName: string) => {
      const fullPath = path ? `${path}/${folderName}` : folderName
      return createDirectory(http, root, fullPath)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: fsListKey(root, path) })
    },
  })
}

export function useDeleteEntryMutation(root: string, currentPath: string) {
  const { http } = useSystem()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ path, toTrash }: { path: string; toTrash: boolean }) =>
      deleteEntry(http, root, path, toTrash),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: fsListKey(root, currentPath) })
      qc.invalidateQueries({ queryKey: ['trash'] })
    },
  })
}

export const trashKey = ['trash'] as const

export function useTrashQuery(enabled: boolean) {
  const { http } = useSystem()
  return useQuery({ queryKey: trashKey, queryFn: () => listTrash(http), enabled })
}

export function useRestoreTrashMutation(root: string, currentPath: string) {
  const { http } = useSystem()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => restoreFromTrash(http, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trashKey })
      qc.invalidateQueries({ queryKey: fsListKey(root, currentPath) })
    },
  })
}

export function useDeleteFromTrashMutation() {
  const { http } = useSystem()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteFromTrash(http, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: trashKey }),
  })
}

export function useEmptyTrashMutation() {
  const { http } = useSystem()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => emptyTrash(http),
    onSuccess: () => qc.invalidateQueries({ queryKey: trashKey }),
  })
}

export function useMoveEntryMutation(root: string, currentPath: string) {
  const { http } = useSystem()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => moveEntry(http, root, from, to),
    onSuccess: (_data, { from, to }) => {
      // A move touches TWO directories: the source loses the entry and the
      // destination gains it. Invalidating only the current dir left the SOURCE
      // listing stale for its whole cache lifetime after a cut/paste across dirs
      // (M3), so invalidate both endpoints' dirs as well.
      qc.invalidateQueries({ queryKey: fsListKey(root, currentPath) })
      qc.invalidateQueries({ queryKey: fsListKey(root, dirOf(from)) })
      qc.invalidateQueries({ queryKey: fsListKey(root, dirOf(to)) })
    },
  })
}

export function useCopyEntryMutation(root: string, currentPath: string) {
  const { http } = useSystem()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => copyEntry(http, root, from, to),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: fsListKey(root, currentPath) })
    },
  })
}

export function useWriteContentMutation(root: string, currentPath: string) {
  const { http } = useSystem()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      writeContent(http, root, path, content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: fsListKey(root, currentPath) })
    },
  })
}

export function useUploadFileMutation(root: string, currentPath: string) {
  const { http } = useSystem()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ path, file }: { path: string; file: File }) =>
      uploadFile(http, root, path, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: fsListKey(root, currentPath) })
    },
  })
}
