export type FsEntry = {
  name: string
  path: string
  type: 'file' | 'directory'
  size: number
  modifiedAt: string
  /** ctime — POSIX has no true birth time on every filesystem. Optional so a
   *  cached listing from before this field existed still type-checks. */
  createdAt?: string
  /** POSIX permission bits as octal, display only. */
  mode?: string
  isSymlink?: boolean
}

export type FsRoot = {
  id: string
  label: string
}

export const FS_ROOTS: FsRoot[] = [
  { id: 'home', label: 'Home' },
  { id: 'notes', label: 'Notes' },
]
