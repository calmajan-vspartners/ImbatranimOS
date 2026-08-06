export type NoteEntry = {
  name: string
  path: string
  type: 'file' | 'directory'
}

export type NoteFile = {
  path: string
  content: string
}
