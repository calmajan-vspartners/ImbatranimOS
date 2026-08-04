// Preview classification, kept separate from FileList's icon extension list
// (which serves a different, purely-cosmetic purpose) but drawing on the same
// known extensions where they overlap.
export type PreviewKind = 'text' | 'image' | 'audio' | 'video' | 'other'

const TEXT_EXTENSIONS = new Set([
  'md',
  'txt',
  'log',
  'json',
  'ts',
  'tsx',
  'js',
  'jsx',
  'css',
  'html',
  'sh',
  'py',
])

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'])

const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'])

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv'])

export function getExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return ''
  return name.slice(dot + 1).toLowerCase()
}

export function getPreviewKind(name: string): PreviewKind {
  const ext = getExtension(name)
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  return 'other'
}
