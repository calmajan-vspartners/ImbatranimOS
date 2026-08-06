import { lazy } from 'react'
import { PlayCircle } from 'lucide-react'
import type { AddonManifest } from '@imbatranim/core'

export const manifest: AddonManifest = {
  id: 'media-player',
  name: 'Media Player',
  description: 'Play audio and video files with a folder playlist',
  meta: ['music', 'video', 'audio', 'play', 'player', 'mp3', 'mp4', 'playlist', 'queue'],
  icon: PlayCircle,
  component: lazy(() => import('./MediaPlayer').then((m) => ({ default: m.MediaPlayer }))),
  // Multiple tracks/clips can play side by side in their own windows.
  opens: [
    'mp3',
    'wav',
    'ogg',
    'oga',
    'flac',
    'm4a',
    'aac',
    'opus',
    'mp4',
    'webm',
    'ogv',
    'mov',
    'm4v',
    'mkv',
  ],
  multiInstance: true,
  defaultSize: { width: 560, height: 420 },
  minSize: { width: 360, height: 260 },
}
