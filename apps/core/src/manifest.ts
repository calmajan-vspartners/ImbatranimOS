/**
 * The composition root — the ONLY file in core allowed to import
 * `@imbatranim/*` add-on packages (enforced by eslint no-restricted-imports;
 * the exception lives in eslint.config.js, not tribal knowledge).
 *
 * Adding an app to the OS = one import + one array entry here. Nothing else
 * in core changes.
 */
import { lazy } from 'react'
import { Settings as SettingsIcon } from 'lucide-react'
import { manifest as stickyNotes } from '@imbatranim/sticky-notes'
import { manifest as todo } from '@imbatranim/todo'
import { manifest as bookmarks } from '@imbatranim/bookmarks'
import { manifest as notepad } from '@imbatranim/notepad'
import { manifest as terminal } from '@imbatranim/repl-interpreter'
import { manifest as fileManager } from '@imbatranim/file-manager'
import { manifest as systemMonitor } from '@imbatranim/system-monitor'
import { manifest as snippingTool } from '@imbatranim/snipping-tool'
import { manifest as pdfViewer } from '@imbatranim/pdf-viewer'
import { manifest as norpdf } from '@imbatranim/norpdf'
import { manifest as slides } from '@imbatranim/slides'
import { manifest as sheets } from '@imbatranim/sheets'
import { manifest as docs } from '@imbatranim/docs'
import { manifest as calculator } from '@imbatranim/calculator'
import { manifest as clock } from '@imbatranim/clock'
import { manifest as calendar } from '@imbatranim/calendar'
import { manifest as imageViewer } from '@imbatranim/image-viewer'
import { manifest as mediaPlayer } from '@imbatranim/media-player'
import { manifest as markdownEditor } from '@imbatranim/markdown-editor'
import { manifest as codeEditor, diffManifest as diff } from '@imbatranim/code-editor'
import { manifest as gitGui } from '@imbatranim/git-gui'
import { manifest as restApiClient } from '@imbatranim/rest-api-client'
import { manifest as archiveManager } from '@imbatranim/archive-manager'
import {
  minesweeperManifest as minesweeper,
  solitaireManifest as solitaire,
} from '@imbatranim/games'
import { manifest as paint } from '@imbatranim/paint'
import type { AddonManifest, AppConfig } from './contract'
import { COMMAND_SOURCES, registerCommandSource } from './shared/commands/CommandSourcesRegistry'

// Settings is core (shell + auth + settings roster), not an add-on — it is
// declared here directly rather than imported as a package.
const settings: AddonManifest = {
  id: 'settings',
  name: 'Settings',
  description: 'System settings and appearance',
  meta: ['config', 'appearance', 'background', 'wallpaper', 'theme'],
  icon: SettingsIcon,
  component: lazy(() =>
    import('./modules/settings/Settings').then((m) => ({ default: m.Settings }))
  ),
  multiInstance: false,
  defaultSize: { width: 440, height: 500 },
  minSize: { width: 360, height: 400 },
}

const MANIFESTS: AddonManifest[] = [
  stickyNotes,
  todo,
  bookmarks,
  notepad,
  settings,
  terminal,
  fileManager,
  systemMonitor,
  snippingTool,
  pdfViewer,
  norpdf,
  slides,
  sheets,
  docs,
  calculator,
  clock,
  calendar,
  imageViewer,
  mediaPlayer,
  markdownEditor,
  codeEditor,
  diff,
  minesweeper,
  solitaire,
  paint,
  gitGui,
  restApiClient,
  archiveManager,
]

export const APP_REGISTRY: AppConfig[] = MANIFESTS

// Register add-on command-palette sources once (guard against HMR
// double-registration, same as the palette's own sources).
for (const m of MANIFESTS) {
  for (const source of m.commandSources ?? []) {
    if (!COMMAND_SOURCES.find((s) => s.group === source.group)) {
      registerCommandSource(source)
    }
  }
}
