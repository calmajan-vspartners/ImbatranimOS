import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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

export function useDirectoryQuery(root: string, path: string) {
  return useQuery({
    queryKey: fsListKey(root, path),
    queryFn: () => listDirectory(root, path),
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
  return useQuery({
    queryKey: fsPreviewContentKey(root, path ?? ''),
    queryFn: () => readContent(root, path as string),
    enabled: enabled && path !== null,
    staleTime: 30_000,
  })
}

export function useCreateDirectoryMutation(root: string, path: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (folderName: string) => {
      const fullPath = path ? `${path}/${folderName}` : folderName
      return createDirectory(root, fullPath)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: fsListKey(root, path) })
    },
  })
}

export function useDeleteEntryMutation(root: string, currentPath: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ path, toTrash }: { path: string; toTrash: boolean }) =>
      deleteEntry(root, path, toTrash),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: fsListKey(root, currentPath) })
      qc.invalidateQueries({ queryKey: ['trash'] })
    },
  })
}

export const trashKey = ['trash'] as const

export function useTrashQuery(enabled: boolean) {
  return useQuery({ queryKey: trashKey, queryFn: listTrash, enabled })
}

export function useRestoreTrashMutation(root: string, currentPath: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => restoreFromTrash(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trashKey })
      qc.invalidateQueries({ queryKey: fsListKey(root, currentPath) })
    },
  })
}

export function useDeleteFromTrashMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteFromTrash(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: trashKey }),
  })
}

export function useEmptyTrashMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => emptyTrash(),
    onSuccess: () => qc.invalidateQueries({ queryKey: trashKey }),
  })
}

export function useMoveEntryMutation(root: string, currentPath: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => moveEntry(root, from, to),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: fsListKey(root, currentPath) })
    },
  })
}

export function useCopyEntryMutation(root: string, currentPath: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => copyEntry(root, from, to),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: fsListKey(root, currentPath) })
    },
  })
}

export function useWriteContentMutation(root: string, currentPath: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      writeContent(root, path, content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: fsListKey(root, currentPath) })
    },
  })
}

export function useUploadFileMutation(root: string, currentPath: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ path, file }: { path: string; file: File }) => uploadFile(root, path, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: fsListKey(root, currentPath) })
    },
  })
}
